import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Locale } from 'shared';
import { I18nService } from '../../i18n/i18n.service';
import type { ExpenseStructureRow, ProfitRow } from './reports.service';

export type ExportFormat = 'xlsx' | 'pdf';

export interface ExportFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

/** Tiyin → so'm for human-readable exports. */
function toSom(tiyin: bigint | null): number | null {
  return tiyin == null ? null : Number(tiyin) / 100;
}

const PROFIT_COLUMNS = [
  'REPORT_COL_LABEL',
  'REPORT_COL_TRIPS',
  'REPORT_COL_KM',
  'REPORT_COL_INCOME',
  'REPORT_COL_EXPENSES',
  'REPORT_COL_DRIVER_SHARE',
  'REPORT_COL_AMORTIZATION',
  'REPORT_COL_TOTAL_COST',
  'REPORT_COL_PROFIT',
  'REPORT_COL_COST_PER_KM',
  'REPORT_COL_ROI',
] as const;

const STRUCTURE_COLUMNS = ['REPORT_COL_CATEGORY', 'REPORT_COL_AMOUNT', 'REPORT_COL_SHARE'] as const;

@Injectable()
export class ReportsExportService {
  constructor(private readonly i18n: I18nService) {}

  async exportProfit(
    rows: ProfitRow[],
    titleKey: string,
    format: ExportFormat,
    locale: Locale,
  ): Promise<ExportFile> {
    const title = this.i18n.translate(titleKey, locale);
    const headers = PROFIT_COLUMNS.map((key) => this.i18n.translate(key, locale));
    const table = rows.map((row) => [
      row.label,
      row.tripCount,
      row.distanceKm,
      toSom(row.income),
      toSom(row.expenses),
      toSom(row.driverShare),
      toSom(row.amortization),
      toSom(row.totalCost),
      toSom(row.profit),
      toSom(row.costPerKm),
      row.roiPercent,
    ]);
    return this.render(title, headers, table, format);
  }

  async exportExpenseStructure(
    rows: ExpenseStructureRow[],
    format: ExportFormat,
    locale: Locale,
  ): Promise<ExportFile> {
    const title = this.i18n.translate('REPORT_EXPENSE_STRUCTURE', locale);
    const headers = STRUCTURE_COLUMNS.map((key) => this.i18n.translate(key, locale));
    const table = rows.map((row) => [
      this.i18n.translate(`EXPENSE_CATEGORY_${row.category}`, locale),
      toSom(row.amount),
      row.sharePercent,
    ]);
    return this.render(title, headers, table, format);
  }

  private async render(
    title: string,
    headers: string[],
    rows: Array<Array<string | number | null>>,
    format: ExportFormat,
  ): Promise<ExportFile> {
    const safeName = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    if (format === 'xlsx') {
      const buffer = await this.renderXlsx(title, headers, rows);
      return {
        buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `${safeName}.xlsx`,
      };
    }
    const buffer = await this.renderPdf(title, headers, rows);
    return { buffer, contentType: 'application/pdf', filename: `${safeName}.pdf` };
  }

  private async renderXlsx(
    title: string,
    headers: string[],
    rows: Array<Array<string | number | null>>,
  ): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(title.slice(0, 31));
    sheet.addRow(headers).font = { bold: true };
    for (const row of rows) sheet.addRow(row.map((cell) => cell ?? '—'));
    sheet.columns.forEach((column, index) => {
      column.width = Math.max(
        headers[index]?.length ?? 10,
        ...rows.map((row) => String(row[index] ?? '').length),
        10,
      );
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private renderPdf(
    title: string,
    headers: string[],
    rows: Array<Array<string | number | null>>,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const tableWidth = doc.page.width - 72;
      const colWidth = tableWidth / headers.length;

      doc.fontSize(14).font('Helvetica-Bold').text(title);
      doc.moveDown(0.5);

      const drawRow = (cells: Array<string | number | null>, bold: boolean) => {
        const y = doc.y;
        // New page when the row would overflow.
        if (y > doc.page.height - 50) doc.addPage();
        const rowY = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        cells.forEach((cell, index) => {
          doc.text(String(cell ?? '—'), 36 + index * colWidth, rowY, {
            width: colWidth - 4,
            lineBreak: false,
          });
        });
        doc.y = rowY + 14;
        doc.x = 36;
      };

      drawRow(headers, true);
      for (const row of rows) drawRow(row, false);
      doc.end();
    });
  }
}
