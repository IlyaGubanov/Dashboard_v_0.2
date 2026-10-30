/**
 * Карточка сотрудника: личные данные, роли в направлениях, видимость разделов и возможности.
 * Каждая вкладка сохраняется отдельно; все изменения пишутся в журнал на сервере.
 */
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconInfoCircle } from '@tabler/icons-react';
import {
  APP_SECTION_GROUPS,
  APP_SECTION_LABELS,
  FEATURE_LABELS,
  FEATURES,
  GLOBAL_ROLE_LABELS,
  GLOBAL_ROLES,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  MEMBER_SCOPE_LABELS,
  MEMBER_SCOPES,
  userCreateSchema,
  userUpdateSchema,
  type AccessRestrictions,
  type DepartmentItem,
  type GlobalRole,
  type MemberRole,
  type MemberScope,
  type MembershipInput,
  type UserListItem,
} from '@mvs/shared';
import { api, ApiError, departmentsQuery, directionsQuery, usersQuery } from '../api';
import { zodValidate } from '../ui/zodValidate';

const roleOptions = GLOBAL_ROLES.map((r) => ({ value: r, label: GLOBAL_ROLE_LABELS[r] }));
const NEW_DEPARTMENT = '__new__';

/** Подразделение: выбор из справочника, нового можно добавить прямо здесь (набрать название и выбрать «+ Добавить»). */
export function DepartmentSelect({ value, onChange, error }: { value: number | null; onChange: (id: number | null) => void; error?: ReactNode }) {
  const { data: deps = [] } = useQuery(departmentsQuery);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const add = useMutation({
    mutationFn: (name: string) => api<DepartmentItem>('/departments', { method: 'POST', body: { name } }),
    onSuccess: async (d) => {
      await qc.invalidateQueries({ queryKey: ['departments'] });
      onChange(d.id);
      setSearch(d.name);
      notifications.show({ color: 'green', message: `Подразделение «${d.name}» добавлено в справочник` });
    },
    onError: (e) => notifications.show({ color: 'red', message: e instanceof ApiError ? (e.fields.name ?? e.message) : 'Не удалось добавить подразделение' }),
  });
  const s = search.trim();
  const exact = deps.some((d) => d.name.toLowerCase() === s.toLowerCase());
  const data = [
    // архивное подразделение видно, только если оно уже выбрано у сотрудника
    ...deps.filter((d) => !d.isArchived || d.id === value).map((d) => ({ value: String(d.id), label: d.isArchived ? `${d.name} (архив)` : d.name })),
    ...(s.length >= 2 && !exact ? [{ value: NEW_DEPARTMENT, label: `+ Добавить «${s}»` }] : []),
  ];
  return (
    <Select
      label="Подразделение"
      placeholder="Не указано"
      searchable
      clearable
      data={data}
      value={value == null ? null : String(value)}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(v) => (v === NEW_DEPARTMENT ? add.mutate(s) : onChange(v ? Number(v) : null))}
      nothingFoundMessage="Наберите название, чтобы добавить подразделение"
      rightSection={add.isPending ? <Loader size="xs" /> : undefined}
      error={error}
    />
  );
}

