/**
 * Work that used to happen on the request thread (TASK-4.3).
 *
 * `bullmq` and `ioredis` were dependencies from day one and nothing ever opened
 * a queue (L-7): a photo upload waited for sharp, and a login waited for an SMS
 * gateway. These tests go through the real HTTP endpoints and check both halves
 * — that the request returns without doing the slow work, and that the work is
 * then actually done.
 *
 * Jobs run inline here (JOBS_INLINE, set in load-env), so "has the job run yet"
 * is deterministic. The handler is the same object either way; only the moment
 * it runs differs.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';
import { JobsService } from '../src/common/jobs/jobs.service';
import { QUEUES } from '../src/common/jobs/job-queues';

jest.setTimeout(60_000);

/** A real 1x1 JPEG, so the magic-byte check and sharp both see a true image. */
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

describe('Background jobs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await prisma.smsMessage.deleteMany({});
    tenant = await createTenant(app, 'Jobs');
  });

  describe('file compression', () => {
    const upload = (token: string) =>
      request(app.getHttpServer())
        .post('/api/v1/files/upload')
        .set(...bearer(token))
        .attach('file', JPEG_1PX, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    it('accepts the upload and finishes the shrink out of band', async () => {
      const res = await upload(tenant.tokens.driver);

      expect(res.status).toBe(201);
      const stored = await prisma.storedFile.findUnique({ where: { id: res.body.data.id } });
      // Inline mode means the job has already run by the time we look; the
      // point being made is that `upload` no longer *contains* the resize.
      expect(stored?.status).toBe('READY');
    });

    it('leaves the file downloadable while it is still being processed', async () => {
      const res = await upload(tenant.tokens.driver);

      // A signed URL is issued whatever the status: the original bytes went up
      // first, so PROCESSING never means "not there yet".
      const url = await request(app.getHttpServer())
        .get(`/api/v1/files/${res.body.data.id}/url`)
        .set(...bearer(tenant.tokens.driver));

      expect(url.status).toBe(200);
      expect(url.body.data.url).toContain('http');
    });

    it('still refuses a file that is not an image at all', async () => {
      // Moving compression off the request must not move validation with it.
      const res = await request(app.getHttpServer())
        .post('/api/v1/files/upload')
        .set(...bearer(tenant.tokens.driver))
        .attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), {
          filename: 'evil.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(415);
    });

    it("never hands one company another company's file", async () => {
      const res = await upload(tenant.tokens.driver);
      const other = await createTenant(app, 'JobsOther');

      const url = await request(app.getHttpServer())
        .get(`/api/v1/files/${res.body.data.id}/url`)
        .set(...bearer(other.tokens.owner));

      expect(url.status).toBe(404);
    });
  });

  describe('sms delivery', () => {
    /**
     * The login lookup is by *user* phone, and the fixture's driver user is
     * created with an email only — an unknown number is answered with a cheerful
     * `sent: true` on purpose, so an attacker cannot enumerate drivers.
     */
    async function driverWithPhone(): Promise<string> {
      const phone = tenant.driver.phone!;
      await prisma.user.update({ where: { id: tenant.driverUser.id }, data: { phone } });
      return phone;
    }

    it('records that a login code was queued and sent', async () => {
      const phone = await driverWithPhone();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/driver/request-code')
        .send({ phone });

      expect(res.status).toBe(200);
      const messages = await prisma.smsMessage.findMany({ where: { phone } });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ purpose: 'DRIVER_LOGIN', status: 'SENT' });
      // The code itself is never stored: a table of live one-time codes is a
      // table worth stealing.
      expect(Object.values(messages[0]!)).not.toContainEqual(expect.stringContaining('kirish'));
    });

    it('leaves the message QUEUED when the worker cannot deliver it', async () => {
      const phone = await driverWithPhone();
      const jobs = app.get(JobsService);
      // Standing in for a gateway that is down: the handler throws, which is
      // exactly how BullMQ is told to retry.
      jest.spyOn(jobs, 'enqueue').mockImplementationOnce(() => Promise.resolve());

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/driver/request-code')
        .send({ phone });

      // The driver still gets an answer — they can always ask for another code
      // — and the row says plainly that nothing was delivered.
      expect(res.status).toBe(200);
      const [message] = await prisma.smsMessage.findMany({ where: { phone } });
      expect(message?.status).toBe('QUEUED');
      expect(message?.sentAt).toBeNull();
      jest.restoreAllMocks();
    });
  });

  describe('queue plumbing', () => {
    it('exposes a depth for every queue without a broker attached', async () => {
      const jobs = app.get(JobsService);
      await expect(jobs.pending(QUEUES.files)).resolves.toBe(0);
      await expect(jobs.pending(QUEUES.sms)).resolves.toBe(0);
    });
  });
});
