/**
 * Content sniffing by magic bytes (M-10).
 *
 * `file.mimetype` from multer is nothing but the Content-Type the CLIENT
 * chose to send — a `.exe` announced as `image/jpeg` sailed straight through
 * the old whitelist. The real type is decided by the bytes on disk, and only
 * then is it matched against the whitelist.
 *
 * Deliberately a tiny hand-rolled sniffer rather than a dependency: the
 * whitelist is four formats, and every one of them has an unambiguous,
 * fixed-offset signature.
 */

export type DetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean =>
  buffer.length >= offset + bytes.length && bytes.every((b, i) => buffer[offset + i] === b);

export function detectFileType(buffer: Buffer): DetectedType | null {
  // JPEG: FF D8 FF
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // WEBP: "RIFF" ....  "WEBP"
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return 'image/webp';
  // PDF: "%PDF-"
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/**
 * A stored object key must stay inside its tenant prefix. Extensions are chosen
 * by us from the DETECTED type, and the random UUID is the only variable part,
 * so a client-supplied filename never reaches the object store (path traversal).
 */
export const EXTENSION_BY_TYPE: Record<DetectedType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/** Strips anything that could escape a directory or confuse a downstream tool. */
export function sanitizeOriginalName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 120) || undefined;
}
