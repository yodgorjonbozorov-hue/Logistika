import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Currency, ExpenseCategory, PaymentStatus } from 'shared';
import { api } from '../../shared/api/client';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { Expense, FinanceReport, Income } from '../../shared/api/entities';
import { useAuth } from '../../shared/auth/AuthContext';
import { can } from '../../shared/auth/permissions';
import {
  Badge,
  Button,
  DataTable,
  ErrorMessage,
  Field,
  Input,
  KpiCard,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Tabs,
  type Column,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';
import { useRefLists } from '../trips/api';

type Tab = 'expenses' | 'incomes';

const PAYMENT_TONES: Record<PaymentStatus, 'gray' | 'blue' | 'green' | 'red'> = {
  PENDING: 'gray',
  PARTIAL: 'blue',
  PAID: 'green',
  OVERDUE: 'red',
};

export function FinancePage() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const [tab, setTab] = useState<Tab>('expenses');

  // Accountants and owners see the period totals; a logist only records rows.
  const canSeeTotals = can(role, 'approveExpense');
  const report = useQuery({
    queryKey: ['reports', 'finance', 'current'],
    queryFn: async () => (await api<FinanceReport>('/reports/finance')).data,
    enabled: canSeeTotals,
  });

  return (
    <div>
      <PageHeader title={t('finance.title')} subtitle={t('finance.subtitle')} />

      {canSeeTotals ? (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {report.isLoading || !report.data ? (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </>
          ) : (
            <>
              <KpiCard
                label={t('finance.totalIncome')}
                value={formatTiyin(report.data.incomeTotal)}
                hint={t('common.som')}
                tone="success"
              />
              <KpiCard
                label={t('finance.totalExpense')}
                value={formatTiyin(report.data.expenseTotal)}
                hint={t('common.som')}
                tone="danger"
              />
              <KpiCard
                label={t('finance.net')}
                value={formatTiyin(report.data.net)}
                hint={t('finance.pnlNote')}
                tone={BigInt(report.data.net) >= 0n ? 'success' : 'danger'}
              />
            </>
          )}
        </div>
      ) : null}

      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'expenses', label: t('finance.expenses') },
          { key: 'incomes', label: t('finance.incomes') },
        ]}
      />

      {tab === 'expenses' ? <ExpensesTab /> : <IncomesTab />}
    </div>
  );
}

