import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * The dialog was a `div` over the page (L-10, TASK-5.5): Tab walked straight
 * out of it into the form behind, a screen reader was told nothing about it,
 * and closing it dropped focus back to the top of the document.
 */
function open(onClose = vi.fn()) {
  render(
    <Modal title="Confirm" open onClose={onClose}>
      <input aria-label="first" />
      <input aria-label="second" />
      <button>save</button>
    </Modal>,
  );
  return { onClose };
}

describe('Modal', () => {
  it('announces itself as a dialog with a name', () => {
    open();
    const dialog = screen.getByRole('dialog');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Named by its own heading, so a screen reader says what the dialog is
    // rather than "dialog".
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      screen.getByText('Confirm').getAttribute('id'),
    );
  });

  it('puts focus on the first thing inside it', () => {
    open();
    expect(document.activeElement).toBe(screen.getByLabelText('first'));
  });

  it('wraps Tab from the last control back to the first', () => {
    open();
    screen.getByText('save').focus();

    fireEvent.keyDown(window, { key: 'Tab' });

    // Leaving the dialog with Tab is how a keyboard user ends up typing into
    // the form they cannot see.
    expect(document.activeElement).toBe(screen.getByLabelText('first'));
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    open();
    screen.getByLabelText('first').focus();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(screen.getByText('save'));
  });

  it('leaves Tab alone in the middle of the dialog', () => {
    open();
    screen.getByLabelText('first').focus();

    fireEvent.keyDown(window, { key: 'Tab' });

    // The browser's own order is correct here; only the edges need help.
    expect(document.activeElement).toBe(screen.getByLabelText('first'));
  });

  it('closes on Escape', () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('gives focus back to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <Modal title="Confirm" open onClose={vi.fn()}>
        <input aria-label="only" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('only'));

    unmount();

    // Otherwise a keyboard user starts the page again from the top.
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('renders nothing when closed', () => {
    render(
      <Modal title="Confirm" open={false} onClose={vi.fn()}>
        <input aria-label="hidden" />
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Table', () => {
  it('marks every header as heading its column', async () => {
    const { Table, Row, Cell } = await import('./index');
    render(
      <Table headers={['Sana', 'Summa']}>
        <Row>
          <Cell>1</Cell>
          <Cell>2</Cell>
        </Row>
      </Table>,
    );

    // Without `scope` the table is read as a grid of loose values.
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.getAttribute('scope')).toBe('col');
    }
  });
});
