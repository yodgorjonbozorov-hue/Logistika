import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../i18n';
import { Badge, Button, Cell, LogixaLogo, Row, SegmentedControl, Table } from './index';

describe('Button', () => {
  it('renders a non-submitting button by default', () => {
    render(<Button>Boshlash</Button>);
    expect(screen.getByRole('button', { name: 'Boshlash' })).toHaveProperty('type', 'button');
  });

  it('blocks input and announces itself while loading', () => {
    render(<Button loading>Saqlash</Button>);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps the primary action on the brand colour', () => {
    render(<Button>Yangi reys</Button>);
    expect(screen.getByRole('button').className).toContain('bg-brand-primary');
  });
});

describe('Badge', () => {
  it('shows the live signal dot only when asked', () => {
    const { rerender, container } = render(<Badge tone="orange">Yo&apos;lda</Badge>);
    expect(container.querySelectorAll('span')).toHaveLength(1);
    rerender(
      <Badge tone="orange" dot>
        Yo&apos;lda
      </Badge>,
    );
    expect(container.querySelector('.animate-lx-pulse')).not.toBeNull();
  });
});

describe('Table', () => {
  it('labels each cell with its column so the mobile card view keeps context', () => {
    render(
      <Table headers={['REYS', 'HOLAT']}>
        <Row>
          <Cell>TAS-0147</Cell>
          <Cell>Yo&apos;lda</Cell>
        </Row>
      </Table>,
    );
    const row = screen.getByRole('row', { name: /TAS-0147/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((cell) => cell.getAttribute('data-label'))).toEqual(['REYS', 'HOLAT']);
  });

  it('makes clickable rows reachable by keyboard', () => {
    render(
      <Table headers={['REYS']}>
        <Row onClick={() => undefined}>
          <Cell>TAS-0147</Cell>
        </Row>
      </Table>,
    );
    expect(screen.getByRole('link')).toHaveProperty('tabIndex', 0);
  });
});

describe('SegmentedControl', () => {
  it('marks the selected option for assistive tech', () => {
    render(
      <SegmentedControl
        value="live"
        onChange={() => undefined}
        options={[
          { value: 'live', label: 'Jonli' },
          { value: 'history', label: 'Tarix' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Jonli' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Tarix' }).getAttribute('aria-selected')).toBe('false');
  });
});

describe('LogixaLogo', () => {
  it('draws the brand-board geometry, never a redrawn mark', () => {
    const { container } = render(<LogixaLogo />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toBe('M14 22v26M14 48h28');
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('splits the wordmark so only "AI" carries the accent', () => {
    render(<LogixaLogo variant="wordmark" />);
    expect(screen.getByText('AI').className).toContain('text-brand-primary');
  });
});
