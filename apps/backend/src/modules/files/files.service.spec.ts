import type { ConfigService } from '@nestjs/config';
import { ACTOR, createCronLockMock, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { FilesService } from './files.service';

const putObject = jest.fn();
const presignedGetObject = jest.fn();
const bucketExists = jest.fn().mockResolvedValue(true);
const removeObjects = jest.fn().mockResolvedValue(undefined);
/** The compression job reads the stored original back before shrinking it. */
const getObject = jest.fn(async () =>
  (async function* () {
    yield Buffer.from('stored-original');
  })(),
);

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject,
    presignedGetObject,
    bucketExists,
    getObject,
    removeObjects,
    makeBucket: jest.fn(),
  })),
}));

jest.mock('sharp', () => {
  const chain = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed')),
    metadata: jest.fn().mockResolvedValue({ width: 800, height: 600 }),
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
  /**
   * Records what was queued and can replay it, so a test can assert both that
   * the upload handed the work off *and* what the handler then does.
   */
  function fakeJobs() {
    const enqueued: unknown[] = [];
    let handler: ((payload: never) => Promise<void>) | undefined;
    return {
      enqueued,
      run: (payload: unknown) => handler!(payload as never),
      service: {
        register: (_name: string, fn: (payload: never) => Promise<void>) => {
          handler = fn;
        },
        enqueue: (_name: string, payload: unknown) => {
          enqueued.push(payload);
          return Promise.resolve();
        },
      },
    };
  }

  function setup(
    scan: { clean: boolean; threat?: string } = { clean: true },
    lockOptions: { acquired?: boolean } = {},
  ) {
    const { prisma, db } = createTenantDbMock(['storedFile']);
    db.storedFile!.aggregate = jest.fn().mockResolvedValue({ _sum: { size: 0 } });
    const scanner = { scan: jest.fn().mockResolvedValue(scan) };
    const jobs = fakeJobs();
    const lock = createCronLockMock(lockOptions);
    const service = new FilesService(prisma, scanner, jobs.service as never, lock.cronLock, config);
    void service.onModuleInit();
    return { service, db, scanner, jobs, lock };
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
    const sharpModule = jest.requireMock('sharp') as {
      default: jest.Mock;
      chain: { metadata: jest.Mock };
    };
    // Compression moved to a queue (TASK-4.3), but only the header is decoded
    // while the caller waits — a broken photo must still come back as 415 then,
    // not as a success followed by a FAILED row nobody looks at.
    sharpModule.chain.metadata.mockRejectedValueOnce(new Error('unsupported image format'));

    await expect(
      service.upload(ACTOR, { buffer: PNG, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('caps the decoded pixel count so a decompression bomb cannot take the process down', async () => {
    const { service, db } = setup();
    db.storedFile!.create!.mockResolvedValue({ id: 'f1', companyId: 'company-a' });
    const sharpModule = jest.requireMock('sharp') as { default: jest.Mock };

    await service.upload(ACTOR, { buffer: PNG, mimetype: 'image/png' });

    // The cap applies to the header probe too: a bomb must not get through by
    // being declared rather than decoded.
    expect(sharpModule.default).toHaveBeenCalledWith(
      PNG,
      expect.objectContaining({ limitInputPixels: 50_000_000 }),
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

  it('stores the image under a tenant-prefixed key and queues the shrink (TASK-4.3)', async () => {
    const { service, db, jobs } = setup();
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
    // The original bytes, right away: a driver on a village road should not
    // hold the connection open for seconds of sharp. PROCESSING means "not yet
    // shrunk", never "not yet there" — the file downloads throughout.
    expect(putObject.mock.calls[0][2]).toEqual(PNG);
    const created = db.storedFile!.create!.mock.calls[0][0].data;
    expect(created.mimeType).toBe('image/jpeg');
    expect(created.status).toBe('PROCESSING');
    expect(jobs.enqueued).toEqual([{ companyId: 'company-a', fileId: 'f1' }]);
  });

  it('replaces the object with the compressed one when the job runs', async () => {
    const { service, db, jobs } = setup();
    db.storedFile!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );
    await service.upload(ACTOR, { buffer: PNG, mimetype: 'image/png' });
    const key = putObject.mock.calls[0][1] as string;
    db.storedFile!.findUnique!.mockResolvedValue({
      id: 'f1',
      key,
      mimeType: 'image/jpeg',
      status: 'PROCESSING',
    });

    await jobs.run({ companyId: 'company-a', fileId: 'f1' });

    // Same key, smaller body, and the row now says READY with the new size.
    expect(putObject.mock.calls[1][1]).toBe(key);
    expect(putObject.mock.calls[1][2].toString()).toBe('compressed');
    expect(db.storedFile!.update!.mock.calls[0][0].data).toMatchObject({
      status: 'READY',
      size: Buffer.from('compressed').length,
    });
  });

  it('keeps the original and marks FAILED when the image will not compress', async () => {
    const { db, jobs } = setup();
    db.storedFile!.findUnique!.mockResolvedValue({
      id: 'f1',
      key: 'company-a/x.jpg',
      mimeType: 'image/jpeg',
      status: 'PROCESSING',
    });
    const sharpModule = jest.requireMock('sharp') as { chain: { toBuffer: jest.Mock } };
    sharpModule.chain.toBuffer.mockRejectedValueOnce(new Error('unsupported'));

    await jobs.run({ companyId: 'company-a', fileId: 'f1' });

    // Deleting a receipt a driver cannot photograph again would be worse than
    // storing it full size.
    expect(db.storedFile!.update!.mock.calls[0][0].data).toEqual({ status: 'FAILED' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('does not compress a file that is already READY', async () => {
    const { db, jobs } = setup();
    db.storedFile!.findUnique!.mockResolvedValue({ id: 'f1', key: 'k', status: 'READY' });

    await jobs.run({ companyId: 'company-a', fileId: 'f1' });

    expect(putObject).not.toHaveBeenCalled();
    expect(db.storedFile!.update).not.toHaveBeenCalled();
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

describe('FilesService.purgeOrphanFiles (M-17, TASK-4.4)', () => {
  const OLD = new Date(Date.now() - 48 * 60 * 60 * 1000);

  function setup(lockOptions: { acquired?: boolean } = {}) {
    const { prisma, db } = createTenantDbMock(['storedFile']);
    const queryRaw = jest.fn().mockResolvedValue([]);
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = queryRaw;
    (prisma as unknown as { storedFile: unknown }).storedFile = db.storedFile;
    const lock = createCronLockMock(lockOptions);
    const service = new FilesService(
      prisma,
      { scan: jest.fn() } as never,
      { register: jest.fn(), enqueue: jest.fn() } as never,
      lock.cronLock,
      config,
    );
    return { service, db, queryRaw, lock };
  }

  beforeEach(() => jest.clearAllMocks());

  it('runs behind the distributed lock', async () => {
    const { service, lock } = setup();

    await service.purgeOrphanFiles();

    // Two processes deleting the same objects means one of them gets
    // NoSuchKey for every single file.
    expect(lock.runExclusive).toHaveBeenCalledWith('orphan-file-purge', expect.any(Function));
  });

  it('does nothing on an instance that lost the claim', async () => {
    const { service, db } = setup({ acquired: false });

    await service.purgeOrphanFiles();

    expect(db.storedFile!.findMany).not.toHaveBeenCalled();
  });

  it('removes an upload nothing points at, from the bucket and the table', async () => {
    const { service, db } = setup();
    db.storedFile!.findMany!.mockResolvedValue([
      { id: 'f1', key: 'company-a/one.jpg', companyId: 'company-a' },
    ]);

    await service.purgeOrphanFiles();

    expect(removeObjects).toHaveBeenCalledWith('test-bucket', ['company-a/one.jpg']);
    expect(db.storedFile!.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['f1'] } } });
  });

  it('keeps a file a trip event still references', async () => {
    const { service, db, queryRaw } = setup();
    db.storedFile!.findMany!.mockResolvedValue([
      { id: 'f1', key: 'company-a/one.jpg', companyId: 'company-a' },
    ]);
    queryRaw.mockResolvedValue([{ photo_file_ids: ['f1'] }]);

    await service.purgeOrphanFiles();

    expect(removeObjects).not.toHaveBeenCalled();
    expect(db.storedFile!.deleteMany).not.toHaveBeenCalled();
  });

  it('only considers uploads past the grace period', async () => {
    const { service, db } = setup();

    await service.purgeOrphanFiles();

    // Uploads land before the event that references them; a driver filling in
    // a form must not have their photo swept out from under them.
    const where = db.storedFile!.findMany!.mock.calls[0][0].where as {
      createdAt: { lt: Date };
    };
    expect(where.createdAt.lt.getTime()).toBeLessThanOrEqual(OLD.getTime() + 48 * 3600_000);
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(OLD.getTime());
  });

  it('does not take the process down when storage is unreachable', async () => {
    const { service, db } = setup();
    db.storedFile!.findMany!.mockResolvedValue([{ id: 'f1', key: 'k', companyId: 'company-a' }]);
    removeObjects.mockRejectedValueOnce(new Error('connection reset'));

    // Housekeeping that crashes the API at 2am is worse than housekeeping that
    // is skipped and logged.
    await expect(service.purgeOrphanFiles()).resolves.toBeUndefined();
  });
});
