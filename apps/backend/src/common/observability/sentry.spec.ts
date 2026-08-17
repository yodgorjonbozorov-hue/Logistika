import { scrub } from './sentry';

/**
 * Error reports leave the server, so anything that could carry a credential or
 * a driver's personal details has to be gone before they do.
 */
describe('sentry scrubbing', () => {
  it('drops request bodies and cookies entirely', () => {
    const event = scrub({
      request: {
        cookies: { tc_rt: 'a-refresh-token' },
        data: { password: 'hunter2', amount: '100' },
        headers: { 'content-type': 'application/json' },
      },
    } as never);

    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('a-refresh-token');
    expect(JSON.stringify(event)).not.toContain('hunter2');
  });

  it('redacts sensitive headers but keeps the harmless ones', () => {
    const event = scrub({
      request: {
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'tc_rt=secret',
          'accept-language': 'uz-latn',
        },
      },
    } as never);

    expect(event.request?.headers?.authorization).toBe('[redacted]');
    expect(event.request?.headers?.cookie).toBe('[redacted]');
    expect(event.request?.headers?.['accept-language']).toBe('uz-latn');
  });

  it('redacts personal and credential fields in extra context', () => {
    const event = scrub({
      extra: {
        phone: '+998901112233',
        inn: '301234567',
        refreshToken: 'secret',
        tripNumber: 'TR-2026-000001',
      },
    } as never);

    expect(event.extra?.phone).toBe('[redacted]');
    expect(event.extra?.inn).toBe('[redacted]');
    expect(event.extra?.refreshToken).toBe('[redacted]');
    // Business identifiers are what make a report useful — those stay.
    expect(event.extra?.tripNumber).toBe('TR-2026-000001');
  });

  it('leaves an event with nothing sensitive untouched', () => {
    const event = scrub({ message: 'boom', extra: { path: '/api/v1/trips' } } as never);
    expect(event.extra?.path).toBe('/api/v1/trips');
  });
});
