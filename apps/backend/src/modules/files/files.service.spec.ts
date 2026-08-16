import type { ConfigService } from '@nestjs/config';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { FilesService } from './files.service';

const putObject = jest.fn();
const presignedGetObject = jest.fn();
const removeObject = jest.fn();
const bucketExists = jest.fn().mockResolvedValue(true);

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject,
    presignedGetObject,
    removeObject,
    bucketExists,
    makeBucket: jest.fn(),
  })),
}));

jest.mock('sharp', () => {
  const chain = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed')),
  };
  return { __esModule: true, default: jest.fn(() => chain), chain };
});

const config = {
  get: (key: string) => ({ MINIO_BUCKET: 'test-bucket' })[key],
} as unknown as ConfigService;

describe('FilesService', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['storedFile']);
    // Retention runs across tenants, so it uses the bare client.
    const root = { findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() };
    (prisma as unknown as { storedFile: typeof root }).storedFile = root;
    const service = new FilesService(prisma, config);
    return { service, db, root };
  }

  beforeEach(() => jest.clearAllMocks());

  it('rejects disallowed mime types', async () => {
    const { service } = setup();
    await expect(
      service.upload(ACTOR, { buffer: Buffer.from('x'), mimetype: 'application/x-msdownload' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('compresses images and stores them under a tenant-prefixed key', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.upload(ACTOR, {
      buffer: Buffer.from('raw-image'),
      mimetype: 'image/png',
      originalname: 'check.png',
    });

    const key = putObject.mock.calls[0][1] as string;
    expect(key.startsWith('company-a/')).toBe(true);
    expect(key.endsWith('.jpg')).toBe(true);
    // compressed body, not the original
    expect(putObject.mock.calls[0][2].toString()).toBe('compressed');
    expect(db.storedFile!.create!.mock.calls[0][0].data.mimeType).toBe('image/jpeg');
  });

  it('passes PDFs through untouched', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.upload(ACTOR, { buffer: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf' });

    const key = putObject.mock.calls[0][1] as string;
    expect(key.endsWith('.pdf')).toBe(true);
    expect(putObject.mock.calls[0][2].toString()).toBe('%PDF-1.4');
  });

  it('signed URL lookup is tenant-scoped (missing file → NOT_FOUND)', async () => {
    const { service, db } = setup();
    db.storedFile!.findUnique!.mockResolvedValue(null);
    await expect(service.getSignedUrl(ACTOR, 'file-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(presignedGetObject).not.toHaveBeenCalled();
  });

  it('gives a voice note 30 days and a photo none (TZ §8.2)', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.upload(ACTOR, { buffer: Buffer.from('note'), mimetype: 'audio/mp4' });
    const audio = db.storedFile!.create!.mock.calls[0][0].data as { expiresAt: Date; key: string };
    const days = (audio.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(30);
    expect(audio.key).toMatch(/\.audio$/);

    await service.upload(ACTOR, { buffer: Buffer.from('photo'), mimetype: 'image/jpeg' });
    expect(
      (db.storedFile!.create!.mock.calls[1][0].data as { expiresAt: null }).expiresAt,
    ).toBeNull();
  });

  it('purges expired files, dropping the row only once the object is gone', async () => {
    const { service, root } = setup();
    root.findMany.mockResolvedValue([
      { id: 'f1', key: 'company-a/one.audio' },
      { id: 'f2', key: 'company-a/two.audio' },
    ]);
    removeObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('bucket down'));

    expect(await service.purgeExpired(new Date())).toBe(1);
    expect(root.delete).toHaveBeenCalledTimes(1);
    expect(root.delete.mock.calls[0][0]).toEqual({ where: { id: 'f1' } });
    // The failed one keeps its row, so tomorrow's run tries it again.
    expect(root.findMany.mock.calls[0][0].where.expiresAt).toMatchObject({ not: null });
  });
});
