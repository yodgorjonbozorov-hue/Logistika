/**
 * CSV export, done in the browser from the rows already on screen.
 *
 * No endpoint is involved: the screens fetch a company's whole working set
 * anyway (5–40 vehicles, per the TZ), so a server round trip would produce the
 * same bytes a second time.
 */

/** One column: its header, and how to read it off a row. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/**
 * Quotes a field the way Excel expects, and defuses formula injection: a value
 * starting with `= + - @` is executed by Excel and Sheets when the file is
 * opened, so it gets a leading apostrophe.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows and headers as one CSV document. */
export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  }
  return lines.join('\r\n');
}

/** `trips-2026-08-19.csv` — dated, so repeated exports do not overwrite. */
export function csvFilename(base: string, on: Date = new Date()): string {
  return `${base}-${on.toISOString().slice(0, 10)}.csv`;
}

/**
 * Hands the file to the browser. The BOM is what makes Excel read the UTF-8 —
 * without it O'zbek and Russian text arrive as mojibake.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: Safari has not finished reading it synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Build and download in one call — what every export button does. */
export function exportCsv<T>(
  base: string,
  rows: readonly T[],
  columns: ReadonlyArray<CsvColumn<T>>,
): void {
  downloadCsv(csvFilename(base), toCsv(rows, columns));
}
