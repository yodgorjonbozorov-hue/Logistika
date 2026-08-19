import type { ConfigService } from '@nestjs/config';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { FilesService } from './files.service';

/** Captures what the service sends, keyed by command name. */
const send = jest.fn().mockResolvedValue({});
const signUrl = jest.fn().mockResolvedValue('https://signed.example/object');

jest.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
    get name(): string {
      return this.constructor.name;
    }
  }
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    PutObjectCommand: class PutObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    HeadBucketCommand: class HeadBucketCommand extends Command {},
    CreateBucketCommand: class CreateBucketCommand extends Command {},
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => signUrl(...args),
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
  get: (key: string) => ({ S3_BUCKET: 'test-bucket' })[key],
} as unknown as ConfigService;

/** The PutObject the service issued, ignoring the bucket-existence probe. */
function putInput(): Record<string, unknown> {
  const call = send.mock.calls.find(
    ([command]) => (command as { name: string }).name === 'PutObjectCommand',
  );
  return (call?.[0] as { input: Record<string, unknown> }).input;
}

describe('FilesService', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['storedFile']);
    const service = new FilesService(prisma, config);
    return { service, db };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({});
  });

  it('rejects disallowed mime types', async () => {
    const { service } = setup();
    await expect(
      service.upload(ACTOR, { buffer: Buffer.from('x'), mimetype: 'application/x-msdownload' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(send).not.toHaveBeenCalled();
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

    const input = putInput();
    expect(input.Bucket).toBe('test-bucket');
    expect(String(input.Key).startsWith('company-a/')).toBe(true);
    expect(String(input.Key).endsWith('.jpg')).toBe(true);
    // the compressed body, not the original
    expect(String(input.Body)).toBe('compressed');
    expect(input.ContentType).toBe('image/jpeg');
    expect(db.storedFile!.create!.mock.calls[0][0].data.mimeType).toBe('image/jpeg');
  });

  it('passes PDFs through untouched', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.upload(ACTOR, { buffer: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf' });

    const input = putInput();
    expect(String(input.Key).endsWith('.pdf')).toBe(true);
    expect(String(input.Body)).toBe('%PDF-1.4');
    expect(input.ContentType).toBe('application/pdf');
  });

  it('creates the bucket when the existence probe fails', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockResolvedValue({ id: 'f1' });
    send.mockImplementation((command: { name: string }) =>
      command.name === 'HeadBucketCommand'
        ? Promise.reject(new Error('NoSuchBucket'))
        : Promise.resolve({}),
    );

    await service.upload(ACTOR, { buffer: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf' });

    const names = send.mock.calls.map(([c]) => (c as { name: string }).name);
    expect(names).toContain('CreateBucketCommand');
    expect(names).toContain('PutObjectCommand');
  });

  it('signed URL lookup is tenant-scoped (missing file → NOT_FOUND)', async () => {
    const { service, db } = setup();
    db.storedFile!.findUnique!.mockResolvedValue(null);
    await expect(service.getSignedUrl(ACTOR, 'file-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(signUrl).not.toHaveBeenCalled();
  });

  it('signs a URL for a file the tenant owns', async () => {
    const { service, db } = setup();
    db.storedFile!.findUnique!.mockResolvedValue({ id: 'f1', key: 'company-a/f1.jpg' });
    await expect(service.getSignedUrl(ACTOR, 'f1')).resolves.toMatchObject({
      url: 'https://signed.example/object',
      expiresIn: 900,
    });
  });
});
