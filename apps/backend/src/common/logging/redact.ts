/**
 * Keeps credentials out of the log.
 *
 * Logs leave the trust boundary in a way responses do not: they are shipped to
 * an aggregator, read by support, kept for months and backed up. A refresh
 * token in a response body lives for one request; the same token in a log line
 * is a month-long session sitting in a searchable index.
 *
 * Nothing here tries to be clever about structure. It is a set of shapes that
 * are always a secret wherever they appear — a `password=` assignment, a
 * connection string's userinfo, a Bearer header, a JWT, an `sk-`/`AKIA` key —
 * and it rewrites them in place. Over-redaction is the acceptable failure: a
 * masked value that turns out to be harmless costs a debugging session, and an
 * unmasked one that turns out to be a token costs an incident.
 */

export const REDACTED = '[REDACTED]';

/** Keys whose value is a secret no matter how it is spelled or delimited. */
const SECRET_KEYS = [
  'password',
  'passwd',
  'pass',
  'secret',
  'token',
  'refreshtoken',
  'accesstoken',
  'authorization',
  'auth',
  'cookie',
  'setcookie',
  'apikey',
  'api_key',
  'privatekey',
  'passphrase',
  'credential',
  'jwt',
  'databaseurl',
  'database_url',
  'redisurl',
  'connectionstring',
];

const KEY_ALTERNATION = SECRET_KEYS.map((key) => key.replace(/_/g, '[_-]?')).join('|');

const RULES: Array<[RegExp, string]> = [
  // key=value / key: value / "key":"value" — quoted or bare, JSON or querystring.
  //
  // The optional scheme group is not cosmetic. `authorization: Bearer <jwt>`
  // has a space in its value, and a value pattern that stops at whitespace
  // masks the word "Bearer" and leaves the token itself in the log — the one
  // case this whole file exists to prevent. Capturing the scheme lets the
  // token after it be the part that disappears.
  [
    new RegExp(
      `(["']?(?:${KEY_ALTERNATION})["']?\\s*[:=]\\s*)(["']?)((?:bearer|basic)\\s+)?[^\\s,;&"'}\\]]+\\2`,
      'gi',
    ),
    `$1$2$3${REDACTED}$2`,
  ],
  // Authorization: Bearer <token>  /  Basic <base64>, unlabelled by a key.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // A JWT anywhere at all, even unlabelled — three base64url segments. The
  // last one is allowed to be short because a truncated token in a log is
  // still the first two thirds of a real one.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{2,}/g, REDACTED],
  // Connection-string userinfo: postgresql://user:pw@host → postgresql://user:[REDACTED]@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  // Provider keys that are self-identifying.
  [/\bsk-[A-Za-z0-9_-]{12,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // A PEM block is never something a log needs.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
];

/** Rewrites every secret-shaped run in a string. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/** Depth guard: a cyclic or absurdly nested object must not hang the logger. */
const MAX_DEPTH = 6;

/**
 * Redacts a value of any shape.
 *
 * Objects are walked by key as well as by value, because the key is the more
 * reliable signal: `{ password: 'hunter2' }` has nothing secret-looking in the
 * value at all.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value instanceof Error) return redact(`${value.name}: ${value.message}`);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : redactValue(item, depth + 1);
  }
  return out;
}

const NORMALISED_SECRET_KEYS = new Set(SECRET_KEYS.map((key) => key.replace(/[_-]/g, '')));

export function isSecretKey(key: string): boolean {
  const bare = key.toLowerCase().replace(/[_-]/g, '');
  if (NORMALISED_SECRET_KEYS.has(bare)) return true;
  // `x-api-key`, `jwtAccessSecret`, `dbPassword` — a compound name containing a
  // secret word is a secret.
  return [...NORMALISED_SECRET_KEYS].some((secret) => secret.length >= 3 && bare.includes(secret));
}
