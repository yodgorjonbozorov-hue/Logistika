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

/** Real signatures — uploads are now classified by content, not by header. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest-of-a-png'),
]);
const PDF_BYTES = Buffer.from('%PDF-1.4 rest-of-a-pdf');
const WINDOWS_EXE_BYTES = Buffer.concat([Buffer.from('MZ'), Buffer.from('\x90\x00\x03payload')]);

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

  it('rejects a payload whose CONTENT is not an allowed type, whatever it claims (M-10)', async () => {
    const { service } = setup();
    await expect(
      service.upload(ACTOR, {
        buffer: WINDOWS_EXE_BYTES,
        mimetype: 'image/jpeg', // the attacker picks this header freely
        originalname: 'invoice.jpg',
      }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('strips path components from the stored original name (path traversal)', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.upload(ACTOR, {
      buffer: PDF_BYTES,
      mimetype: 'application/pdf',
      originalname: '../../../etc/passwd',
    });

    expect(db.storedFile!.create!.mock.calls[0][0].data.originalName).toBe('passwd');
    expect(putObject.mock.calls[0][1]).toMatch(/^company-a\/[0-9a-f-]{36}\.pdf$/);
  });

  it('compresses images and stores them under a tenant-prefixed key', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.upload(ACTOR, {
      buffer: PNG_BYTES,
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

    await service.upload(ACTOR, { buffer: PDF_BYTES, mimetype: 'application/pdf' });

    const key = putObject.mock.calls[0][1] as string;
    expect(key.endsWith('.pdf')).toBe(true);
    expect(putObject.mock.calls[0][2].toString()).toBe(PDF_BYTES.toString());
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
