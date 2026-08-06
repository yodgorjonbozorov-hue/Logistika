/** UTC ISO string → local display (rule: store UTC, show local). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** <input type="date"> value → ISO (kept as start of day, local). */
export function dateInputToIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}
