import { describe, expect, it } from 'vitest';
import { renderCell } from './ReportsPage';

const NBSP = '\u00A0';

describe('renderCell', () => {
  it('renders tiyin as grouped so‘m', () => {
    expect(renderCell('2500000000', 'money')).toBe(`25${NBSP}000${NBSP}000`);
    expect(renderCell('-100000', 'money')).toBe(`-1${NBSP}000`);
  });

  it('renders basis points as a percent', () => {
    expect(renderCell(2336, 'percent')).toBe('23.36%');
  });

  it('renders distances and volumes with their own precision', () => {
    expect(renderCell('1240', 'km')).toBe(`1${NBSP}240,0`);
    expect(renderCell('55.2', 'litres')).toBe('55,20');
  });

  it('shows a dash for missing cells', () => {
    expect(renderCell(null, 'money')).toBe('—');
    expect(renderCell('', 'text')).toBe('—');
  });

  it('passes text through untouched', () => {
    expect(renderCell('Toshkent → Moskva', 'text')).toBe('Toshkent → Moskva');
  });
});
