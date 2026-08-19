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
  CurrencyInput,
  EmptyState,
  ErrorMessage,
  Field,
  IconCheck,
  IconPlus,
  Input,
  Modal,
  ModalActions,
  PageHeader,
  Pagination,
  Row,
  Select,
  Spinner,
  Table,
  Tabs,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';

type Tab = 'expenses' | 'incomes';

export function FinancePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('expenses');

  return (
    <div>
      <PageHeader title={t('finance.title')} subtitle={t('finance.subtitle')} />
      <Tabs
        value={tab}
        onChange={setTab}
        options={(['expenses', 'incomes'] as Tab[]).map((key) => ({
          value: key,
          label: t(`finance.${key}`),
        }))}
      />
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
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowForm(true)} icon={<IconPlus size={18} />}>
          {t('finance.newExpense')}
        </Button>
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
                <Cell className="text-ink-secondary">{formatDate(expense.expenseDate)}</Cell>
                <Cell>{t(`finance.categories.${expense.category}`)}</Cell>
                <Cell numeric>{formatTiyin(expense.amount)}</Cell>
                <Cell>{expense.description ?? '—'}</Cell>
                <Cell>
                  <Badge tone={expense.isApproved ? 'green' : 'gray'}>
                    {expense.isApproved ? t('finance.approved') : t('finance.notApproved')}
                  </Badge>
                </Cell>
                <Cell>
                  {canApprove && !expense.isApproved && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<IconCheck size={16} />}
                      onClick={() => void post.mutateAsync({ id: expense.id, verb: 'approve' })}
                    >
                      {t('finance.approve')}
                    </Button>
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
        <div className="grid gap-3 sm:grid-cols-2">
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
            <CurrencyInput
              unit={t('common.som')}
              value={form.amount}
              onChange={set('amount')}
              required
            />
          </Field>
          <Field label={t('finance.date')}>
            <Input type="date" value={form.expenseDate} onChange={set('expenseDate')} required />
          </Field>
          <Field label={t('finance.description')}>
            <Input value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <ErrorMessage error={create.error} />
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </ModalActions>
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
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowForm(true)} icon={<IconPlus size={18} />}>
          {t('finance.newIncome')}
        </Button>
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
                <Cell className="text-ink-secondary">
                  {formatDate(income.paymentDate ?? income.createdAt)}
                </Cell>
                <Cell>{income.invoiceNumber ?? '—'}</Cell>
                <Cell numeric>{formatTiyin(income.amount)}</Cell>
                <Cell>
                  <div className="flex items-center justify-end gap-2">
                    <Badge tone={PAYMENT_TONES[income.status]}>
                      {t(`finance.paymentStatuses.${income.status}`)}
                    </Badge>
                    <Select
                      aria-label={t('finance.paymentStatus')}
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
                    </Select>
                  </div>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('finance.amount')}>
            <CurrencyInput
              unit={t('common.som')}
              value={form.amount}
              onChange={set('amount')}
              required
            />
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
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
