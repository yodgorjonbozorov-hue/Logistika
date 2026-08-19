/**
 * The mobile kit's behaviour, not its pixels — the pixels are checked in a real
 * browser at every required width by the responsive audit.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardList, FilterButton, ListCard, ListState, MetaItem, Sheet } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Sheet', () => {
  it('renders nothing until it is opened', () => {
    const { container } = render(
      <Sheet open={false} onClose={() => undefined} title="Filtrlar">
        body
      </Sheet>,
    );
    expect(container.querySelector('.sheet')).toBeNull();
  });

  it('closes on Escape, on the backdrop, and on its close button', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <Sheet open onClose={onClose} title="Filtrlar">
        body
      </Sheet>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.sheet-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByLabelText('common.close'));
    expect(onClose).toHaveBeenCalledTimes(3);

    // A tap inside the panel must not fall through to the backdrop.
    fireEvent.click(container.querySelector('.sheet')!);
    expect(onClose).toHaveBeenCalledTimes(3);

    rerender(
      <Sheet open={false} onClose={onClose} title="Filtrlar">
        body
      </Sheet>,
    );
  });

  it('locks the page behind it and gives the scroll back on close', () => {
    const { rerender } = render(
      <Sheet open onClose={() => undefined}>
        body
      </Sheet>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Sheet open={false} onClose={() => undefined}>
        body
      </Sheet>,
    );
    expect(document.body.style.overflow).toBe('');
  });
});

describe('FilterButton', () => {
  it('shows no badge until a filter is active', () => {
    const { rerender, container } = render(<FilterButton count={0} onClick={() => undefined} />);
    expect(container.textContent).toBe('common.filters');

    rerender(<FilterButton count={3} onClick={() => undefined} />);
    expect(container.textContent).toContain('3');
  });

  it('opens the sheet when tapped', () => {
    const onClick = vi.fn();
    render(<FilterButton count={0} onClick={onClick} />);
    fireEvent.click(screen.getByLabelText('common.filters'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ListState', () => {
  const rows = <div>rows</div>;

  it('shows a skeleton while loading, before anything else', () => {
    const { container } = render(
      <ListState isLoading error={new Error('x')} isEmpty>
        {rows}
      </ListState>,
    );
    expect(container.querySelectorAll('.skel').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('rows');
  });

  it('offers a retry when the load failed', () => {
    const onRetry = vi.fn();
    render(
      <ListState isLoading={false} error={new Error('tarmoq uzildi')} isEmpty onRetry={onRetry}>
        {rows}
      </ListState>,
    );
    expect(screen.getByText('tarmoq uzildi')).toBeTruthy();
    fireEvent.click(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('explains an empty list rather than rendering nothing', () => {
    const { container } = render(
      <ListState isLoading={false} error={null} isEmpty>
        {rows}
      </ListState>,
    );
    expect(container.textContent).toContain('common.empty');
  });

  it('renders the rows once there are some', () => {
    const { container } = render(
      <ListState isLoading={false} error={null} isEmpty={false}>
        {rows}
      </ListState>,
    );
    expect(container.textContent).toBe('rows');
  });
});

describe('ListCard', () => {
  it('is a button only when it leads somewhere', () => {
    const { container, rerender } = render(<ListCard title="TR-1" />);
    expect(container.querySelector('button')).toBeNull();

    const onClick = vi.fn();
    rerender(<ListCard title="TR-1" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('lays the record out title-first, with its meta pairs below', () => {
    render(
      <CardList>
        <ListCard
          title="TR-2026-0042"
          subtitle="Toshkent → Nukus"
          trailing={<span>Yo'lda</span>}
          meta={
            <>
              <MetaItem label="Mashina">01 A 512 BC</MetaItem>
              <MetaItem label="Haydovchi">Alisher Qodirov</MetaItem>
            </>
          }
        />
      </CardList>,
    );
    expect(screen.getByText('TR-2026-0042')).toBeTruthy();
    expect(screen.getByText('Toshkent → Nukus')).toBeTruthy();
    expect(screen.getByText("Yo'lda")).toBeTruthy();
    expect(screen.getByText('01 A 512 BC')).toBeTruthy();
    expect(screen.getByText('Alisher Qodirov')).toBeTruthy();
  });
});
