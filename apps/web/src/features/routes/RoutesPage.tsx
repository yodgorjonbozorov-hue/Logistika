import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRole } from 'shared';
import { useCrudMutations, useDebounced, useList } from '../../shared/api/crud';
import type { Route } from '../../shared/api/entities';
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
  SearchInput,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatDecimal } from '../dashboard/format';

/**
 * Routes are the axis every lane report groups by (TZ §6), which is why they
 * are managed here rather than typed free-hand on each trip: two spellings of
 * "Toshkent–Samarqand" would split one lane's profit across two rows forever.
 */
export function RoutesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Route>(
    'routes',
    page,
    debouncedSearch ? { search: debouncedSearch } : undefined,
  );
  const { remove } = useCrudMutations('routes');

  useEffect(() => setPage(1), [debouncedSearch]);

  // UX only — the backend RolesGuard is what actually denies the write, and the
  // RBAC e2e suite proves it per endpoint.
  const canEdit = user?.role === UserRole.OWNER || user?.role === UserRole.LOGIST;
  const canDeactivate = user?.role === UserRole.OWNER;
  const routes = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t('routes.title')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common.search')} />
            {canEdit && <Button onClick={() => setShowForm(true)}>+ {t('routes.new')}</Button>}
          </>
        }
      />
      <ErrorMessage error={error ?? remove.error} />
      {isLoading ? (
        <Spinner />
      ) : routes.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[
              t('routes.name'),
              t('routes.origin'),
              t('routes.destination'),
              t('routes.plannedDistance'),
              t('routes.status'),
              t('common.actions'),
            ]}
          >
            {routes.map((route) => (
              <Row key={route.id}>
                <Cell className="font-semibold">{route.name}</Cell>
                <Cell>{route.originName}</Cell>
                <Cell>{route.destinationName}</Cell>
                <Cell className="tabular-nums">
                  {formatDecimal(route.plannedDistanceKm, t('units.km'))}
                </Cell>
                <Cell>
                  <Badge tone={route.isActive ? 'green' : 'gray'}>
                    {route.isActive ? t('routes.active') : t('routes.inactive')}
                  </Badge>
                </Cell>
                <Cell>
                  {canDeactivate && route.isActive && (
                    <button
                      className="text-xs font-medium text-danger hover:underline"
                      onClick={() => {
                        if (window.confirm(t('common.confirmDeactivate'))) {
                          void remove.mutateAsync(route.id);
                        }
                      }}
                    >
                      {t('common.deactivate')}
                    </button>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <RouteFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function RouteFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('routes');
  const [form, setForm] = useState({
    name: '',
    originName: '',
    destinationName: '',
    plannedDistanceKm: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      name: form.name,
      originName: form.originName,
      destinationName: form.destinationName,
      // Sent as a string: the column is DECIMAL(9,1) and a JSON number would
      // arrive as a double, which cannot hold 1210.5 exactly.
      plannedDistanceKm: form.plannedDistanceKm.trim() || undefined,
    });
    setForm({ name: '', originName: '', destinationName: '', plannedDistanceKm: '' });
    onClose();
  }

  return (
    <Modal title={t('routes.new')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <Field label={t('routes.name')}>
          <Input value={form.name} onChange={set('name')} required maxLength={120} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('routes.origin')}>
            <Input value={form.originName} onChange={set('originName')} required maxLength={120} />
          </Field>
          <Field label={t('routes.destination')}>
            <Input
              value={form.destinationName}
              onChange={set('destinationName')}
              required
              maxLength={120}
            />
          </Field>
        </div>
        <Field label={t('routes.plannedDistance')} hint={t('routes.distanceHint')}>
          <Input
            inputMode="decimal"
            pattern="\d{1,8}(\.\d)?"
            value={form.plannedDistanceKm}
            onChange={set('plannedDistanceKm')}
            placeholder="1210.5"
          />
        </Field>
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
