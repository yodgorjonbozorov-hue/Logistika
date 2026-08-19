import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MonthlyProfitPoint } from 'shared';
import '../../shared/i18n';
import { MonthlyProfitChart } from './MonthlyProfitChart';

const POINTS: MonthlyProfitPoint[] = [
  { month: '2026-06', income: '100000000', expenses: '40000000', profit: '60000000' },
  { month: '2026-07', income: '50000000', expenses: '90000000', profit: '-40000000' },
  { month: '2026-08', income: '0', expenses: '0', profit: '0' },
];

describe('MonthlyProfitChart', () => {
  it('describes itself to assistive tech instead of being a mute picture', () => {
    render(<MonthlyProfitChart points={POINTS} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('3');
  });

  it('carries income and expenses in each bar tooltip — the bar shows only profit', () => {
    const { container } = render(<MonthlyProfitChart points={POINTS} />);
    // formatTiyin groups with a non-breaking space so a figure never wraps.
    const title = container.querySelector('[title^="06.2026"]')!.getAttribute('title')!;
    const plain = title.replace(/\u00A0/g, ' ');
    expect(plain).toContain('1 000 000'); // income, so'm
    expect(plain).toContain('400 000'); // expenses
    expect(plain).toContain('600 000'); // profit
  });

  it('paints a losing month in the danger colour, not the brand colour', () => {
    const { container } = render(<MonthlyProfitChart points={POINTS} />);
    expect(container.querySelector('[title^="06.2026"]')!.className).toContain('bg-brand-primary');
    expect(container.querySelector('[title^="07.2026"]')!.className).toContain('bg-danger');
  });

  it('offers the same numbers as a table for anyone the chart does not serve', () => {
    render(<MonthlyProfitChart points={POINTS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Jadval' }));

    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(4); // header + three months
  });
});
