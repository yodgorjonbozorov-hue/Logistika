import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * Approving an expense used to happen on a single click with nothing shown
 * back: no amount, no confirmation, and no way to undo it (M-14, TASK-5.2).
 */
describe('ConfirmDialog', () => {
  const setup = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Confirm"
        summary={<span>4 197 800 so'm · FUEL</span>}
        confirmLabel="Approve"
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />,
    );
    return { onConfirm, onClose };
  };

  it('repeats what is about to change, not just "are you sure"', () => {
    setup();
    // A dialog that says nothing specific is one people learn to dismiss
    // without reading.
    expect(screen.getByText("4 197 800 so'm · FUEL")).toBeTruthy();
  });

  it('confirms with no reason when none is asked for', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByText('Approve'));

    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('will not confirm until a required reason is given', () => {
    const { onConfirm } = setup({ reasonLabel: 'Reason' });
    const button = screen.getByText('Approve') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('passes the reason through once it is filled in', async () => {
    const { onConfirm } = setup({ reasonLabel: 'Reason' });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  wrong receipt  ' } });
    // Awaited: the handler clears the field after the confirm resolves, and an
    // unawaited state update is a warning that hides real ones.
    await act(async () => {
      fireEvent.click(screen.getByText('Approve'));
    });

    // Trimmed: a reason of three spaces explains nothing months later.
    expect(onConfirm).toHaveBeenCalledWith('wrong receipt');
  });

  it('treats whitespace as no reason at all', () => {
    const { onConfirm } = setup({ reasonLabel: 'Reason' });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Approve'));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('blocks a second submit while the first is in flight', () => {
    const { onConfirm } = setup({ pending: true });
    const button = screen.getByText('common.saving') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal instead of closing silently', () => {
    setup({ error: new Error('already reversed') });
    expect(screen.getByText('already reversed')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Confirm"
        summary="x"
        confirmLabel="Approve"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Confirm')).toBeNull();
  });
});
