import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Group, Menu, Modal, PasswordInput, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconBuildingCommunity, IconDots, IconEyeOff, IconFileUpload, IconPlus, IconSearch } from '@tabler/icons-react';
import { GLOBAL_ROLE_LABELS, MEMBER_ROLE_LABELS, passwordSchema, type UserListItem } from '@mvs/shared';
import { api, ApiError, departmentsQuery, meQuery, usersQuery } from '../api';
import { UsersImport } from './UsersImport';
import { CreateUserModal, UserCard, type UserCardTab } from './UserCard';
import { DepartmentsModal } from './Departments';

/** Отбор по подразделению: id, «без подразделения» или все. */
const NO_DEPARTMENT = 'none';

export function UsersPage() {
  const { data: users = [] } = useQuery(usersQuery);
  const { data: departments = [] } = useQuery(departmentsQuery);
  const { data: me } = useQuery(meQuery);
  const [q, setQ] = useState('');
  const [dep, setDep] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deps, setDeps] = useState(false);
  const [card, setCard] = useState<{ id: number; tab: UserCardTab } | null>(null);
  const [pwdFor, setPwdFor] = useState<UserListItem | null>(null);
  const qc = useQueryClient();

  const toggleActive = useMutation({
    mutationFn: (u: UserListItem) => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => notifications.show({ color: 'red', message: e instanceof ApiError ? e.message : 'Не удалось сохранить' }),
  });
  const unlock = useMutation({
    mutationFn: (u: UserListItem) => api(`/users/${u.id}/unlock`, { method: 'POST' }),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Блокировка входа снята' });
      return qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const ql = q.trim().toLowerCase();
  const digits = ql.replace(/\D/g, '');
  const shown = users.filter(
    (u) =>
      (!dep || (dep === NO_DEPARTMENT ? !u.department : String(u.department?.id) === dep)) &&
      (!ql ||
        u.fullName.toLowerCase().includes(ql) ||
        u.login?.toLowerCase().includes(ql) ||
        u.position?.toLowerCase().includes(ql) ||
        u.department?.name.toLowerCase().includes(ql) ||
        (digits.length >= 3 && u.phone?.replace(/\D/g, '').includes(digits))),
  );
  const open = (u: UserListItem, tab: UserCardTab = 'profile') => setCard({ id: u.id, tab });

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Пользователи и роли</Title>
          <Text c="dimmed" size="sm">
            Сотрудники, их данные, роли в направлениях и доступ к разделам. Все изменения пишутся в журнал.
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconBuildingCommunity size={16} />} onClick={() => setDeps(true)}>
            Подразделения
          </Button>
          <Button variant="default" leftSection={<IconFileUpload size={16} />} onClick={() => setImporting(true)}>
            Загрузить списком
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            Добавить сотрудника
          </Button>
        </Group>
      </Group>

      <Group gap="sm" align="flex-end">
        <TextInput
          aria-label="Поиск по ФИО, логину, должности, телефону"
          placeholder="ФИО, логин, должность, телефон"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={340}
          maw="100%"
        />
        <Select
          aria-label="Подразделение"
          placeholder="Все подразделения"
          clearable
          searchable
          w={280}
          maw="100%"
          value={dep}
          onChange={setDep}
          data={[{ value: NO_DEPARTMENT, label: 'Без подразделения' }, ...departments.map((d) => ({ value: String(d.id), label: d.isArchived ? `${d.name} (архив)` : d.name }))]}
        />
        <Text size="sm" c="dimmed">
          {shown.length} из {users.length}
        </Text>
      </Group>

      <Table.ScrollContainer minWidth={980}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ФИО, должность</Table.Th>
              <Table.Th>Подразделение</Table.Th>
              <Table.Th>Телефон</Table.Th>
              <Table.Th>Логин</Table.Th>
              <Table.Th>Роль</Table.Th>
              <Table.Th>Направления</Table.Th>
              <Table.Th>Последний вход</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((u) => {
              const limited = u.globalRole !== 'ADMIN' && u.hiddenSections.length + u.deniedFeatures.length;
              return (
                <Table.Tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.5 }}>
                  <Table.Td>
                    <Anchor component="button" type="button" size="sm" fw={500} onClick={() => open(u)} ta="left">
                      {u.fullName}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {u.position}
                    </Text>
                  </Table.Td>
                  <Table.Td>{u.department?.name ?? <Text c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{u.phone ? <Anchor href={`tel:${u.phone.replace(/[^\d+]/g, '')}`} size="sm">{u.phone}</Anchor> : '—'}</Table.Td>
                  <Table.Td>
                    {u.canLogin ? u.login : <Text c="dimmed" size="sm">без входа</Text>}
                    {u.lockedUntil && (
                      <Badge ml={6} color="red" variant="light" size="sm">
                        заблокирован до {new Date(u.lockedUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {GLOBAL_ROLE_LABELS[u.globalRole]}
                      {!!limited && (
                        <Tooltip label={`Ограничен доступ: скрыто разделов — ${u.hiddenSections.length}, отключено возможностей — ${u.deniedFeatures.length}`}>
                          <Badge
                            component="button"
                            type="button"
                            size="sm"
                            variant="light"
                            color="orange"
                            leftSection={<IconEyeOff size={12} />}
                            style={{ cursor: 'pointer' }}
                            onClick={() => open(u, 'access')}
                          >
                            ограничен
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
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
                        <ActionIcon variant="subtle" aria-label={`Действия: ${u.fullName}`}>
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => open(u)}>Личные данные</Menu.Item>
                        <Menu.Item onClick={() => open(u, 'roles')}>Роли в направлениях</Menu.Item>
                        <Menu.Item onClick={() => open(u, 'access')}>Разделы и возможности</Menu.Item>
                        <Menu.Divider />
                        <Menu.Item onClick={() => setPwdFor(u)}>{u.canLogin ? 'Сбросить пароль' : 'Дать доступ'}</Menu.Item>
                        {u.lockedUntil && <Menu.Item onClick={() => unlock.mutate(u)}>Снять блокировку входа</Menu.Item>}
                        {u.id !== me?.id && (
                          <Menu.Item color={u.isActive ? 'red' : undefined} onClick={() => toggleActive.mutate(u)}>
                            {u.isActive ? 'Заблокировать' : 'Разблокировать'}
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <CreateUserModal
        opened={creating}
        onClose={() => setCreating(false)}
        onCreated={(u) => {
          setCreating(false);
          setCard({ id: u.id, tab: 'roles' });
        }}
      />
      {card && <UserCard key={card.id} userId={card.id} tab={card.tab} onClose={() => setCard(null)} />}
      {pwdFor && <PasswordModal user={pwdFor} onClose={() => setPwdFor(null)} />}
      <UsersImport opened={importing} onClose={() => setImporting(false)} />
      <DepartmentsModal opened={deps} onClose={() => setDeps(false)} />
    </Stack>
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
