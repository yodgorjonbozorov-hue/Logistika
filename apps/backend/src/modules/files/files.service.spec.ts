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

const CONFIG_VALUES: Record<string, string | number> = {
  MINIO_BUCKET: 'test-bucket',
  MINIO_ENDPOINT: 'minio',
  MINIO_PORT: 9000,
  MINIO_USE_SSL: 'false',
  MINIO_ROOT_USER: 'test-user',
  MINIO_ROOT_PASSWORD: 'test-password',
  MINIO_PUBLIC_ENDPOINT: 'files.example.test',
};

const config = {
  get: (key: string) => CONFIG_VALUES[key],
  getOrThrow: (key: string) => {
    const value = CONFIG_VALUES[key];
    if (value === undefined) throw new Error(`Missing configuration: ${key}`);
    return value;
  },
} as unknown as ConfigService;

/** Real headers, so the magic-byte check sees what it would see in production. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('image-body'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('image-body')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.from('this is a windows binary')]);

describe('FilesService', () => {
  function setup(scan: { clean: boolean; threat?: string } = { clean: true }) {
    const { prisma, db } = createTenantDbMock(['storedFile']);
    db.storedFile!.aggregate = jest.fn().mockResolvedValue({ _sum: { size: 0 } });
    const scanner = { scan: jest.fn().mockResolvedValue(scan) };
    const service = new FilesService(prisma, scanner, config);
    return { service, db, scanner };
  }

  beforeEach(() => jest.clearAllMocks());

  it('rejects disallowed content, whatever the client calls it', async () => {
    const { service } = setup();
    // The classic: an executable announced as a photo. multer's mimetype is
    // just the client's word for it.
    await expect(
      service.upload(ACTOR, { buffer: EXE, mimetype: 'image/jpeg', originalname: 'photo.jpg' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects a truncated PDF wearing a valid header', async () => {
    const { service } = setup();
    await expect(
      service.upload(ACTOR, {
        buffer: Buffer.from('%PDF-1.4 and then nothing'),
        mimetype: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('rejects an unreadable image with 415 rather than a bare 500', async () => {
    const { service } = setup();
    const sharpModule = jest.requireMock('sharp') as { default: jest.Mock; chain: { toBuffer: jest.Mock } };
    sharpModule.chain.toBuffer.mockRejectedValueOnce(new Error('unsupported image format'));

    await expect(
      service.upload(ACTOR, { buffer: PNG, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    sharpModule.chain.toBuffer.mockResolvedValue(Buffer.from('compressed'));
  });

  it('caps the decoded pixel count so a decompression bomb cannot take the process down', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockResolvedValue({ id: 'f1' });
    const sharpModule = jest.requireMock('sharp') as { default: jest.Mock };

    await service.upload(ACTOR, { buffer: PNG, mimetype: 'image/png' });

    expect(sharpModule.default).toHaveBeenCalledWith(
      PNG,
      expect.objectContaining({ limitInputPixels: 50_000_000, failOn: 'error' }),
    );
  });

  it('refuses an upload the scanner flags', async () => {
    const { service, scanner } = setup({ clean: false, threat: 'Eicar-Test-Signature' });

    await expect(
      service.upload(ACTOR, { buffer: PDF, mimetype: 'application/pdf' }),
    ).rejects.toMatchObject({ code: 'FILE_INFECTED' });
    expect(scanner.scan).toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('refuses an upload that would exceed the company storage quota', async () => {
    const { service, db } = setup();
    db.storedFile!.aggregate = jest.fn().mockResolvedValue({ _sum: { size: 5 * 1024 ** 3 } });

    await expect(
      service.upload(ACTOR, { buffer: JPEG, mimetype: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('compresses images and stores them under a tenant-prefixed key', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.upload(ACTOR, {
      buffer: PNG,
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

    await service.upload(ACTOR, { buffer: PDF, mimetype: 'application/pdf' });

    const key = putObject.mock.calls[0][1] as string;
    expect(key.endsWith('.pdf')).toBe(true);
    expect(putObject.mock.calls[0][2]).toEqual(PDF);
  });

  it('signs download urls as attachments with a fixed type and a safe filename', async () => {
    const { service, db } = setup();
    db.storedFile!.findUnique!.mockResolvedValue({
      id: 'f1',
      key: 'company-a/abc.jpg',
      mimeType: 'image/jpeg',
      originalName: 'chek"; rm -rf /.jpg',
    });

    await service.getSignedUrl(ACTOR, 'f1');

    const options = presignedGetObject.mock.calls[0][3] as Record<string, string>;
    expect(options['response-content-type']).toBe('image/jpeg');
    // Quotes and shell characters cannot escape the header they land in.
    expect(options['response-content-disposition']).toContain('attachment;');
    expect(options['response-content-disposition']).not.toContain('"; rm');
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
