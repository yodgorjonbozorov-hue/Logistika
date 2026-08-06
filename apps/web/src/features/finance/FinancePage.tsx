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
  Spinner,
  Table,
} from '../../shared/ui';
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
            className={
              tab === key
                ? 'border-b-2 border-accent px-4 py-2 text-sm font-semibold text-accent'
                : 'px-4 py-2 text-sm text-muted hover:text-gray-700 dark:hover:text-gray-200'
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

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('finance.newExpense')}</Button>
      </div>
      <ErrorMessage error={error ?? post.error} />
      {isLoading ? (
        <Spinner />
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
                  {canApprove && !expense.isApproved && (
                    <button
                      className="text-xs font-medium text-success hover:underline"
                      onClick={() => void post.mutateAsync({ id: expense.id, verb: 'approve' })}
                    >
                      {t('finance.approve')}
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
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
          <Field label={t('finance.amount')}>
            <Input inputMode="numeric" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field label={t('finance.date')}>
            <Input type="date" value={form.expenseDate} onChange={set('expenseDate')} required />
          </Field>
          <Field label={t('finance.description')}>
            <Input value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <ErrorMessage error={create.error} />
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
        <Spinner />
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
                  <Select
                    className="w-40"
                    value={income.status}
                    onChange={(e) =>
                      void update.mutateAsync({
                        id: income.id,
                        body: { status: e.target.value },
                      })
                    }
                  >
                    {Object.values(PaymentStatus).map((status) => (
                      <option key={status} value={status}>
                        {t(`finance.paymentStatuses.${status}`)}
                      </option>
                    ))}
                  </Select>{' '}
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
  const [form, setForm] = useState({
    amount: '',
    invoiceNumber: '',
    paymentDate: '',
    status: PaymentStatus.PENDING as PaymentStatus,
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      amount: somToTiyin(form.amount),
      invoiceNumber: form.invoiceNumber || undefined,
      paymentDate: form.paymentDate ? new Date(form.paymentDate).toISOString() : undefined,
      status: form.status,
    });
    onClose();
  }

  return (
    <Modal title={t('finance.newIncome')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('finance.amount')}>
            <Input inputMode="numeric" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field label={t('finance.invoiceNumber')}>
            <Input value={form.invoiceNumber} onChange={set('invoiceNumber')} />
          </Field>
          <Field label={t('finance.paymentDate')}>
            <Input type="date" value={form.paymentDate} onChange={set('paymentDate')} />
          </Field>
          <Field label={t('finance.paymentStatus')}>
            <Select value={form.status} onChange={set('status')}>
              {Object.values(PaymentStatus).map((status) => (
                <option key={status} value={status}>
                  {t(`finance.paymentStatuses.${status}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorMessage error={create.error} />
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
