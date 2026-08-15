import { cellToText, cellToXlsx, toCsv, type ReportTable } from './report-table';

const TABLE: ReportTable = {
  key: 'trips',
  titleKey: 'reports.trips.title',
  columns: [
    { key: 'tripNumber', labelKey: 'reports.column.tripNumber', type: 'text' },
    { key: 'revenue', labelKey: 'reports.column.revenue', type: 'money' },
    { key: 'marginBp', labelKey: 'reports.column.margin', type: 'percent' },
  ],
  rows: [
    { tripNumber: '42', revenue: 2_500_000_000n, marginBp: 2336 },
    { tripNumber: 'A;B "quoted"', revenue: null, marginBp: null },
  ],
  totals: { tripNumber: 'Σ', revenue: 2_500_000_000n, marginBp: 2336 },
};

const translate = (key: string) => `[${key}]`;

describe('cellToText', () => {
  it('renders tiyin as so‘m with two decimals', () => {
    expect(cellToText(2_500_000_000n, 'money')).toBe('25000000.00');
    expect(cellToText(5n, 'money')).toBe('0.05');
  });

  it('renders basis points as a percent with two decimals', () => {
    expect(cellToText(2336, 'percent')).toBe('23.36');
    expect(cellToText(-2000, 'percent')).toBe('-20.00');
  });

  it('renders dates as ISO days and empties nulls', () => {
    expect(cellToText(new Date('2026-08-15T13:45:00Z'), 'date')).toBe('2026-08-15');
    expect(cellToText(null, 'money')).toBe('');
    expect(cellToText(undefined, 'text')).toBe('');
  });
});

describe('toCsv', () => {
  it('writes a BOM, translated headers and a totals row', () => {
    const csv = toCsv(TABLE, translate);
    const lines = csv.split('\r\n');

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe(
      '\uFEFF[reports.column.tripNumber];[reports.column.revenue];[reports.column.margin]',
    );
    expect(lines[1]).toBe('42;25000000.00;23.36');
    expect(lines[3]).toBe('Σ;25000000.00;23.36');
  });

  it('quotes separators and doubles inner quotes', () => {
    const line = toCsv(TABLE, translate).split('\r\n')[2];
    expect(line).toBe('"A;B ""quoted""";;');
  });
});

describe('cellToXlsx', () => {
  it('hands numeric cells to the spreadsheet as numbers', () => {
    expect(cellToXlsx(2_500_000_000n, 'money')).toBe(25_000_000);
    expect(cellToXlsx(2336, 'percent')).toBe(23.36);
    expect(cellToXlsx('1240.0', 'km')).toBe(1240);
  });

  it('keeps text as text and empty cells empty', () => {
    expect(cellToXlsx('42', 'text')).toBe('42');
    expect(cellToXlsx(null, 'money')).toBeNull();
  });
});
