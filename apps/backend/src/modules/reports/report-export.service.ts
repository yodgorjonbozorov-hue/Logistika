import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Locale } from 'shared';
import { I18nService } from '../../i18n/i18n.service';
import { cellToXlsx, toCsv, XLSX_NUMBER_FORMATS, type ReportTable } from './report-table';

export type ExportFormat = 'xlsx' | 'csv';

export interface ExportedFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

@Injectable()
export class ReportExportService {
  constructor(private readonly i18n: I18nService) {}

  async export(table: ReportTable, format: ExportFormat, locale: Locale): Promise<ExportedFile> {
    const translate = (key: string) => this.i18n.translate(key, locale);
    const filename = `${table.key}-${new Date().toISOString().slice(0, 10)}.${format}`;
    if (format === 'csv') {
      return {
        filename,
        contentType: CONTENT_TYPES.csv,
        body: Buffer.from(toCsv(table, translate), 'utf8'),
      };
    }
    return {
      filename,
      contentType: CONTENT_TYPES.xlsx,
      body: await this.toXlsx(table, translate),
    };
  }

  private async toXlsx(table: ReportTable, translate: (key: string) => string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TruckControl AI';
    const sheet = workbook.addWorksheet(translate(table.titleKey).slice(0, 31));

    sheet.columns = table.columns.map((column) => ({
      header: translate(column.labelKey),
      key: column.key,
      width: column.type === 'text' ? 26 : 16,
      style: { numFmt: XLSX_NUMBER_FORMATS[column.type] },
    }));
    sheet.getRow(1).font = { bold: true };

    for (const row of table.rows) {
      sheet.addRow(
        Object.fromEntries(
          table.columns.map((column) => [column.key, cellToXlsx(row[column.key], column.type)]),
        ),
      );
    }
    if (table.totals) {
      const totals = sheet.addRow(
        Object.fromEntries(
          table.columns.map((column) => [
            column.key,
            cellToXlsx(table.totals?.[column.key], column.type),
          ]),
        ),
      );
      totals.font = { bold: true };
    }

    // exceljs returns an ArrayBuffer-ish value; Buffer.from copies it once.
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
