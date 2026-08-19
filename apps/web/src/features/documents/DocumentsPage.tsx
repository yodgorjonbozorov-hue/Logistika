import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DocumentOwnerType } from 'shared';
import { api, tokenStore } from '../../shared/api/client';
import type { StoredDocument } from '../../shared/api/entities';
import { useDrivers, useVehicles } from '../../shared/api/queries';
import {
  Button,
  Card,
  CardList,
  Cell,
  EmptyBlock,
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
  Select,
  StatusChip,
  Table,
  type ChipTone,
} from '../../shared/ui';
import { cn } from '../../shared/utils/cn';
import { dateInputToIso, formatDate } from '../../shared/utils/date';

const FILTERS = ['ALL', ...Object.values(DocumentOwnerType)] as const;
type Filter = (typeof FILTERS)[number];

/** A paper is worth chasing from a month out; past its date it is a problem. */
const EXPIRY_SOON_DAYS = 30;

export function documentStanding(expiryDate: string | null): { tone: ChipTone; key: string } {
  if (!expiryDate) return { tone: 'neutral', key: 'noExpiry' };
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { tone: 'danger', key: 'expired' };
  if (days <= EXPIRY_SOON_DAYS) return { tone: 'warning', key: 'soon' };
  return { tone: 'positive', key: 'valid' };
}

/**
 * The document archive (TZ §5). A row is the record about a paper — what it is,
 * whose it is, when it runs out — and the file behind it is fetched through a
 * freshly signed, short-lived URL rather than stored as a link.
 */
export function DocumentsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['documents', filter],
    queryFn: () =>
      api<StoredDocument[]>('/documents', {
        query: { limit: 100, ownerType: filter === 'ALL' ? undefined : filter },
      }),
  });

  const vehicles = useVehicles();
  const drivers = useDrivers();
  const rows = data?.data ?? [];

  /** Who a paper belongs to, resolved against the reference lists. */
  const ownerName = (document: StoredDocument): string => {
    if (document.ownerType === DocumentOwnerType.VEHICLE) {
      return vehicles.data?.find((v) => v.id === document.ownerId)?.plateNumber ?? '—';
    }
    if (document.ownerType === DocumentOwnerType.DRIVER) {
      return drivers.data?.find((d) => d.id === document.ownerId)?.fullName ?? '—';
    }
    return t(`documents.owners.${document.ownerType}`);
  };

  return (
    <div>
      <PageHeader
        title={t('documents.title')}
        subtitle={t('documents.subtitle')}
        actions={
          <Button icon="upload-simple" onClick={() => setUploading(true)}>
            {t('documents.upload')}
          </Button>
        }
      />

      {/* A scrolling chip row keeps five filters on one line at 320px without
          shrinking any of them below a thumb's width. */}
      <div className="-mx-4 mb-3.5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'tag min-h-[40px] shrink-0 cursor-pointer whitespace-nowrap px-3.5 text-xs md:min-h-0 md:px-2.5',
              filter === value ? 'tag-accent' : 'tag-outline',
            )}
          >
            {value === 'ALL' ? t('common.all') : t(`documents.owners.${value}`)}
          </button>
        ))}
      </div>

      <div className="md:hidden">
        <ListState
          isLoading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          onRetry={() => void refetch()}
          empty={
            <Card>
              <EmptyBlock
                icon="files"
                title={t('documents.emptyTitle')}
                description={t('documents.empty')}
                action={
                  <Button icon="upload-simple" onClick={() => setUploading(true)}>
                    {t('documents.upload')}
                  </Button>
                }
              />
            </Card>
          }
        >
          <CardList>
            {rows.map((document) => {
              const state = documentStanding(document.expiryDate);
              return (
                <ListCard
                  key={document.id}
                  title={document.docType}
                  subtitle={ownerName(document)}
                  trailing={
                    <StatusChip tone={state.tone}>{t(`documents.state.${state.key}`)}</StatusChip>
                  }
                  meta={
                    <>
                      <MetaItem label={t('documents.number')}>{document.docNumber ?? '—'}</MetaItem>
                      <MetaItem label={t('documents.expiry')}>
                        {formatDate(document.expiryDate)}
                      </MetaItem>
                    </>
                  }
                  footer={<DocumentActions document={document} />}
                />
              );
            })}
          </CardList>
        </ListState>
      </div>

      <Card className="hidden overflow-hidden p-0 md:block">
        <ListState
          isLoading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          onRetry={() => void refetch()}
          empty={
            <EmptyBlock
              icon="files"
              title={t('documents.emptyTitle')}
              description={t('documents.empty')}
            />
          }
        >
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('documents.docType')}</th>
                <th>{t('documents.owner')}</th>
                <th>{t('documents.number')}</th>
                <th>{t('documents.issued')}</th>
                <th>{t('documents.expiry')}</th>
                <th className="pl-4">{t('trips.status')}</th>
                <th className="pr-[18px] text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((document) => {
                const state = documentStanding(document.expiryDate);
                return (
                  <Row key={document.id}>
                    <Cell className="pl-[18px] font-medium">{document.docType}</Cell>
                    <Cell className="whitespace-nowrap text-neutral-400">
                      {ownerName(document)}
                    </Cell>
                    <Cell className="text-neutral-400">{document.docNumber ?? '—'}</Cell>
                    <Cell className="whitespace-nowrap text-neutral-500">
                      {formatDate(document.issueDate)}
                    </Cell>
                    <Cell className="whitespace-nowrap text-neutral-400">
                      {formatDate(document.expiryDate)}
                    </Cell>
                    <Cell className="pl-4">
                      <StatusChip tone={state.tone}>{t(`documents.state.${state.key}`)}</StatusChip>
                    </Cell>
                    <Cell className="pr-[18px] text-right">
                      <DocumentActions document={document} />
                    </Cell>
                  </Row>
                );
              })}
            </tbody>
          </Table>
        </ListState>
      </Card>

      <UploadModal open={uploading} onClose={() => setUploading(false)} />
    </div>
  );
}

