/**
 * File upload security against a real MinIO (M-10).
 *
 * The old whitelist trusted `file.mimetype`, which is nothing but the
 * Content-Type header the client chose to send — so an executable announced as
 * `image/jpeg` was stored happily. Classification now comes from the bytes.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  api,
  auth,
  createCompany,
  createTestApp,
  login,
  prisma,
  resetDatabase,
  resetRateLimits,
  type TestUser,
} from './harness';

/** A minimal but genuinely decodable 1x1 PNG. */
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const REAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const WINDOWS_EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x41)]);

describe('File upload security (M-10)', () => {
  let app: NestExpressApplication;
  let owner: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits(app);
    const company = await createCompany();
    owner = await login(app, company.owner);
  });

  it('stores a real image and records it under the tenant prefix', async () => {
    const response = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', REAL_PNG, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(201);

    expect(response.body.data.mimeType).toBe('image/jpeg'); // re-encoded
    const stored = await prisma.storedFile.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });
    expect(stored.key.startsWith(`${stored.companyId}/`)).toBe(true);
    expect(stored.key.endsWith('.jpg')).toBe(true);
  });

  it('rejects an executable that claims to be a JPEG', async () => {
    const response = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', WINDOWS_EXE, { filename: 'invoice.jpg', contentType: 'image/jpeg' })
      .expect(415);

    expect(response.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it('rejects an HTML/SVG payload dressed as an image (stored XSS vector)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', svg, { filename: 'x.png', contentType: 'image/png' })
      .expect(415);
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it('accepts a genuine PDF unchanged', async () => {
    const response = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', REAL_PDF, { filename: 'cmr.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(response.body.data.mimeType).toBe('application/pdf');
    expect(response.body.data.size).toBe(REAL_PDF.length);
  });

  it('never lets a client filename influence the object key (path traversal)', async () => {
    const response = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', REAL_PDF, {
        filename: '../../../../etc/passwd',
        contentType: 'application/pdf',
      })
      .expect(201);

    const stored = await prisma.storedFile.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });
    expect(stored.key).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
    expect(stored.key).not.toContain('..');
    expect(stored.originalName).toBe('passwd');
  });

  it('a signed URL for another tenant’s file is a 404', async () => {
    const mine = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', REAL_PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(201);

    const other = await createCompany();
    resetRateLimits(app);
    const otherOwner = await login(app, other.owner);

    await api(app)
      .get(`/api/v1/files/${mine.body.data.id}/url`)
      .set(auth(otherOwner.accessToken))
      .expect(404);
  });

  it('a signed URL for my own file works and actually downloads the object', async () => {
    const uploaded = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', REAL_PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(201);

    const signed = await api(app)
      .get(`/api/v1/files/${uploaded.body.data.id}/url`)
      .set(auth(owner.accessToken))
      .expect(200);

    expect(signed.body.data.expiresIn).toBe(900);
    const download = await fetch(signed.body.data.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).toString()).toBe(REAL_PDF.toString());
  });

  it('requires authentication', async () => {
    await api(app)
      .post('/api/v1/files/upload')
      .attach('file', REAL_PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(401);
  });

  it('rejects an upload with no file at all', async () => {
    await api(app).post('/api/v1/files/upload').set(auth(owner.accessToken)).expect(400);
  });

  it('rejects a truncated image as a client error, not a 500', async () => {
    // The magic bytes are a valid PNG header and the body is not: exactly what
    // a photo interrupted by a dropped mobile connection looks like. Sharp
    // throws on it, and an unhandled throw here is a 500 the driver app's
    // offline queue would retry forever.
    const truncated = Buffer.concat([REAL_PNG.subarray(0, 16), Buffer.alloc(64, 0xff)]);
    const response = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', truncated, { filename: 'broken.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('FILE_CORRUPT');
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it('refuses a file beyond the configured size ceiling', async () => {
    const oversized = Buffer.concat([REAL_PDF, Buffer.alloc(16 * 1024 * 1024, 0x20)]);
    const response = await api(app)
      .post('/api/v1/files/upload')
      .set(auth(owner.accessToken))
      .attach('file', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.storedFile.count()).toBe(0);
  });
});