function ExpensesTab() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Expense>('expenses', page);
  const { post } = useCrudMutations('expenses');

  const canApprove = can(role, 'approveExpense');
  const total = data?.meta?.pagination?.total ?? 0;

  const columns: Array<Column<Expense>> = [
    {
      key: 'date',
      header: t('finance.date'),
      primary: true,
      cell: (expense) => formatDate(expense.expenseDate),
    },
    {
      key: 'status',
      header: t('finance.paymentStatus'),
      secondary: true,
      cell: (expense) => (
        <Badge tone={expense.isApproved ? 'green' : 'gray'}>
          {expense.isApproved ? t('finance.approved') : t('finance.notApproved')}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: t('finance.category'),
      cell: (expense) => t(`finance.categories.${expense.category}`),
    },
    {
      key: 'amount',
      header: t('finance.amount'),
      className: 'money',
      cell: (expense) => `${formatTiyin(expense.amount)} ${expense.currency}`,
    },
    {
      key: 'description',
      header: t('finance.description'),
      cell: (expense) => expense.description ?? '—',
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (expense) =>
        canApprove && !expense.isApproved ? (
          <button
            className="text-xs font-medium text-success hover:underline"
            onClick={() => void post.mutateAsync({ id: expense.id, verb: 'approve' })}
          >
            {t('finance.approve')}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('finance.newExpense')}</Button>
      </div>
      <ErrorMessage error={error ?? post.error} />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <DataTable rows={data?.data ?? []} columns={columns} getKey={(expense) => expense.id} />
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
  const { vehicles, drivers } = useRefLists();
  const trips = useQuery({
    queryKey: ['trips', { limit: 100, forFinance: true }],
    queryFn: async () =>
      (await api<import('../../shared/api/entities').Trip[]>('/trips', { query: { limit: 100 } }))
        .data,
    enabled: open,
  });

  const [form, setForm] = useState({
    category: ExpenseCategory.FUEL as ExpenseCategory,
    amount: '',
    currency: Currency.UZS as Currency,
    quantity: '',
    unitPrice: '',
    tripId: '',
    vehicleId: '',
    driverId: '',
    description: '',
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setInvalid(null);
    const amount = somToTiyin(form.amount);
    const unitPrice = form.unitPrice ? somToTiyin(form.unitPrice) : undefined;
    if (!amount || (form.unitPrice && !unitPrice)) {
      setInvalid(t('common.errorGeneric'));
      return;
    }
    await create.mutateAsync({
      category: form.category,
      amount,
      currency: form.currency,
      quantity: form.quantity ? Number(form.quantity) : undefined,
      unitPrice,
      tripId: form.tripId || undefined,
      vehicleId: form.vehicleId || undefined,
      driverId: form.driverId || undefined,
      description: form.description || undefined,
      expenseDate: new Date(form.expenseDate).toISOString(),
    });
    onClose();
  }

  return (
    <Modal title={t('finance.newExpense')} open={open} onClose={onClose} wide>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('finance.category')} required>
            <Select value={form.category} onChange={set('category')}>
              {Object.values(ExpenseCategory).map((category) => (
                <option key={category} value={category}>
                  {t(`finance.categories.${category}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('finance.amount')} required>
            <Input inputMode="numeric" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field label={t('finance.currency')}>
            <Select value={form.currency} onChange={set('currency')}>
              {Object.values(Currency).map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('finance.quantity')}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.quantity}
              onChange={set('quantity')}
            />
          </Field>
          <Field label={t('finance.unitPrice')}>
            <Input inputMode="numeric" value={form.unitPrice} onChange={set('unitPrice')} />
          </Field>
          <Field label={t('finance.date')} required>
            <Input type="date" value={form.expenseDate} onChange={set('expenseDate')} required />
          </Field>
          <Field label={t('finance.trip')}>
            <Select value={form.tripId} onChange={set('tripId')}>
              <option value="">{t('common.select')}</option>
              {(trips.data ?? []).map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.tripNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('finance.vehicle')}>
            <Select value={form.vehicleId} onChange={set('vehicleId')}>
              <option value="">{t('common.select')}</option>
              {(vehicles.data ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plateNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('finance.driver')}>
            <Select value={form.driverId} onChange={set('driverId')}>
              <option value="">{t('common.select')}</option>
              {(drivers.data ?? []).map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('finance.description')}>
          <Input value={form.description} onChange={set('description')} />
        </Field>
        <ErrorMessage error={invalid ? new Error(invalid) : create.error} />
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

  const total = data?.meta?.pagination?.total ?? 0;

  const columns: Array<Column<Income>> = [
    {
      key: 'date',
      header: t('finance.date'),
      primary: true,
      cell: (income) => formatDate(income.paymentDate ?? income.createdAt),
    },
    {
      key: 'status',
      header: t('finance.paymentStatus'),
      secondary: true,
      cell: (income) => (
        <Badge tone={PAYMENT_TONES[income.status]}>
          {t(`finance.paymentStatuses.${income.status}`)}
        </Badge>
      ),
    },
    {
      key: 'invoice',
      header: t('finance.invoiceNumber'),
      cell: (income) => income.invoiceNumber ?? '—',
    },
    {
      key: 'amount',
      header: t('finance.amount'),
      className: 'money',
      cell: (income) => `${formatTiyin(income.amount)} ${income.currency}`,
    },
    {
      key: 'change',
      header: t('common.actions'),
      desktopOnly: true,
      cell: (income) => (
        <Select
          className="w-40"
          value={income.status}
          aria-label={t('finance.paymentStatus')}
          onChange={(event) =>
            void update.mutateAsync({ id: income.id, body: { status: event.target.value } })
          }
        >
          {Object.values(PaymentStatus).map((status) => (
            <option key={status} value={status}>
              {t(`finance.paymentStatuses.${status}`)}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('finance.newIncome')}</Button>
      </div>
      <ErrorMessage error={error ?? update.error} />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <DataTable rows={data?.data ?? []} columns={columns} getKey={(income) => income.id} />
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
  const { clients } = useRefLists();
  const trips = useQuery({
    queryKey: ['trips', { limit: 100, forFinance: true }],
    queryFn: async () =>
      (await api<import('../../shared/api/entities').Trip[]>('/trips', { query: { limit: 100 } }))
        .data,
    enabled: open,
  });

  const [form, setForm] = useState({
    amount: '',
    currency: Currency.UZS as Currency,
    clientId: '',
    tripId: '',
    invoiceNumber: '',
    paymentDate: '',
    status: PaymentStatus.PENDING as PaymentStatus,
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setInvalid(null);
    const amount = somToTiyin(form.amount);
    if (!amount) {
      setInvalid(t('common.errorGeneric'));
      return;
    }
    await create.mutateAsync({
      amount,
      currency: form.currency,
      clientId: form.clientId || undefined,
      tripId: form.tripId || undefined,
      invoiceNumber: form.invoiceNumber || undefined,
      paymentDate: form.paymentDate ? new Date(form.paymentDate).toISOString() : undefined,
      status: form.status,
    });
    onClose();
  }

  return (
    <Modal title={t('finance.newIncome')} open={open} onClose={onClose} wide>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('finance.amount')} required>
            <Input inputMode="numeric" value={form.amount} onChange={set('amount')} required />
          </Field>
          <Field label={t('finance.currency')}>
            <Select value={form.currency} onChange={set('currency')}>
              {Object.values(Currency).map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
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
          <Field label={t('finance.client')}>
            <Select value={form.clientId} onChange={set('clientId')}>
              <option value="">{t('common.select')}</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('finance.trip')}>
            <Select value={form.tripId} onChange={set('tripId')}>
              <option value="">{t('common.select')}</option>
              {(trips.data ?? []).map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.tripNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('finance.invoiceNumber')}>
            <Input value={form.invoiceNumber} onChange={set('invoiceNumber')} />
          </Field>
          <Field label={t('finance.paymentDate')}>
            <Input type="date" value={form.paymentDate} onChange={set('paymentDate')} />
          </Field>
        </div>
        <ErrorMessage error={invalid ? new Error(invalid) : create.error} />
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
