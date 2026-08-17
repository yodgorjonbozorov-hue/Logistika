/**
 * Magic-byte detection for the handful of types this system accepts.
 *
 * `file.mimetype` from multer is just the Content-Type the client typed, so an
 * .exe announced as image/jpeg used to be stored as one. The bytes decide here
 * instead. The allowlist is four formats, which is why this is a short table
 * rather than a dependency.
 */
export type DetectedFileType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

interface Signature {
  type: DetectedFileType;
  /** Byte pattern; `null` matches any byte at that offset. */
  magic: Array<number | null>;
  offset?: number;
  /** Extra constraint for containers whose header is not unique on its own. */
  extra?: (buffer: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  {
    // RIFF....WEBP — the four size bytes in between are content.
    type: 'image/webp',
    magic: [0x52, 0x49, 0x46, 0x46],
    extra: (buffer) => buffer.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { type: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
];

function matches(buffer: Buffer, signature: Signature): boolean {
  const offset = signature.offset ?? 0;
  if (buffer.length < offset + signature.magic.length) return false;
  const headerMatches = signature.magic.every(
    (byte, index) => byte === null || buffer[offset + index] === byte,
  );
  return headerMatches && (signature.extra?.(buffer) ?? true);
}

/** The real type of the content, or null when it is not one we accept. */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  return SIGNATURES.find((signature) => matches(buffer, signature))?.type ?? null;
}

/**
 * A PDF must end with an EOF marker reasonably close to the end of the file.
 * It is not a full parse — just enough that a truncated or padded blob wearing
 * a %PDF- header does not pass as a document.
 */
export function looksLikeCompletePdf(buffer: Buffer): boolean {
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
  return tail.includes('%%EOF');
}
