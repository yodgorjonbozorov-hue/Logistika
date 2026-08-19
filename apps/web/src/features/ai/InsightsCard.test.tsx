/**
 * The dashboard's insight strip.
 *
 * Its whole contract is that it is an EXTRA: it renders the backend's typed
 * insights through this app's i18n, and it renders nothing at all — never an
 * error, never a placeholder — when there is nothing to say or when the request
 * fails. The dashboard's own figures are the page.
 *
 * The query hook is stubbed rather than the HTTP client: what is under test is
 * how the component reacts to each query state, and driving those states
 * through a real fetch only adds an in-flight rejection to reason about.
 */
import { render, screen } from '@testing-library/react';
import type { AiInsight } from 'shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../shared/i18n';

const useAiInsights = vi.fn();
vi.mock('./api', () => ({ useAiInsights: () => useAiInsights() }));

const { InsightsCard } = await import('./InsightsCard');

const state = (over: Record<string, unknown>) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  ...over,
});

const FUEL: AiInsight = {
  kind: 'FUEL_ANOMALY',
  severity: 'warning',
  params: { plate: '01A111AA', deviation: '18 %', consumption: '35,40', norm: '30,00' },
};
const ROUTE: AiInsight = {
  kind: 'TOP_ROUTE',
  severity: 'good',
  params: { route: 'Toshkent-Samarqand', profit: '6 000 000', margin: '66,7 %', trips: '2' },
};

describe('InsightsCard', () => {
  beforeEach(() => useAiInsights.mockReset());

  it('renders each insight through i18n, with the backend’s own figures', () => {
    useAiInsights.mockReturnValue(state({ data: [FUEL, ROUTE] }));
    render(<InsightsCard />);

    expect(screen.getByText(/01A111AA normadan 18 % ko'p/)).toBeDefined();
    expect(screen.getByText(/35,40/)).toBeDefined();
    expect(screen.getByText(/Toshkent-Samarqand yo'nalishi eng yuqori foyda/)).toBeDefined();
    // No raw i18n key ever reaches the screen.
    expect(screen.queryByText(/ai\.insights\./)).toBeNull();
  });

  it('marks a warning and a good insight differently', () => {
    useAiInsights.mockReturnValue(state({ data: [FUEL, ROUTE] }));
    const { container } = render(<InsightsCard />);
    expect(container.querySelectorAll('.border-danger\\/40')).toHaveLength(1);
    expect(container.querySelectorAll('.border-success\\/40')).toHaveLength(1);
  });

  it('renders nothing when the backend says there is nothing to say', () => {
    useAiInsights.mockReturnValue(
      state({ data: [{ kind: 'NO_DATA', severity: 'info', params: {} }] }),
    );
    const { container } = render(<InsightsCard />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the list is empty', () => {
    useAiInsights.mockReturnValue(state({ data: [] }));
    const { container } = render(<InsightsCard />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the request failed — an extra must not break the page', () => {
    useAiInsights.mockReturnValue(state({ isError: true }));
    const { container } = render(<InsightsCard />);
    expect(container.innerHTML).toBe('');
  });

  it('shows a loading line rather than an empty box while it loads', () => {
    useAiInsights.mockReturnValue(state({ isLoading: true }));
    render(<InsightsCard />);
    expect(screen.getByText("Ma'lumotlar tahlil qilinmoqda…")).toBeDefined();
  });
});