/** Open the file behind a record, or remove the record. */
function DocumentActions({ document: row }: { document: StoredDocument }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const remove = useMutation({
    mutationFn: () => api(`/documents/${row.id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  /** The stored link is an id; the URL is signed on demand and expires. */
  async function open() {
    if (!row.fileUrl) return;
    setBusy(true);
    try {
      const { data } = await api<{ url: string }>(`/files/${row.fileUrl}/url`);
      window.open(data.url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center justify-end gap-1">
      {row.fileUrl ? (
        <Button variant="ghost" className="text-[12px]" disabled={busy} onClick={() => void open()}>
          <Icon name="download-simple" size={14} />
          {t('documents.open')}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        className="text-[12px] text-danger-text"
        disabled={remove.isPending}
        onClick={() => void remove.mutateAsync()}
      >
        <Icon name="trash" size={14} />
      </Button>
    </span>
  );
}

/** Upload the file, then file the record that describes it. */
function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const vehicles = useVehicles();
  const drivers = useDrivers();
  const [form, setForm] = useState({
    ownerType: DocumentOwnerType.VEHICLE as DocumentOwnerType,
    ownerId: '',
    docType: '',
    docNumber: '',
    issueDate: '',
    expiryDate: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = useMutation({
    mutationFn: async () => {
      const file = fileInput.current?.files?.[0];
      let fileId: string | undefined;
      if (file) fileId = await uploadFile(file);
      return api('/documents', {
        method: 'POST',
        body: {
          ownerType: form.ownerType,
          ownerId: form.ownerType === DocumentOwnerType.COMPANY ? undefined : form.ownerId,
          docType: form.docType,
          docNumber: form.docNumber || undefined,
          issueDate: dateInputToIso(form.issueDate),
          expiryDate: dateInputToIso(form.expiryDate),
          fileId,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    },
  });

  const needsOwner = form.ownerType !== DocumentOwnerType.COMPANY;
  const owners =
    form.ownerType === DocumentOwnerType.VEHICLE
      ? (vehicles.data ?? []).map((v) => ({ id: v.id, label: v.plateNumber }))
      : form.ownerType === DocumentOwnerType.DRIVER
        ? (drivers.data ?? []).map((d) => ({ id: d.id, label: d.fullName }))
        : [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await submit.mutateAsync();
  }

  return (
    <Modal title={t('documents.upload')} open={open} onClose={onClose} width={520}>
      <form onSubmit={(event) => void onSubmit(event)}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('documents.owner')}>
            <Select
              value={form.ownerType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  ownerType: event.target.value as DocumentOwnerType,
                  ownerId: '',
                }))
              }
            >
              {Object.values(DocumentOwnerType).map((value) => (
                <option key={value} value={value}>
                  {t(`documents.owners.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          {needsOwner ? (
            <Field label={t('documents.ownerRecord')}>
              <Select value={form.ownerId} onChange={set('ownerId')} required>
                <option value="">{t('common.select')}</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        <Field label={t('documents.docType')} hint={t('documents.docTypeHint')} className="mt-3">
          <Input value={form.docType} onChange={set('docType')} required maxLength={60} />
        </Field>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label={t('documents.number')}>
            <Input value={form.docNumber} onChange={set('docNumber')} maxLength={60} />
          </Field>
          <Field label={t('documents.issued')}>
            <Input type="date" value={form.issueDate} onChange={set('issueDate')} />
          </Field>
          <Field label={t('documents.expiry')}>
            <Input type="date" value={form.expiryDate} onChange={set('expiryDate')} />
          </Field>
        </div>

        <Field label={t('documents.file')} hint={t('documents.fileHint')} className="mt-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="input py-2 text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-[12.5px] file:text-ink"
          />
        </Field>

        <ErrorMessage error={submit.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={submit.isPending}>
            {submit.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * `POST /files/upload` takes multipart, which the shared JSON client does not
 * speak — so this one call goes out on its own, carrying the same bearer token.
 */
async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
  const response = await fetch(`${base}/files/upload`, {
    method: 'POST',
    headers: tokenStore.access ? { authorization: `Bearer ${tokenStore.access}` } : {},
    body,
  });
  const payload = (await response.json()) as {
    success: boolean;
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? `Upload failed (${response.status})`);
  }
  return payload.data.id;
}
