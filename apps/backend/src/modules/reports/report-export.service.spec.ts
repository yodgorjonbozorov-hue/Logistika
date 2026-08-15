import ExcelJS from 'exceljs';
import { I18nService } from '../../i18n/i18n.service';
import { ReportExportService } from './report-export.service';
import type { ReportTable } from './report-table';

const TABLE: ReportTable = {
  key: 'trips',
  titleKey: 'reports.trips.title',
  columns: [
    { key: 'tripNumber', labelKey: 'reports.column.tripNumber', type: 'text' },
    { key: 'revenue', labelKey: 'reports.column.revenue', type: 'money' },
  ],
  rows: [{ tripNumber: '42', revenue: 2_500_000_000n }],
  totals: { tripNumber: 'Σ', revenue: 2_500_000_000n },
};

describe('ReportExportService', () => {
  const service = new ReportExportService(new I18nService());

  it('exports CSV with headers in the requested locale', async () => {
    const file = await service.export(TABLE, 'csv', 'ru');

    expect(file.filename).toMatch(/^trips-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.contentType).toContain('text/csv');
    const text = file.body.toString('utf8');
    expect(text).toContain('Рейс;Доход, сум');
    expect(text).toContain('42;25000000.00');
  });

  it('falls back to uz-latn headers', async () => {
    const file = await service.export(TABLE, 'csv', 'uz-latn');
    expect(file.body.toString('utf8')).toContain("Reys;Kirim, so'm");
  });

  it('exports a real workbook whose money cells are numeric and summable', async () => {
    const file = await service.export(TABLE, 'xlsx', 'uz-latn');

    expect(file.contentType).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;

    expect(sheet.name).toBe("Reyslar bo'yicha foyda");
    expect(sheet.getRow(1).getCell(1).value).toBe('Reys');
    expect(sheet.getRow(2).getCell(2).value).toBe(25_000_000);
    expect(sheet.getRow(3).getCell(1).value).toBe('Σ'); // totals row
  });
});
