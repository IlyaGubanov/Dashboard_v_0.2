import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  MultiSelect,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconDots, IconFileUpload, IconPlus, IconSearch } from '@tabler/icons-react';
import {
  GLOBAL_ROLE_LABELS,
  GLOBAL_ROLES,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  MEMBER_SCOPE_LABELS,
  MEMBER_SCOPES,
  passwordSchema,
  userCreateSchema,
  type MemberRole,
  type MemberScope,
  type MembershipInput,
  type UserCreateInput,
  type UserListItem,
} from '@mvs/shared';
import { api, ApiError, directionsQuery, usersQuery } from '../api';
import { UsersImport } from './UsersImport';
import { zodValidate } from '../ui/zodValidate';

const roleOptions = GLOBAL_ROLES.map((r) => ({ value: r, label: GLOBAL_ROLE_LABELS[r] }));

export function UsersPage() {
  const { data: users = [] } = useQuery(usersQuery);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rolesFor, setRolesFor] = useState<UserListItem | null>(null);
  const [pwdFor, setPwdFor] = useState<UserListItem | null>(null);
  const qc = useQueryClient();

  const toggleActive = useMutation({
    mutationFn: (u: UserListItem) => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const unlock = useMutation({
    mutationFn: (u: UserListItem) => api(`/users/${u.id}/unlock`, { method: 'POST' }),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Блокировка входа снята' });
      return qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const ql = q.trim().toLowerCase();
  const shown = users.filter(
    (u) => !ql || u.fullName.toLowerCase().includes(ql) || u.login?.toLowerCase().includes(ql) || u.position?.toLowerCase().includes(ql),
  );

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Пользователи и роли</Title>
          <Text c="dimmed" size="sm">
            Учётные записи, кураторы и ответственные за ввод по направлениям. Все изменения пишутся в журнал.
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconFileUpload size={16} />} onClick={() => setImporting(true)}>
            Загрузить списком
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            Добавить
          </Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Поиск по ФИО, логину, должности"
        leftSection={<IconSearch size={16} />}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        maw={420}
      />

      <Table.ScrollContainer minWidth={800}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ФИО</Table.Th>
              <Table.Th>Логин</Table.Th>
              <Table.Th>Роль</Table.Th>
              <Table.Th>Направления</Table.Th>
              <Table.Th>Последний вход</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((u) => (
              <Table.Tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.5 }}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {u.fullName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {u.position}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {u.canLogin ? u.login : <Text c="dimmed" size="sm">без входа</Text>}
                  {u.lockedUntil && (
                    <Badge ml={6} color="red" variant="light" size="sm">
                      заблокирован до {new Date(u.lockedUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{GLOBAL_ROLE_LABELS[u.globalRole]}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {u.memberships.map((m) => (
                      <Badge key={m.directionId} variant={m.role === 'CURATOR' ? 'filled' : 'light'} size="sm">
                        {m.directionName}: {MEMBER_ROLE_LABELS[m.role]}
                        {m.role === 'EDITOR' && m.scope === 'SECTIONS' && ` · лотов: ${m.sectionIds.length}`}
                        {m.role === 'EDITOR' && m.scope === 'SITES' && ' · свои объекты'}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ru-RU') : '—'}</Table.Td>
                <Table.Td>
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="Действия">
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setRolesFor(u)}>Роли в направлениях</Menu.Item>
                      <Menu.Item onClick={() => setPwdFor(u)}>{u.canLogin ? 'Сбросить пароль' : 'Дать доступ'}</Menu.Item>
                      {u.lockedUntil && <Menu.Item onClick={() => unlock.mutate(u)}>Снять блокировку входа</Menu.Item>}
                      <Menu.Item color={u.isActive ? 'red' : undefined} onClick={() => toggleActive.mutate(u)}>
                        {u.isActive ? 'Заблокировать' : 'Разблокировать'}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <CreateUserModal opened={creating} onClose={() => setCreating(false)} />
      {rolesFor && <RolesModal user={rolesFor} onClose={() => setRolesFor(null)} />}
      {pwdFor && <PasswordModal user={pwdFor} onClose={() => setPwdFor(null)} />}
      <UsersImport opened={importing} onClose={() => setImporting(false)} />
    </Stack>
  );
}

function CreateUserModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<UserCreateInput>({
    initialValues: { fullName: '', position: '', email: '', phone: '', globalRole: 'USER', canLogin: true, login: '', password: '' },
    validate: zodValidate(userCreateSchema),
  });

  async function submit(v: UserCreateInput) {
    try {
      await api('/users', {
        method: 'POST',
        body: { ...v, login: v.canLogin ? v.login : undefined, password: v.canLogin ? v.password : undefined },
      });
      await qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: `Пользователь «${v.fullName}» создан` });
      form.reset();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) form.setErrors(e.fields);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Новый пользователь" size="md">
      <form onSubmit={form.onSubmit(submit)}>
        <Stack>
          <TextInput label="ФИО" required {...form.getInputProps('fullName')} />
          <TextInput label="Должность" {...form.getInputProps('position')} />
          <Group grow>
            <TextInput label="E-mail" {...form.getInputProps('email')} />
            <TextInput label="Телефон" {...form.getInputProps('phone')} />
          </Group>
          <Select label="Роль в системе" data={roleOptions} allowDeselect={false} {...form.getInputProps('globalRole')} />
          <Switch
            label="Может входить в систему"
            description="Без входа — только как ответственный в данных (прораб, ГИП подрядчика)"
            {...form.getInputProps('canLogin', { type: 'checkbox' })}
          />
          {form.values.canLogin && (
            <Group grow align="flex-start">
              <TextInput label="Логин" {...form.getInputProps('login')} />
              <PasswordInput label="Временный пароль" description="Сменит при первом входе" {...form.getInputProps('password')} />
            </Group>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={form.submitting}>
              Создать
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

interface RoleRow {
  role: MemberRole | '';
  scope: MemberScope;
  sectionIds: string[];
}

/** Роли пользователя по направлениям. Ответственному за ввод можно ограничить лоты/разделы или объекты. */
function RolesModal({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const { data: directions = [] } = useQuery(directionsQuery);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<number, RoleRow>>(() =>
    Object.fromEntries(
      user.memberships.map((m) => [m.directionId, { role: m.role, scope: m.scope, sectionIds: m.sectionIds.map(String) }]),
    ),
  );
  const save = useMutation({
    mutationFn: () => {
      const body: MembershipInput[] = Object.entries(rows)
        .filter(([, r]) => r.role)
        .map(([id, r]) => ({
          directionId: Number(id),
          role: r.role as MemberRole,
          scope: r.scope,
          sectionIds: r.sectionIds.map(Number),
        }));
      return api(`/users/${user.id}/memberships`, { method: 'PUT', body });
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['directions'] })]);
      notifications.show({ color: 'green', message: 'Роли сохранены' });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : 'Не удалось сохранить'),
  });

  return (
    <Modal opened onClose={onClose} title={`Роли: ${user.fullName}`} size="xl">
      <Stack>
        {directions.map((d) => {
          const r = rows[d.id] ?? { role: '', scope: 'ALL', sectionIds: [] };
          const set = (patch: Partial<RoleRow>) => setRows({ ...rows, [d.id]: { ...r, ...patch } });
          const scopes = MEMBER_SCOPES.filter((s) => s !== 'SECTIONS' || d.sections.length);
          return (
            <Stack key={d.id} gap={6}>
              <Group wrap="nowrap" align="flex-end">
                <Text size="sm" fw={500} w={140}>
                  {d.shortName}
                </Text>
                <Select
                  w={230}
                  placeholder="Нет доступа"
                  clearable
                  data={MEMBER_ROLES.map((m) => ({ value: m, label: MEMBER_ROLE_LABELS[m] }))}
                  value={r.role || null}
                  onChange={(v) => set({ role: (v as MemberRole) ?? '' })}
                />
                {r.role === 'EDITOR' && (
                  <Select
                    w={260}
                    allowDeselect={false}
                    data={scopes.map((s) => ({ value: s, label: MEMBER_SCOPE_LABELS[s] }))}
                    value={r.scope}
                    onChange={(v) => set({ scope: (v as MemberScope) ?? 'ALL' })}
                  />
                )}
              </Group>
              {r.role === 'EDITOR' && r.scope === 'SECTIONS' && (
                <MultiSelect
                  ml={156}
                  placeholder="Выберите лоты / разделы"
                  data={d.sections.map((s) => ({ value: String(s.id), label: s.name }))}
                  value={r.sectionIds}
                  onChange={(v) => set({ sectionIds: v })}
                />
              )}
              {r.role === 'EDITOR' && r.scope === 'SITES' && (
                <Text size="xs" c="dimmed" ml={156}>
                  Объекты назначаются в карточке объекта (поле «Ответственный за ввод»).
                </Text>
              )}
            </Stack>
          );
        })}
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const form = useForm({
    initialValues: { login: user.login ?? '', password: '' },
    validate: {
      login: (v) => (v.trim().length < 3 ? 'Не короче 3 символов' : null),
      password: (v) => passwordSchema.safeParse(v).error?.issues[0]?.message ?? null,
    },
  });
  const qc = useQueryClient();

  async function submit(v: { login: string; password: string }) {
    try {
      await api(`/users/${user.id}/password`, { method: 'POST', body: v });
      await qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'Пароль задан. Пользователь сменит его при входе.' });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) form.setErrors(e.fields);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Пароль: ${user.fullName}`}>
      <form onSubmit={form.onSubmit(submit)}>
        <Stack>
          <TextInput label="Логин" disabled={!!user.login} {...form.getInputProps('login')} />
          <PasswordInput label="Временный пароль" {...form.getInputProps('password')} />
          <Text size="xs" c="dimmed">
            Все открытые сессии пользователя будут закрыты.
          </Text>
          <Group justify="flex-end">
            <Button type="submit" loading={form.submitting}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
