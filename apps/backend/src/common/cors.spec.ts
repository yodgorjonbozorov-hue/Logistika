import { createOriginCheck, parseOrigins } from './cors';

describe('parseOrigins', () => {
  it('splits a comma-separated list and trims trailing slashes', () => {
    expect(parseOrigins('https://a.uz/, https://b.uz')).toEqual(['https://a.uz', 'https://b.uz']);
  });

  it('drops empty entries', () => {
    expect(parseOrigins('https://a.uz,,  ,')).toEqual(['https://a.uz']);
  });
});

describe('createOriginCheck', () => {
  const allow = createOriginCheck({
    allowed: 'https://app.truckcontrol.uz, http://localhost:5173',
    previewSuffix: '.vercel.app',
  });

  it('allows requests without an Origin header (server-to-server, same origin)', () => {
    expect(allow(undefined)).toBe(true);
  });

  it('allows every listed origin, with or without a trailing slash', () => {
    expect(allow('https://app.truckcontrol.uz')).toBe(true);
    expect(allow('https://app.truckcontrol.uz/')).toBe(true);
    expect(allow('http://localhost:5173')).toBe(true);
  });

  it('rejects an origin that is not listed', () => {
    expect(allow('https://evil.uz')).toBe(false);
  });

  it('allows https preview deployments under the configured suffix', () => {
    expect(allow('https://truckcontrol-web-abc123.vercel.app')).toBe(true);
  });

  it('rejects a look-alike host that merely ends with the suffix text', () => {
    expect(allow('https://evil-vercel.app')).toBe(false);
    expect(allow('https://vercel.app')).toBe(false);
  });

  it('rejects preview origins served over plain http', () => {
    expect(allow('http://truckcontrol-web-abc123.vercel.app')).toBe(false);
  });

  it('rejects malformed origins', () => {
    expect(allow('not a url')).toBe(false);
  });

  it('allows nothing beyond the list when no preview suffix is configured', () => {
    const strict = createOriginCheck({ allowed: 'https://app.truckcontrol.uz' });
    expect(strict('https://app.truckcontrol.uz')).toBe(true);
    expect(strict('https://anything.vercel.app')).toBe(false);
  });
});
