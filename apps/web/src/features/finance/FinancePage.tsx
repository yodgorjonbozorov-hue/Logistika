import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ExpenseCategory, PaymentStatus, UserRole } from 'shared';
import { useCrudMutations } from '../../shared/api/crud';
import { useAllTrips, useClients, useExpenses, useIncomes } from '../../shared/api/queries';
import { useAuth } from '../../shared/auth/AuthContext';
import {
  Button,
  Card,
  CardLabel,
  CardList,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Icon,
  Input,
  ListCard,
  ListState,
  MetaItem,
  Modal,
  PageHeader,
  Row,
  Segmented,
  Select,
  Spinner,
  StatusChip,
  Table,
} from '../../shared/ui';
import { exportCsv } from '../../shared/utils/csv';
import { formatDate } from '../../shared/utils/date';
import { formatMillionsTiyin, formatTiyin, somToTiyin } from '../../shared/utils/money';
import { PAYMENT_STATUS_TONE } from '../../shared/utils/status';
import { incomeTotals } from '../overview/metrics';

type Tab = 'incomes' | 'expenses';

/** Category → Phosphor glyph, matching the design's expense rows. */
const CATEGORY_ICONS: Record<ExpenseCategory, string> = {
  [ExpenseCategory.FUEL]: 'gas-pump',
  [ExpenseCategory.TOLL]: 'road-horizon',
  [ExpenseCategory.CUSTOMS]: 'stamp',
  [ExpenseCategory.REPAIR]: 'wrench',
  [ExpenseCategory.PARTS]: 'gear',
  [ExpenseCategory.FINE]: 'warning-octagon',
  [ExpenseCategory.PARKING]: 'car-profile',
  [ExpenseCategory.SALARY]: 'hand-coins',
  [ExpenseCategory.INSURANCE]: 'shield-check',
  [ExpenseCategory.TAX]: 'bank',
  [ExpenseCategory.OTHER]: 'dots-three-circle',
};

export function FinancePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('incomes');
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  const incomes = useIncomes();
  const totals = useMemo(() => incomeTotals(incomes.data ?? []), [incomes.data]);

  return (
    <div>
      <PageHeader
        title={t('finance.title')}
        subtitle={t('finance.subtitle')}
        actions={
          <>
            <Button
              icon="plus"
              onClick={() =>
                tab === 'incomes' ? setShowIncomeForm(true) : setShowExpenseForm(true)
              }
            >
              {tab === 'incomes' ? t('finance.newIncome') : t('finance.newExpense')}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 md:gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MoneyCard label={t('finance.totalRevenue')} amount={totals.total} />
        <MoneyCard
          label={t('finance.paymentStatuses.PAID')}
          amount={totals.paid}
          color="var(--color-positive-text)"
        />
        <MoneyCard
          label={t('finance.paymentStatuses.PENDING')}
          amount={totals.pending}
          color="var(--color-warning-text)"
        />
        <MoneyCard
          label={t('finance.paymentStatuses.OVERDUE')}
          amount={totals.overdue}
          color="var(--color-danger-text)"
        />
      </div>

      <Segmented<Tab>
        className="mb-3.5 text-[13px]"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'incomes', label: t('finance.incomes') },
          { value: 'expenses', label: t('finance.expenses') },
        ]}
      />

      {tab === 'incomes' ? <IncomesTab /> : <ExpensesTab />}

      <IncomeFormModal open={showIncomeForm} onClose={() => setShowIncomeForm(false)} />
      <ExpenseFormModal open={showExpenseForm} onClose={() => setShowExpenseForm(false)} />
    </div>
  );
}

function MoneyCard({ label, amount, color }: { label: string; amount: bigint; color?: string }) {
  const { t } = useTranslation();
  return (
    <Card className="px-4 py-3.5">
      <CardLabel>{label}</CardLabel>
      <div className="text-2xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {formatMillionsTiyin(amount)}{' '}
        <span className="text-xs font-normal text-neutral-500">{t('common.mlnSom')}</span>
      </div>
    </Card>
  );
}