/** Галочки: какие разделы видит сотрудник и какие возможности у него есть. */
export function AccessFields({ value, onChange, role }: { value: AccessRestrictions; onChange: (v: AccessRestrictions) => void; role: GlobalRole }) {
  if (role === 'ADMIN') {
    return (
      <Alert color="gray" icon={<IconInfoCircle size={18} />}>
        Администратору доступно всё — ограничения разделов и возможностей к нему не применяются.
      </Alert>
    );
  }
  const toggle = <K extends keyof AccessRestrictions>(key: K, item: AccessRestrictions[K][number], on: boolean) =>
    onChange({ ...value, [key]: on ? value[key].filter((x) => x !== item) : [...value[key], item] });
  return (
    <Stack gap="md">
      {APP_SECTION_GROUPS.map((g) => (
        <div key={g.label}>
          <Text size="sm" fw={600} mb={6}>
            {g.label}
          </Text>
          <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing="xs">
            {g.sections.map((s) => (
              <Checkbox
                key={s}
                label={APP_SECTION_LABELS[s]}
                checked={!value.hiddenSections.includes(s)}
                onChange={(e) => toggle('hiddenSections', s, e.currentTarget.checked)}
              />
            ))}
          </SimpleGrid>
        </div>
      ))}
      <div>
        <Text size="sm" fw={600} mb={6}>
          Возможности
        </Text>
        <Stack gap="xs">
          {FEATURES.map((f) => (
            <Checkbox
              key={f}
              label={FEATURE_LABELS[f].label}
              description={FEATURE_LABELS[f].description}
              checked={!value.deniedFeatures.includes(f)}
              onChange={(e) => toggle('deniedFeatures', f, e.currentTarget.checked)}
            />
          ))}
        </Stack>
      </div>
      <Text size="xs" c="dimmed">
        «Обзор» направления виден всегда. «Ввод данных» и «Управление» зависят от роли в направлении. Галочки только сужают то, что дают роли.
      </Text>
    </Stack>
  );
}

interface ProfileValues extends AccessRestrictions {
  fullName: string;
  position: string;
  departmentId: number | null;
  phone: string;
  email: string;
  globalRole: GlobalRole;
  canLogin: boolean;
  login: string;
  password: string;
}

const profileOf = (u: UserListItem | null): ProfileValues => ({
  fullName: u?.fullName ?? '',
  position: u?.position ?? '',
  departmentId: u?.department?.id ?? null,
  phone: u?.phone ?? '',
  email: u?.email ?? '',
  globalRole: u?.globalRole ?? 'USER',
  canLogin: u ? u.canLogin : true,
  login: u?.login ?? '',
  password: '',
  hiddenSections: u?.hiddenSections ?? [],
  deniedFeatures: u?.deniedFeatures ?? [],
});

/**
 * Личные данные. Без user — новый сотрудник (с логином, паролем и галочками доступа);
 * с user — правка карточки (только личные данные и роль в системе).
 */
