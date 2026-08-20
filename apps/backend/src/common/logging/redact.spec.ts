/**
 * The redactor is only worth having if it holds under the shapes that actually
 * show up in this application's logs, so the cases below are taken from real
 * ones: a Prisma connection error, an axios error carrying request headers, a
 * validation failure echoing a login body, a thrown JWT.
 */
import { isSecretKey, redact, redactValue, REDACTED } from './redact';

describe('redact', () => {
  it.each([
    ['password=hunter2', 'hunter2'],
    ['"password":"hunter2"', 'hunter2'],
    ["password: 'hunter2'", 'hunter2'],
    ['PASSWORD=hunter2', 'hunter2'],
    ['refresh_token=abc123def456', 'abc123def456'],
    ['x-api-key: sk-live-9f8e7d6c5b4a3921', 'sk-live'],
    ['authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', 'eyJhbGci'],
  ])('masks %s', (input, secret) => {
    expect(redact(input)).not.toContain(secret);
    expect(redact(input)).toContain(REDACTED);
  });

  it('masks the password inside a connection string but keeps the host', () => {
    const line = 'Cannot reach postgresql://truckai_app:Xk29fLp7Qw@db.internal:5432/truckai';
    const out = redact(line);
    expect(out).not.toContain('Xk29fLp7Qw');
    expect(out).toContain('db.internal:5432/truckai');
    expect(out).toContain('truckai_app'); // the user is not the secret
  });

  it('masks a bare JWT nobody labelled', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJjb21wYW55SWQiOiJjLTEifQ.9dK2';
    expect(redact(`token rejected: ${jwt}`)).not.toContain('eyJzdWIi');
  });

  it('masks a private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----';
    expect(redact(`startup failed: ${pem}`)).not.toContain('MIIEow');
  });

  it('leaves ordinary log lines alone', () => {
    const line = 'GET /api/v1/trips 200 in 14ms for company 397426c6';
    expect(redact(line)).toBe(line);
  });

  it('does not mangle a word that merely contains a secret word', () => {
    // "passenger" contains "pass" but is not an assignment, so nothing matches.
    expect(redact('passenger count 4')).toBe('passenger count 4');
  });
});

describe('redactValue', () => {
  it('masks by key even when the value looks harmless', () => {
    expect(redactValue({ password: 'a' })).toEqual({ password: REDACTED });
    expect(redactValue({ dbPassword: 'a' })).toEqual({ dbPassword: REDACTED });
    expect(redactValue({ 'x-api-key': 'a' })).toEqual({ 'x-api-key': REDACTED });
  });

  it('keeps the fields that make a log useful', () => {
    expect(
      redactValue({ userId: 'u-1', companyId: 'c-1', route: '/trips', statusCode: 200 }),
    ).toEqual({ userId: 'u-1', companyId: 'c-1', route: '/trips', statusCode: 200 });
  });

  it('walks arrays and nested objects', () => {
    const out = redactValue({ items: [{ headers: { authorization: 'Bearer abcdefghijkl' } }] });
    expect(JSON.stringify(out)).not.toContain('abcdefghijkl');
  });

  it('reduces an Error to a redacted single line rather than dropping it', () => {
    const out = redactValue(new Error('connect failed: password=hunter2'));
    expect(out).toContain('Error:');
    expect(out).not.toContain('hunter2');
  });

  it('stops at a depth limit instead of chasing a cycle forever', () => {
    const deep: Record<string, unknown> = {};
    let node = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = {};
      node.next = next;
      node = next;
    }
    expect(() => JSON.stringify(redactValue(deep))).not.toThrow();
    expect(JSON.stringify(redactValue(deep))).toContain('TRUNCATED');
  });

  it('leaves non-string scalars as they are', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(true)).toBe(true);
  });
});

describe('isSecretKey', () => {
  it.each(['password', 'PASSWORD', 'db_password', 'apiKey', 'X-Api-Key', 'jwtSecret', 'cookie'])(
    'recognises %s',
    (key) => expect(isSecretKey(key)).toBe(true),
  );

  it.each(['userId', 'companyId', 'plateNumber', 'route', 'statusCode', 'duration'])(
    'leaves %s alone',
    (key) => expect(isSecretKey(key)).toBe(false),
  );
});