// ---------- Incomes ----------

function IncomesTab() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useIncomes();
  const clients = useClients();
  const trips = useAllTrips();
  const { update } = useCrudMutations('incomes');

  const clientName = (id: string | null) =>
    clients.data?.find((client) => client.id === id)?.name ?? '—';
  const tripNumber = (id: string | null) =>
    trips.data?.find((trip) => trip.id === id)?.tripNumber ?? '—';

  const rows = data ?? [];

  return (
    <>
      <div className="mb-3 hidden justify-end md:flex">
        <Button
          variant="secondary"
          icon="export"
          disabled={rows.length === 0}
          onClick={() =>
            exportCsv('kirimlar', rows, [
              {
                header: t('finance.date'),
                value: (income) => formatDate(income.paymentDate ?? income.createdAt),
              },
              { header: t('trips.title'), value: (income) => tripNumber(income.tripId) },
              { header: t('trips.client'), value: (income) => clientName(income.clientId) },
              { header: t('finance.amountShort'), value: (income) => formatTiyin(income.amount) },
              {
                header: t('trips.status'),
                value: (income) => t(`finance.paymentStatuses.${income.status}`),
              },
              { header: t('finance.method'), value: (income) => income.paymentMethod },
              { header: t('finance.invoice'), value: (income) => income.invoiceNumber },
            ])
          }
        >
          {t('common.export')}
        </Button>
      </div>
      <div className="md:hidden">
        <ErrorMessage error={error ?? update.error} />
        <ListState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
          <CardList>
            {rows.map((income) => (
              <ListCard
                key={income.id}
                title={
                  <span className="tabular-nums">
                    {formatTiyin(income.amount)} {t('common.som')}
                  </span>
                }
                subtitle={clientName(income.clientId)}
                trailing={
                  <StatusChip tone={PAYMENT_STATUS_TONE[income.status]}>
                    {t(`finance.paymentStatuses.${income.status}`)}
                  </StatusChip>
                }
                meta={
                  <>
                    <MetaItem label={t('finance.date')}>
                      {formatDate(income.paymentDate ?? income.createdAt)}
                    </MetaItem>
                    <MetaItem label={t('trips.title')}>
                      <span className="tabular-nums text-accent-300">
                        {tripNumber(income.tripId)}
                      </span>
                    </MetaItem>
                    <MetaItem label={t('finance.method')}>{income.paymentMethod ?? '—'}</MetaItem>
                  </>
                }
                footer={
                  <Select
                    aria-label={t('finance.paymentStatus')}
                    value={income.status}
                    onChange={(e) =>
                      void update.mutateAsync({ id: income.id, body: { status: e.target.value } })
                    }
                  >
                    {Object.values(PaymentStatus).map((status) => (
                      <option key={status} value={status}>
                        {t(`finance.paymentStatuses.${status}`)}
                      </option>
                    ))}
                  </Select>
                }
              />
            ))}
          </CardList>
        </ListState>
      </div>

      <Card className="hidden overflow-hidden p-0 md:block">
        <ErrorMessage error={error ?? update.error} />
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('finance.date')}</th>
                <th>{t('trips.title')}</th>
                <th>{t('trips.client')}</th>
                <th className="text-right">{t('finance.amountShort')}</th>
                <th className="pl-4">{t('trips.status')}</th>
                <th>{t('finance.method')}</th>
                <th className="pr-[18px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((income) => (
                <Row key={income.id}>
                  <Cell className="whitespace-nowrap pl-[18px] text-neutral-400">
                    {formatDate(income.paymentDate ?? income.createdAt)}
                  </Cell>
                  <Cell className="font-medium tabular-nums text-accent-300">
                    {tripNumber(income.tripId)}
                  </Cell>
                  <Cell className="whitespace-nowrap">{clientName(income.clientId)}</Cell>
                  <Cell align="right" className="whitespace-nowrap font-medium">
                    {formatTiyin(income.amount)} {t('common.som')}
                  </Cell>
                  <Cell className="pl-4">
                    <StatusChip tone={PAYMENT_STATUS_TONE[income.status]}>
                      {t(`finance.paymentStatuses.${income.status}`)}
                    </StatusChip>
                  </Cell>
                  <Cell className="text-neutral-400">{income.paymentMethod ?? '—'}</Cell>
                  <Cell className="pr-[18px] text-right">
                    <Select
                      className="w-auto py-1 text-[12px]"
                      aria-label={t('finance.paymentStatus')}
                      value={income.status}
                      onChange={(e) =>
                        void update.mutateAsync({ id: income.id, body: { status: e.target.value } })
                      }
                    >
                      {Object.values(PaymentStatus).map((status) => (
                        <option key={status} value={status}>
                          {t(`finance.paymentStatuses.${status}`)}
                        </option>
                      ))}
                    </Select>
                  </Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