function ProfileForm({ user, onDone, onCancel }: { user: UserListItem | null; onDone: (u: UserListItem) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const check = zodValidate<unknown>(user ? userUpdateSchema : userCreateSchema);
  const form = useForm<ProfileValues>({
    initialValues: profileOf(user),
    // без входа логин и пароль не нужны и не проверяются
    validate: (v) => check({ ...v, login: v.canLogin ? v.login : undefined, password: v.canLogin ? v.password : undefined }),
  });

  async function submit(v: ProfileValues) {
    const profile = { fullName: v.fullName, position: v.position, departmentId: v.departmentId, phone: v.phone, email: v.email, globalRole: v.globalRole };
    try {
      const saved = user
        ? await api<UserListItem>(`/users/${user.id}`, { method: 'PATCH', body: profile })
        : await api<UserListItem>('/users', {
            method: 'POST',
            body: {
              ...profile,
              canLogin: v.canLogin,
              login: v.canLogin ? v.login : undefined,
              password: v.canLogin ? v.password : undefined,
              hiddenSections: v.hiddenSections,
              deniedFeatures: v.deniedFeatures,
            },
          });
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['departments'] });
      form.resetDirty(v);
      onDone(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        form.setErrors(e.fields);
        if (!Object.keys(e.fields).length) notifications.show({ color: 'red', message: e.message });
      }
    }
  }

  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack>
        <TextInput label="ФИО" required {...form.getInputProps('fullName')} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Должность" {...form.getInputProps('position')} />
          <DepartmentSelect value={form.values.departmentId} onChange={(id) => form.setFieldValue('departmentId', id)} error={form.errors.departmentId} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Телефон" placeholder="+7 (495) 123-45-67" type="tel" {...form.getInputProps('phone')} />
          <TextInput label="E-mail" type="email" {...form.getInputProps('email')} />
        </SimpleGrid>
        <Select
          label="Роль в системе"
          description="Администратор — всё, руководство — просмотр всех направлений, сотрудник — по ролям в направлениях"
          data={roleOptions}
          allowDeselect={false}
          {...form.getInputProps('globalRole')}
        />
        {!user && (
          <>
            <Switch
              label="Может входить в систему"
              description="Без входа — только как ответственный в данных (прораб, ГИП подрядчика)"
              {...form.getInputProps('canLogin', { type: 'checkbox' })}
            />
            {form.values.canLogin && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Логин" {...form.getInputProps('login')} />
                <PasswordInput label="Временный пароль" description="Сменит при первом входе" {...form.getInputProps('password')} />
              </SimpleGrid>
            )}
            {form.values.canLogin && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 'var(--mantine-font-size-sm)', fontWeight: 600 }}>Разделы и возможности (по умолчанию — всё)</summary>
                <div style={{ paddingTop: 12 }}>
                  <AccessFields
                    role={form.values.globalRole}
                    value={{ hiddenSections: form.values.hiddenSections, deniedFeatures: form.values.deniedFeatures }}
                    onChange={(a) => form.setValues(a)}
                  />
                </div>
              </details>
            )}
          </>
        )}
        <Group justify="flex-end">
          {onCancel && (
            <Button variant="default" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button type="submit" loading={form.submitting} disabled={!!user && !form.isDirty()}>
            {user ? 'Сохранить' : 'Создать'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Новый сотрудник; после создания открывается его карточка на вкладке ролей. */
export function CreateUserModal({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated: (u: UserListItem) => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Новый сотрудник" size="lg">
      {opened && (
        <ProfileForm
          user={null}
          onCancel={onClose}
          onDone={(u) => {
            notifications.show({ color: 'green', message: `Сотрудник «${u.fullName}» создан. Назначьте роли в направлениях.` });
            onCreated(u);
          }}
        />
      )}
    </Modal>
  );
}

export type UserCardTab = 'profile' | 'roles' | 'access';

/** Карточка сотрудника: данные берутся из общего списка, поэтому после сохранения сразу видны изменения. */
export function UserCard({ userId, tab: initialTab, onClose }: { userId: number; tab: UserCardTab; onClose: () => void }) {
  const { data: users = [] } = useQuery(usersQuery);
  const [tab, setTab] = useState<UserCardTab>(initialTab);
  const user = users.find((u) => u.id === userId);
  if (!user) return null;
  return (
    <Modal
      opened
      onClose={onClose}
      size="xl"
      title={
        <Group gap="xs">
          <Text fw={600}>{user.fullName}</Text>
          {!user.isActive && (
            <Badge color="red" variant="light">
              заблокирован
            </Badge>
          )}
        </Group>
      }
    >
      <Tabs value={tab} onChange={(v) => setTab((v as UserCardTab) ?? 'profile')} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="profile">Личные данные</Tabs.Tab>
          <Tabs.Tab value="roles">Роли в направлениях</Tabs.Tab>
          <Tabs.Tab value="access">Разделы и возможности</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="profile">
          <ProfileForm user={user} onDone={() => notifications.show({ color: 'green', message: 'Личные данные сохранены' })} />
        </Tabs.Panel>
        <Tabs.Panel value="roles">
          <RolesPanel user={user} />
        </Tabs.Panel>
        <Tabs.Panel value="access">
          <AccessPanel user={user} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

function AccessPanel({ user }: { user: UserListItem }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<AccessRestrictions>({ hiddenSections: user.hiddenSections, deniedFeatures: user.deniedFeatures });
  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}`, { method: 'PATCH', body: value }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'Доступ сохранён. Сотрудник увидит изменения при следующем открытии страницы.' });
    },
    onError: (e) => notifications.show({ color: 'red', message: e instanceof ApiError ? e.message : 'Не удалось сохранить' }),
  });
  const changed =
    [...value.hiddenSections].sort().join() !== [...user.hiddenSections].sort().join() ||
    [...value.deniedFeatures].sort().join() !== [...user.deniedFeatures].sort().join();
  return (
    <Stack>
      <AccessFields role={user.globalRole} value={value} onChange={setValue} />
      {user.globalRole !== 'ADMIN' && (
        <Group justify="space-between">
          <Button variant="subtle" onClick={() => setValue({ hiddenSections: [], deniedFeatures: [] })}>
            Включить всё
          </Button>
          <Button loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>
            Сохранить
          </Button>
        </Group>
      )}
    </Stack>
  );
}

interface RoleRow {
  role: MemberRole | '';
  scope: MemberScope;
  sectionIds: string[];
}

/** Роли сотрудника по направлениям. Ответственному за ввод можно ограничить лоты/разделы или объекты. */
function RolesPanel({ user }: { user: UserListItem }) {
  const { data: directions = [] } = useQuery(directionsQuery);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<number, RoleRow>>(() =>
    Object.fromEntries(user.memberships.map((m) => [m.directionId, { role: m.role, scope: m.scope, sectionIds: m.sectionIds.map(String) }])),
  );
  const save = useMutation({
    mutationFn: () => {
      const body: MembershipInput[] = Object.entries(rows)
        .filter(([, r]) => r.role)
        .map(([id, r]) => ({ directionId: Number(id), role: r.role as MemberRole, scope: r.scope, sectionIds: r.sectionIds.map(Number) }));
      return api(`/users/${user.id}/memberships`, { method: 'PUT', body });
    },
    onSuccess: async () => {
      setError(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['directions'] })]);
      notifications.show({ color: 'green', message: 'Роли сохранены' });
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не удалось сохранить'),
  });

  return (
    <Stack>
      {user.globalRole !== 'USER' && (
        <Text size="sm" c="dimmed">
          {GLOBAL_ROLE_LABELS[user.globalRole]} видит все направления. Роли ниже нужны, чтобы назначить куратором или ответственным за ввод.
        </Text>
      )}
      {directions.map((d) => {
        const r = rows[d.id] ?? { role: '', scope: 'ALL', sectionIds: [] };
        const set = (patch: Partial<RoleRow>) => setRows({ ...rows, [d.id]: { ...r, ...patch } });
        const scopes = MEMBER_SCOPES.filter((s) => s !== 'SECTIONS' || d.sections.length);
        return (
          <Stack key={d.id} gap={6}>
            <Group align="flex-end" gap="sm">
              <Text size="sm" fw={500} w={140}>
                {d.shortName}
              </Text>
              <Select
                w={230}
                aria-label={`Роль: ${d.shortName}`}
                placeholder="Нет доступа"
                clearable
                data={MEMBER_ROLES.map((m) => ({ value: m, label: MEMBER_ROLE_LABELS[m] }))}
                value={r.role || null}
                onChange={(v) => set({ role: (v as MemberRole) ?? '' })}
              />
              {r.role === 'EDITOR' && (
                <Select
                  w={260}
                  aria-label="Область ввода"
                  allowDeselect={false}
                  data={scopes.map((s) => ({ value: s, label: MEMBER_SCOPE_LABELS[s] }))}
                  value={r.scope}
                  onChange={(v) => set({ scope: (v as MemberScope) ?? 'ALL' })}
                />
              )}
            </Group>
            {r.role === 'EDITOR' && r.scope === 'SECTIONS' && (
              <MultiSelect
                aria-label="Выберите лоты / разделы"
                placeholder="Выберите лоты / разделы"
                data={d.sections.map((s) => ({ value: String(s.id), label: s.name }))}
                value={r.sectionIds}
                onChange={(v) => set({ sectionIds: v })}
              />
            )}
            {r.role === 'EDITOR' && r.scope === 'SITES' && (
              <Text size="xs" c="dimmed">
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
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Сохранить роли
        </Button>
      </Group>
    </Stack>
  );
}
