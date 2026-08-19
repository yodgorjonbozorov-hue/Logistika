import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRole } from 'shared';
import { useCrudMutations } from '../../shared/api/crud';
import { useUsers } from '../../shared/api/queries';
import {
  Avatar,
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Row,
  Select,
  Spinner,
  StatusChip,
  Table,
  initialsOf,
  type ChipTone,
  CardList,
  ListCard,
  ListState,
  MetaItem,
} from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';

/** Office roles the company owner can create; drivers are managed on their own page. */
const OFFICE_ROLES = [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT] as const;

const ROLE_TONE: Record<UserRole, ChipTone> = {
  [UserRole.SUPERADMIN]: 'accent',
  [UserRole.OWNER]: 'accent',
  [UserRole.LOGIST]: 'info',
  [UserRole.ACCOUNTANT]: 'warning',
  [UserRole.DRIVER]: 'neutral',
};

/**
 * The permission matrix mirrors the backend's `@Roles` guards, in the column
 * order Owner · Logist · Accountant · Driver.
 */
const PERMISSIONS: ReadonlyArray<{ key: string; allowed: readonly boolean[] }> = [
  { key: 'createTrip', allowed: [true, true, false, false] },
  { key: 'closeTrip', allowed: [true, true, false, false] },
  { key: 'viewFinance', allowed: [true, false, true, false] },
  { key: 'approveExpense', allowed: [true, false, true, false] },
  { key: 'manageUsers', allowed: [true, false, false, false] },
  { key: 'mobileEvents', allowed: [false, false, false, true] },
];

export function UsersPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const { data: users, isLoading, error } = useUsers();

  const office = (users ?? []).filter((user) => user.role !== UserRole.DRIVER);
  const drivers = (users ?? []).filter((user) => user.role === UserRole.DRIVER);

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle', { office: office.length, drivers: drivers.length })}
        actions={
          <Button icon="plus" onClick={() => setShowForm(true)}>
            {t('users.new')}
          </Button>
        }
      />
      <ErrorMessage error={error} />

      {/* Mobile: name and role first; the permission matrix below stays a table. */}
      <div className="mb-3.5 md:hidden">
        <ListState isLoading={isLoading} error={error} isEmpty={office.length === 0}>
          <CardList>
            {office.map((user) => (
              <ListCard
                key={user.id}
                leading={<Avatar initials={initialsOf(user.fullName)} size={34} tone="accent" />}
                title={user.fullName}
                subtitle={user.email ?? user.phone ?? '—'}
                trailing={
                  <StatusChip tone={ROLE_TONE[user.role]}>{t(`roles.${user.role}`)}</StatusChip>
                }
                meta={
                  <>
                    <MetaItem label={t('users.lastActive')}>
                      {formatDateTime(user.lastLogin)}
                    </MetaItem>
                    <MetaItem label={t('trips.status')}>
                      <span
                        style={{
                          color: user.isActive
                            ? 'var(--color-positive-text)'
                            : 'var(--color-neutral-500)',
                        }}
                      >
                        {t(user.isActive ? 'users.active' : 'users.inactive')}
                      </span>
                    </MetaItem>
                  </>
                }
              />
            ))}
          </CardList>
        </ListState>
      </div>

      <Card className="mb-3.5 hidden overflow-hidden p-0 md:block">
        {isLoading ? (
          <Spinner />
        ) : office.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('users.user')}</th>
                <th>{t('users.contact')}</th>
                <th>{t('users.role')}</th>
                <th>{t('users.lastActive')}</th>
                <th>{t('trips.status')}</th>
                <th className="pr-[18px]" />
              </tr>
            </thead>
            <tbody>
              {office.map((user) => (
                <Row key={user.id}>
                  <Cell className="pl-[18px]">
                    <div className="flex items-center gap-[9px]">
                      <Avatar initials={initialsOf(user.fullName)} size={27} tone="accent" />
                      <span className="font-medium">{user.fullName}</span>
                    </div>
                  </Cell>
                  <Cell className="text-neutral-400">{user.email ?? user.phone ?? '—'}</Cell>
                  <Cell>
                    <StatusChip tone={ROLE_TONE[user.role]}>{t(`roles.${user.role}`)}</StatusChip>
                  </Cell>
                  <Cell className="text-neutral-500">{formatDateTime(user.lastLogin)}</Cell>
                  <Cell
                    className="text-[12.5px]"
                    style={{
                      color: user.isActive
                        ? 'var(--color-positive-text)'
                        : 'var(--color-neutral-500)',
                    }}
                  >
                    {t(user.isActive ? 'users.active' : 'users.inactive')}
                  </Cell>
                  <Cell className="pr-[18px] text-right">
                    <Icon
                      name="dots-three"
                      size={16}
                      style={{ color: 'var(--color-neutral-500)' }}
                    />
                  </Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="px-[18px] pb-2.5 pt-3.5">
          <div className="text-sm font-medium">{t('users.permissionsTitle')}</div>
          <div className="text-xs text-neutral-500">{t('users.permissionsSubtitle')}</div>
        </div>
        <Table>
          <thead>
            <tr>
              <th className="pl-[18px]">{t('users.permission')}</th>
              {OFFICE_ROLES.map((role) => (
                <th key={role} className="text-center">
                  {t(`roles.${role}`)}
                </th>
              ))}
              <th className="pr-[18px] text-center">{t(`roles.${UserRole.DRIVER}`)}</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((permission) => (
              <Row key={permission.key}>
                <Cell className="pl-[18px]">{t(`users.permissions.${permission.key}`)}</Cell>
                {permission.allowed.map((allowed, index) => (
                  <Cell key={index} align="center">
                    <Icon
                      name={allowed ? 'check-circle' : 'x'}
                      size={allowed ? 16 : 14}
                      style={{
                        color: allowed ? 'var(--color-positive)' : 'var(--color-neutral-700)',
                      }}
                    />
                    <span className="sr-only">{t(allowed ? 'common.yes' : 'common.no')}</span>
                  </Cell>
                ))}
              </Row>
            ))}
          </tbody>
        </Table>
      </Card>

      <UserFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function UserFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('users');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: UserRole.LOGIST as UserRole,
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      fullName: form.fullName,
      email: form.email || undefined,
      phone: form.phone || undefined,
      password: form.password,
      role: form.role,
    });
    onClose();
  }

  return (
    <Modal title={t('users.new')} open={open} onClose={onClose} width={520}>
      <form onSubmit={(e) => void onSubmit(e)}>
        <Field label={t('users.fullName')} className="mb-3">
          <Input value={form.fullName} onChange={set('fullName')} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('clients.email')}>
            <Input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label={t('drivers.phone')}>
            <Input value={form.phone} onChange={set('phone')} placeholder="+99890XXXXXXX" />
          </Field>
          <Field label={t('auth.password')}>
            <Input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label={t('users.role')}>
            <Select value={form.role} onChange={set('role')}>
              {OFFICE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
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
