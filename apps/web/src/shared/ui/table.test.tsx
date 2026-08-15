import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cell, Row, Table } from './index';

/**
 * The phone layout draws each cell caption from `data-label`, so the header →
 * cell wiring is what makes a table readable on a 360px screen.
 */
describe('Table', () => {
  it('labels every cell with its column header', () => {
    render(
      <Table headers={['Mashina', 'Probeg', 'Farq']}>
        <Row>
          <Cell>01 A 123 AA</Cell>
          <Cell>1240</Cell>
          <Cell>+55.2</Cell>
        </Row>
      </Table>,
    );

    expect(screen.getByText('01 A 123 AA').getAttribute('data-label')).toBe('Mashina');
    expect(screen.getByText('1240').getAttribute('data-label')).toBe('Probeg');
    expect(screen.getByText('+55.2').getAttribute('data-label')).toBe('Farq');
  });

  it('leaves an action column without a caption when its header is empty', () => {
    render(
      <Table headers={['Mashina', '']}>
        <Row>
          <Cell>01 A 123 AA</Cell>
          <Cell>
            <button>Tasdiqlash</button>
          </Cell>
        </Row>
      </Table>,
    );

    const actionCell = screen.getByRole('button', { name: 'Tasdiqlash' }).closest('td');
    expect(actionCell?.getAttribute('data-label')).toBe('');
  });

  it('keeps an explicit label when a cell sets one itself', () => {
    render(
      <Table headers={['A', 'B']}>
        <Row>
          <Cell label="Custom">x</Cell>
          <Cell>y</Cell>
        </Row>
      </Table>,
    );

    expect(screen.getByText('x').getAttribute('data-label')).toBe('Custom');
    expect(screen.getByText('y').getAttribute('data-label')).toBe('B');
  });
});