// ---------- Expenses ----------

function ExpensesTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading, error } = useExpenses();
  const trips = useAllTrips();
  const { post } = useCrudMutations('expenses');

  const canApprove = user?.role === UserRole.OWNER || user?.role === UserRole.ACCOUNTANT;
  const rows = data ?? [];
  const tripNumber = (id: string | null) =>
    trips.data?.find((trip) => trip.id === id)?.tripNumber ?? '—';

  return (
    <>
      <div className="mb-3 hidden justify-end md:flex">
        <Button
          variant="secondary"
          icon="export"
          disabled={rows.length === 0}
          onClick={() =>
            exportCsv('chiqimlar', rows, [
              { header: t('finance.date'), value: (expense) => formatDate(expense.expenseDate) },
              {
                header: t('finance.category'),
                value: (expense) => t(`finance.categories.${expense.category}`),
              },
              { header: t('trips.title'), value: (expense) => tripNumber(expense.tripId) },
              { header: t('finance.amountShort'), value: (expense) => formatTiyin(expense.amount) },
              { header: t('finance.method'), value: (expense) => expense.paymentMethod },
              {
                header: t('trips.status'),
                value: (expense) =>
                  t(expense.isApproved ? 'finance.approved' : 'finance.notApproved'),
              },
              { header: t('finance.description'), value: (expense) => expense.description },
            ])
          }
        >
          {t('common.export')}
        </Button>
      </div>
      <div className="md:hidden">
        <ErrorMessage error={error ?? post.error} />
        <ListState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
          <CardList>
            {rows.map((expense) => (
              <ListCard
                key={expense.id}
                leading={
                  <Icon
                    name={CATEGORY_ICONS[expense.category]}
                    size={20}
                    style={{ color: 'var(--color-neutral-500)' }}
                  />
                }
                title={
                  <span className="tabular-nums">
                    {formatTiyin(expense.amount)} {t('common.som')}
                  </span>
                }
                subtitle={t(`finance.categories.${expense.category}`)}
                trailing={
                  <StatusChip tone={expense.isApproved ? 'positive' : 'warning'}>
                    {t(expense.isApproved ? 'finance.approved' : 'finance.notApproved')}
                  </StatusChip>
                }
                meta={
                  <>
                    <MetaItem label={t('finance.date')}>{formatDate(expense.expenseDate)}</MetaItem>
                    <MetaItem label={t('trips.title')}>
                      <span className="tabular-nums text-accent-300">
                        {tripNumber(expense.tripId)}
                      </span>
                    </MetaItem>
                    <MetaItem label={t('finance.method')}>{expense.paymentMethod ?? '—'}</MetaItem>
                  </>
                }
                footer={
                  canApprove && !expense.isApproved ? (
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() => void post.mutateAsync({ id: expense.id, verb: 'approve' })}
                    >
                      {t('finance.approve')}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </CardList>
        </ListState>
      </div>

      <Card className="hidden overflow-hidden p-0 md:block">
        <ErrorMessage error={error ?? post.error} />
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('finance.date')}</th>
                <th>{t('finance.category')}</th>
                <th>{t('trips.title')}</th>
                <th className="text-right">{t('finance.amountShort')}</th>
                <th className="pl-4">{t('finance.method')}</th>
                <th>{t('trips.status')}</th>
                <th className="pr-[18px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((expense) => (
                <Row key={expense.id}>
                  <Cell className="whitespace-nowrap pl-[18px] text-neutral-400">
                    {formatDate(expense.expenseDate)}
                  </Cell>
                  <Cell>
                    <span className="flex items-center gap-2">
                      <Icon
                        name={CATEGORY_ICONS[expense.category]}
                        size={15}
                        style={{ color: 'var(--color-neutral-500)' }}
                      />
                      {t(`finance.categories.${expense.category}`)}
                    </span>
                  </Cell>
                  <Cell className="font-medium tabular-nums text-accent-300">
                    {tripNumber(expense.tripId)}
                  </Cell>
                  <Cell align="right" className="whitespace-nowrap font-medium">
                    {formatTiyin(expense.amount)} {t('common.som')}
                  </Cell>
                  <Cell className="pl-4 text-neutral-400">{expense.paymentMethod ?? '—'}</Cell>
                  <Cell>
                    <StatusChip tone={expense.isApproved ? 'positive' : 'warning'}>
                      {t(expense.isApproved ? 'finance.approved' : 'finance.notApproved')}
                    </StatusChip>
                  </Cell>
                  <Cell className="pr-[18px] text-right">
                    {canApprove && !expense.isApproved ? (
                      <Button
                        variant="ghost"
                        className="text-[12px]"
                        onClick={() => void post.mutateAsync({ id: expense.id, verb: 'approve' })}
                      >
                        {t('finance.approve')}
                      </Button>
                    ) : null}
                  </Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

// ---------- Forms ----------

function ExpenseFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('expenses');
  const [form, setForm] = useState({
    category: ExpenseCategory.FUEL as ExpenseCategory,
    amount: '',
    description: '',
    paymentMethod: '',
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      category: form.category,
      amount: somToTiyin(form.amount),
      description: form.description || undefined,
      paymentMethod: form.paymentMethod || undefined,
      expenseDate: new Date(form.expenseDate).toISOString(),
    });
    onClose();
  }

  return (
    <Modal title={t('finance.newExpense')} open={open} onClose={onClose} width={520}>
      <form onSubmit={(e) => void onSubmit(e)}>
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
          <Field label={t('finance.method')}>
            <Input value={form.paymentMethod} onChange={set('paymentMethod')} />
          </Field>
          <Field label={t('finance.description')} className="col-span-2">
            <Input value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <ErrorMessage error={create.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
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

function IncomeFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('incomes');
  const [form, setForm] = useState({
    amount: '',
    invoiceNumber: '',
    paymentMethod: '',
    paymentDate: '',
    status: PaymentStatus.PENDING as PaymentStatus,
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      amount: somToTiyin(form.amount),
      invoiceNumber: form.invoiceNumber || undefined,
      paymentMethod: form.paymentMethod || undefined,
      paymentDate: form.paymentDate ? new Date(form.paymentDate).toISOString() : undefined,
      status: form.status,
    });
    onClose();
  }

  return (
    <Modal title={t('finance.newIncome')} open={open} onClose={onClose} width={520}>
      <form onSubmit={(e) => void onSubmit(e)}>
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
          <Field label={t('finance.method')}>
            <Input value={form.paymentMethod} onChange={set('paymentMethod')} />
          </Field>
          <Field label={t('finance.paymentStatus')} className="col-span-2">
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
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
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
