/**
 * A report is a plain table: typed columns + rows. The same structure feeds the
 * W-9 screen and the Excel/CSV export, so the numbers can never drift apart.
 *
 * Column labels are i18n KEYS — the web renders them, the export translates them
 * with the backend I18nService (CLAUDE.md: no hardcoded user-facing text).
 */
import { fromScaledInt } from '../../common/money';

export type ReportColumnType = 'text' | 'date' | 'number' | 'money' | 'litres' | 'km' | 'percent';

export interface ReportColumn {
  key: string;
  labelKey: string;
  type: ReportColumnType;
}

export type ReportCell = string | number | bigint | Date | null | undefined;

export interface ReportTable {
  key: string;
  titleKey: string;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  /** Optional summary row (same keys as the columns). */
  totals?: Record<string, ReportCell>;
}

/** Money leaves the API as tiyin; a spreadsheet wants so'm with two decimals. */
export function cellToText(value: ReportCell, type: ReportColumnType): string {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'money':
      return fromScaledInt(BigInt(value as string | bigint), 2);
    case 'percent':
      // Basis points → percent with two decimals.
      return fromScaledInt(BigInt(value as number), 2);
    case 'date':
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    default:
      return String(value);
  }
}

const CSV_SEPARATOR = ';';

function csvEscape(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CSV for the «open it in Excel right now» case. Semicolon-separated and
 * BOM-prefixed, which is what Excel expects for UTF-8 in the CIS locales.
 */
export function toCsv(table: ReportTable, translate: (key: string) => string): string {
  const lines: string[] = [];
  lines.push(
    table.columns.map((column) => csvEscape(translate(column.labelKey))).join(CSV_SEPARATOR),
  );
  for (const row of table.rows) {
    lines.push(
      table.columns
        .map((column) => csvEscape(cellToText(row[column.key], column.type)))
        .join(CSV_SEPARATOR),
    );
  }
  if (table.totals) {
    lines.push(
      table.columns
        .map((column) => csvEscape(cellToText(table.totals?.[column.key], column.type)))
        .join(CSV_SEPARATOR),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Numeric cell value for a spreadsheet, or text when the column is not numeric. */
export function cellToXlsx(
  value: ReportCell,
  type: ReportColumnType,
): string | number | Date | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    // Presentation boundary: money becomes a spreadsheet number so it can be
    // summed there. Everything inside the system stays BigInt tiyin.
    case 'money':
    case 'percent':
      return Number(cellToText(value, type));
    case 'number':
    case 'litres':
    case 'km':
      return Number(value);
    case 'date':
      return value instanceof Date ? value : new Date(String(value));
    default:
      return String(value);
  }
}

export const XLSX_NUMBER_FORMATS: Partial<Record<ReportColumnType, string>> = {
  money: '#,##0.00',
  percent: '0.00"%"',
  litres: '#,##0.00',
  km: '#,##0.0',
  number: '#,##0',
  date: 'dd.mm.yyyy',
};
