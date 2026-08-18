import { detectFileType, looksLikeCompletePdf } from './file-signature';

const header = (...bytes: number[]) => Buffer.from(bytes);
const withBody = (head: Buffer, body = 'body-bytes') => Buffer.concat([head, Buffer.from(body)]);

describe('detectFileType', () => {
  it('recognises the formats the system accepts', () => {
    expect(detectFileType(withBody(header(0xff, 0xd8, 0xff, 0xe0)))).toBe('image/jpeg');
    expect(detectFileType(withBody(header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))).toBe(
      'image/png',
    );
    expect(detectFileType(Buffer.from('%PDF-1.7\nrest'))).toBe('application/pdf');
  });

  it('recognises WebP only when the RIFF container really holds WebP', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from('WEBPVP8 '),
    ]);
    expect(detectFileType(webp)).toBe('image/webp');

    // Same RIFF header, different payload — a WAV file is not an image.
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from('WAVEfmt '),
    ]);
    expect(detectFileType(wav)).toBeNull();
  });

  it('rejects an executable no matter what it is called', () => {
    // MZ — a Windows binary sent as "photo.jpg".
    expect(detectFileType(withBody(header(0x4d, 0x5a)))).toBeNull();
    // ELF
    expect(detectFileType(withBody(header(0x7f, 0x45, 0x4c, 0x46)))).toBeNull();
    // A zip/office document, which this system has no use for.
    expect(detectFileType(withBody(header(0x50, 0x4b, 0x03, 0x04)))).toBeNull();
  });

  it('rejects text that merely mentions a format', () => {
    expect(detectFileType(Buffer.from('this file is a %PDF- honest'))).toBeNull();
    expect(detectFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'))).toBeNull();
  });

  it('does not read past the end of a short buffer', () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
    expect(detectFileType(header(0xff))).toBeNull();
    expect(detectFileType(Buffer.from('RIFF'))).toBeNull();
  });
});

describe('looksLikeCompletePdf', () => {
  it('accepts a document that ends with the EOF marker', () => {
    expect(looksLikeCompletePdf(Buffer.from('%PDF-1.4\ncontent\n%%EOF\n'))).toBe(true);
  });

  it('rejects a truncated document', () => {
    expect(looksLikeCompletePdf(Buffer.from('%PDF-1.4\ncontent without an ending'))).toBe(false);
  });

  it('ignores an EOF marker buried far from the end', () => {
    const padded = Buffer.concat([
      Buffer.from('%PDF-1.4\n%%EOF\n'),
      Buffer.alloc(4096, 0x41), // 4 KB of padding after the marker
    ]);
    expect(looksLikeCompletePdf(padded)).toBe(false);
  });
});
