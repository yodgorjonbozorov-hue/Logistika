import type { ConfigService } from '@nestjs/config';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { FilesService } from './files.service';

const putObject = jest.fn();
const presignedGetObject = jest.fn();
const bucketExists = jest.fn().mockResolvedValue(true);

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject,
    presignedGetObject,
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
    const service = new FilesService(prisma, config);
    return { service, db };
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
});
