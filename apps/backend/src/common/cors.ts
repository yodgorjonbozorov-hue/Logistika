/**
 * CORS origin rules.
 *
 * `WEB_URL` holds one or more comma-separated origins. On Vercel the web app
 * also gets a fresh preview URL per deployment, so `WEB_PREVIEW_SUFFIX` (e.g.
 * `.vercel.app`) optionally allows those without listing each one.
 */
export interface CorsOriginOptions {
  /** Comma-separated allow-list from `WEB_URL`. */
  allowed: string;
  /** Optional host suffix that preview deployments share. */
  previewSuffix?: string;
}

export type OriginCheck = (origin: string | undefined) => boolean;

/** Strips a trailing slash so `https://a.uz/` and `https://a.uz` match. */
function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function parseOrigins(allowed: string): string[] {
  return allowed
    .split(',')
    .map(normalize)
    .filter((origin) => origin.length > 0);
}

/**
 * Builds the predicate Nest's `enableCors` uses. Same-origin and server-to-server
 * calls arrive without an `Origin` header and are always allowed; a browser
 * origin must match the list exactly, or end with the preview suffix over HTTPS.
 */
export function createOriginCheck({ allowed, previewSuffix }: CorsOriginOptions): OriginCheck {
  const list = new Set(parseOrigins(allowed));
  const suffix = previewSuffix?.trim();

  return (origin) => {
    if (!origin) return true;
    const candidate = normalize(origin);
    if (list.has(candidate)) return true;
    if (!suffix) return false;

    let host: string;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:') return false;
      host = url.hostname;
    } catch {
      return false;
    }
    // A suffix must match a whole label, so `evil-vercel.app` cannot pass as
    // `.vercel.app`.
    return host.endsWith(suffix) && host.length > suffix.length;
  };
}
