import { describe, expect, it } from 'vitest';
import { csvCell, csvFilename, toCsv } from './csv';

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Toshkent')).toBe('Toshkent');
    expect(csvCell(42)).toBe('42');
  });

  it('renders nothing for a missing value', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes anything that would otherwise break the row', () => {
    expect(csvCell('Toshkent, Navoiy')).toBe('"Toshkent, Navoiy"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    // A semicolon splits rows in locales where it is the delimiter.
    expect(csvCell('a;b')).toBe('"a;b"');
  });

  it('defuses a value a spreadsheet would execute', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+998901234567')).toBe("'+998901234567");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@user')).toBe("'@user");
  });

  it('quotes a defused value that also needs quoting', () => {
    expect(csvCell('=cmd,x')).toBe('"\'=cmd,x"');
  });
});

describe('toCsv', () => {
  const rows = [
    { number: 'TR-1', from: 'Toshkent', price: 18_000_000 },
    { number: 'TR-2', from: 'Samarqand, markaz', price: null },
  ];
  const columns = [
    { header: 'Reys', value: (row: (typeof rows)[number]) => row.number },
    { header: 'Yuklash', value: (row: (typeof rows)[number]) => row.from },
    { header: 'Narx', value: (row: (typeof rows)[number]) => row.price },
  ];

  it('writes a header row and one line per record, CRLF separated', () => {
    expect(toCsv(rows, columns)).toBe(
      'Reys,Yuklash,Narx\r\nTR-1,Toshkent,18000000\r\nTR-2,"Samarqand, markaz",',
    );
  });

  it('still writes the header when there is nothing to export', () => {
    expect(toCsv([], columns)).toBe('Reys,Yuklash,Narx');
  });
});

describe('csvFilename', () => {
  it('dates the file so a second export does not overwrite the first', () => {
    expect(csvFilename('trips', new Date('2026-08-19T22:00:00.000Z'))).toBe('trips-2026-08-19.csv');
  });
});
