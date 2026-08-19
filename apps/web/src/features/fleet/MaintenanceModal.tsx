import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MaintenanceType } from 'shared';
import { api } from '../../shared/api/client';
import {
  Badge,
  Button,
  CurrencyInput,
  EmptyState,
  ErrorMessage,
  Field,
  IconPlus,
  Input,
  Modal,
  ModalActions,
  Select,
  Spinner,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';

interface MaintenanceRecord {
  id: string;
  type: MaintenanceType;
  description: string | null;
  odometer: number | null;
  cost: string | null;
  serviceName: string | null;
  serviceDate: string | null;
  nextServiceOdometer: number | null;
}

/** W-5: one vehicle's service history and the plan for the next one. */
export function MaintenanceModal({
  vehicleId,
  plateNumber,
  open,
  onClose,
}: {
  vehicleId: string;
  plateNumber: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['maintenance', vehicleId],
    enabled: open,
    queryFn: async () =>
      (await api<MaintenanceRecord[]>('/maintenance', { query: { vehicleId, limit: 50 } })).data,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/maintenance', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      // The plan lives on the vehicle too — the alert centre reads it there.
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      setShowForm(false);
    },
  });

  const [form, setForm] = useState({
    type: MaintenanceType.PLANNED_TO as MaintenanceType,
    odometer: '',
    cost: '',
    serviceName: '',
    serviceDate: new Date().toISOString().slice(0, 10),
    nextServiceOdometer: '',
    description: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      vehicleId,
      type: form.type,
      odometer: form.odometer ? Number(form.odometer) : undefined,
      cost: form.cost ? (somToTiyin(form.cost) ?? undefined) : undefined,
      serviceName: form.serviceName || undefined,
      serviceDate: form.serviceDate ? new Date(form.serviceDate).toISOString() : undefined,
      nextServiceOdometer: form.nextServiceOdometer ? Number(form.nextServiceOdometer) : undefined,
      description: form.description || undefined,
    });
  }

  const records = data ?? [];

  return (
    <Modal
      title={`${t('maintenance.title')} · ${plateNumber}`}
      open={open}
      onClose={onClose}
      size="lg"
    >
      {showForm ? (
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('maintenance.type')}>
              <Select value={form.type} onChange={set('type')}>
                {Object.values(MaintenanceType).map((type) => (
                  <option key={type} value={type}>
                    {t(`maintenance.types.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('maintenance.serviceDate')}>
              <Input type="date" value={form.serviceDate} onChange={set('serviceDate')} />
            </Field>
            <Field label={t('maintenance.odometer')}>
              <Input type="number" min="0" value={form.odometer} onChange={set('odometer')} />
            </Field>
            <Field label={t('maintenance.nextServiceOdometer')}>
              <Input
                type="number"
                min="0"
                value={form.nextServiceOdometer}
                onChange={set('nextServiceOdometer')}
              />
            </Field>
            <Field label={t('maintenance.cost')}>
              <CurrencyInput unit={t('common.som')} value={form.cost} onChange={set('cost')} />
            </Field>
            <Field label={t('maintenance.serviceName')}>
              <Input value={form.serviceName} onChange={set('serviceName')} />
            </Field>
          </div>
          <Field label={t('maintenance.description')}>
            <Input value={form.description} onChange={set('description')} />
          </Field>
          <ErrorMessage error={create.error} />
          <ModalActions>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {create.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </ModalActions>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowForm(true)} icon={<IconPlus size={16} />}>
              {t('maintenance.new')}
            </Button>
          </div>
          <ErrorMessage error={error} />
          {isLoading ? (
            <Spinner />
          ) : records.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-2.5">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-divider pb-2.5 last:border-0"
                >
                  <Badge tone={record.type === MaintenanceType.PLANNED_TO ? 'blue' : 'orange'}>
                    {t(`maintenance.types.${record.type}`)}
                  </Badge>
                  <span className="font-mono text-subhead tabular-nums text-ink-secondary">
                    {formatDate(record.serviceDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-subhead">
                    {record.serviceName ?? record.description ?? '—'}
                  </span>
                  {record.odometer !== null ? (
                    <span className="font-mono text-footnote tabular-nums text-ink-tertiary">
                      {record.odometer} km
                    </span>
                  ) : null}
                  <span className="font-mono text-subhead tabular-nums">
                    {formatTiyin(record.cost)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
