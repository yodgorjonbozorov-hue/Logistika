import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ExpenseCategory, PaymentStatus, UserRole } from 'shared';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { Expense, Income } from '../../shared/api/entities';
import { useAuth } from '../../shared/auth/AuthContext';
import {
  Badge,
  Button,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Row,
  Select,
  Table,
  TableSkeleton,
} from '../../shared/ui';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { useFormErrors } from '../../shared/api/useFormErrors';
import { checkAmount, checkRecordedDate, checkText, problems } from '../../shared/utils/validate';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';

type Tab = 'expenses' | 'incomes';

export function FinancePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('expenses');

  return (
    <div>
      <PageHeader title={t('finance.title')} />
      <div className="mb-3 flex gap-1 border-b border-gray-200 dark:border-white/10">
        {(['expenses', 'incomes'] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            // Which tab is current is otherwise only a colour, which a screen
            // reader cannot see and a colour-blind user may not either.
            aria-pressed={tab === key}
            className={
              tab === key
                ? 'border-b-2 border-accent px-4 py-2 text-sm font-semibold text-accent-text dark:text-accent'
                : 'px-4 py-2 text-sm text-muted-text dark:text-muted hover:text-gray-700 dark:hover:text-gray-200'
            }
          >
            {t(`finance.${key}`)}
          </button>
        ))}
      </div>
      {tab === 'expenses' ? <ExpensesTab /> : <IncomesTab />}
    </div>
  );
}

const PAYMENT_TONES: Record<PaymentStatus, 'gray' | 'blue' | 'green' | 'red'> = {
  PENDING: 'gray',
  PARTIAL: 'blue',
  PAID: 'green',
  OVERDUE: 'red',
};

function ExpensesTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Expense>('expenses', page);
  const { post } = useCrudMutations('expenses');

  const canApprove = user?.role === UserRole.OWNER || user?.role === UserRole.ACCOUNTANT;
  const expenses = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;
  /**
   * Which rows on this page have already been cancelled.
   *
   * The server is still the authority — a unique index refuses a second
   * reversal — but hiding the button for what is visibly done beats offering
   * an action that will only produce an error.
   */
  const reversed = new Set(expenses.map((e) => e.reversalOfId).filter(Boolean));
  const [confirming, setConfirming] = useState<{
    expense: Expense;
    verb: 'approve' | 'reverse';
  } | null>(null);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('finance.newExpense')}</Button>
      </div>
      <ErrorMessage error={error ?? post.error} />
      {isLoading ? (
        <TableSkeleton columns={6} />
      ) : expenses.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[
              t('finance.date'),
              t('finance.category'),
              t('finance.amount'),
              t('finance.description'),
              t('finance.approved'),
              t('common.actions'),
            ]}
          >
            {expenses.map((expense) => (
              <Row key={expense.id}>
                <Cell>{formatDate(expense.expenseDate)}</Cell>
                <Cell>{t(`finance.categories.${expense.category}`)}</Cell>
                <Cell className="tabular-nums">{formatTiyin(expense.amount)}</Cell>
                <Cell>{expense.description ?? '—'}</Cell>
                <Cell>
                  <Badge tone={expense.isApproved ? 'green' : 'gray'}>
                    {expense.isApproved ? t('finance.approved') : t('finance.notApproved')}
                  </Badge>
                </Cell>
                <Cell>
                  {canApprove && !expense.isApproved && !expense.reversalOfId && (
                    <button
                      className="text-xs font-medium text-success-text dark:text-success hover:underline"
                      onClick={() => setConfirming({ expense, verb: 'approve' })}
                    >
                      {t('finance.approve')}
                    </button>
                  )}
                  {/* An approved cost used to have no way back at all: the API
                      could reverse it, nothing in the interface could. */}
                  {canApprove &&
                    expense.isApproved &&
                    !expense.reversalOfId &&
                    !reversed.has(expense.id) && (
                      <button
                        className="text-xs font-medium text-danger-text dark:text-danger hover:underline"
                        onClick={() => setConfirming({ expense, verb: 'reverse' })}
                      >
                        {t('finance.reverse')}
                      </button>
                    )}
                </Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <ExpenseFormModal open={showForm} onClose={() => setShowForm(false)} />
      <ConfirmDialog
        open={confirming !== null}
        title={t(confirming?.verb === 'reverse' ? 'finance.reverseTitle' : 'finance.approveTitle')}
        // The amount and the category are repeated on purpose: "are you sure?"
        // alone is a dialog people learn to dismiss without reading.
        summary={
          confirming && (
            <>
              <span className="font-semibold tabular-nums">
                {formatTiyin(confirming.expense.amount)} {t('common.som')}
              </span>
              {' · '}
              {t(`finance.categories.${confirming.expense.category}`)}
              {confirming.expense.description ? ` · ${confirming.expense.description}` : ''}
            </>
          )
        }
        confirmLabel={t(confirming?.verb === 'reverse' ? 'finance.reverse' : 'finance.approve')}
        tone={confirming?.verb === 'reverse' ? 'danger' : 'primary'}
        reasonLabel={confirming?.verb === 'reverse' ? t('finance.reverseReason') : undefined}
        pending={post.isPending}
        error={post.error}
        onClose={() => setConfirming(null)}
        onConfirm={async (reason) => {
          if (!confirming) return;
          await post.mutateAsync({
            id: confirming.expense.id,
            verb: confirming.verb,
            body: confirming.verb === 'reverse' ? { reason } : {},
          });
          setConfirming(null);
        }}
      />
    </div>
  );
}

function ExpenseFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('expenses');
  const [form, setForm] = useState({
    category: ExpenseCategory.FUEL as ExpenseCategory,
    amount: '',
    description: '',
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const errors = useFormErrors(create.error);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Checked before the round trip, and again by the server afterwards: this
    // is a courtesy, not the rule (see validate.ts).
    const found = problems({
      amount: checkAmount(form.amount),
      expenseDate: checkRecordedDate(form.expenseDate),
      description: checkText(form.description, { max: 1000 }),
    });
    if (!errors.check(found)) return;

    await create.mutateAsync({
      category: form.category,
      amount: somToTiyin(form.amount),
      description: form.description || undefined,
      expenseDate: new Date(form.expenseDate).toISOString(),
    });
    onClose();
  }

  return (
    <Modal title={t('finance.newExpense')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('finance.category')}>
            <Select value={form.category} onChange={set('category')}>
              {Object.values(ExpenseCategory).map((category) => (
                <option key={category} value={category}>
                  {t(`finance.categories.${category}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('finance.amount')}
            hint={t('finance.amountHint')}
            error={errors.of('amount')}
          >
            <MoneyInput
              value={form.amount}
              onChange={(digits) => setForm((f) => ({ ...f, amount: digits }))}
            />
          </Field>
          <Field label={t('finance.date')} error={errors.of('expenseDate')}>
            <Input type="date" value={form.expenseDate} onChange={set('expenseDate')} />
          </Field>
          <Field label={t('finance.description')} error={errors.of('description')}>
            <Input value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <ErrorMessage error={create.error} only={errors.general} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function IncomesTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Income>('incomes', page);
  const { update } = useCrudMutations('incomes');

  const incomes = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('finance.newIncome')}</Button>
      </div>
      <ErrorMessage error={error ?? update.error} />
      {isLoading ? (
        <TableSkeleton columns={6} />
      ) : incomes.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[
              t('finance.date'),
              t('finance.invoiceNumber'),
              t('finance.amount'),
              t('finance.paymentStatus'),
            ]}
          >
            {incomes.map((income) => (
              <Row key={income.id}>
                <Cell>{formatDate(income.paymentDate ?? income.createdAt)}</Cell>
                <Cell>{income.invoiceNumber ?? '—'}</Cell>
                <Cell className="tabular-nums">{formatTiyin(income.amount)}</Cell>
                <Cell>
                  {/* Read-only: the status follows the ledger (how much of the
                      trip's invoice is covered), so it cannot be set by hand. */}
                  <Badge tone={PAYMENT_TONES[income.status]}>
                    {t(`finance.paymentStatuses.${income.status}`)}
                  </Badge>
                </Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <IncomeFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function IncomeFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('incomes');
  // No status field: it is derived from the ledger (BUSINESS-RULES §1). The
  // picker that used to be here was ignored by the server, and since M-22 it
  // is refused outright.
  const [form, setForm] = useState({ amount: '', invoiceNumber: '', paymentDate: '' });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const errors = useFormErrors(create.error);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = problems({
      amount: checkAmount(form.amount),
      paymentDate: checkRecordedDate(form.paymentDate, { required: false }),
      invoiceNumber: checkText(form.invoiceNumber, { max: 100 }),
    });
    if (!errors.check(found)) return;

    await create.mutateAsync({
      amount: somToTiyin(form.amount),
      invoiceNumber: form.invoiceNumber || undefined,
      paymentDate: form.paymentDate ? new Date(form.paymentDate).toISOString() : undefined,
    });
    onClose();
  }

  return (
    <Modal title={t('finance.newIncome')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('finance.amount')}
            hint={t('finance.amountHint')}
            error={errors.of('amount')}
          >
            <MoneyInput
              value={form.amount}
              onChange={(digits) => setForm((f) => ({ ...f, amount: digits }))}
            />
          </Field>
          <Field label={t('finance.invoiceNumber')} error={errors.of('invoiceNumber')}>
            <Input value={form.invoiceNumber} onChange={set('invoiceNumber')} />
          </Field>
          <Field label={t('finance.paymentDate')} error={errors.of('paymentDate')}>
            <Input type="date" value={form.paymentDate} onChange={set('paymentDate')} />
          </Field>
        </div>
        <ErrorMessage error={create.error} only={errors.general} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
