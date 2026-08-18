import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorMessage, Field, Input, Modal } from './index';

/**
 * A stop between "I clicked" and "the money moved" (TASK-5.2, M-14).
 *
 * Approving an expense used to happen on a single click with nothing shown
 * back: no amount, no confirmation, and — until the reverse flow existed — no
 * way to undo it either. Money changes are exactly the actions where a
 * misclick is expensive and a second of friction is cheap.
 *
 * The summary is not decorative: it repeats **what** and **how much**, because
 * "are you sure?" on its own is a dialog people learn to dismiss without
 * reading.
 */
export function ConfirmDialog({
  open,
  title,
  summary,
  confirmLabel,
  tone = 'primary',
  reasonLabel,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  /** What is about to change, in words and numbers. */
  summary: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** When set, a non-empty reason is required before confirming. */
  reasonLabel?: string;
  pending?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Guarded here as well as by the disabled button: a double-tap can land a
    // second submit before React has re-rendered the first one's pending state.
    if (pending) return;
    await onConfirm(reason.trim());
    setReason('');
  }

  const blocked = pending || (reasonLabel !== undefined && reason.trim().length === 0);

  return (
    <Modal title={title} open={open} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm dark:bg-white/5">{summary}</div>
        {reasonLabel !== undefined && (
          <Field label={reasonLabel}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              autoFocus
            />
          </Field>
        )}
        <ErrorMessage error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={blocked}
          >
            {pending ? t('common.saving') : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
