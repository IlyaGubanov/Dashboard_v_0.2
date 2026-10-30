import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Popover,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconArchive, IconArrowBackUp, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { ASSIGNMENT_ROLE_LABELS, ASSIGNMENT_ROLES, ORGANIZATION_KIND_LABELS, type ManageRefs, type SiteEdit, type SiteInput, type WorkItemInput } from '@mvs/shared';
import { api, ApiError, directionQueries } from '../../api';
import { date, money } from '../../ui/format';

const num = (v: string | number) => (v === '' || v == null ? null : Number(v));
const blank = (v: string) => (v.trim() === '' ? null : v);

/** Редактор объекта: паспорт и доп. поля, позиции работ, ответственные. siteId = 'new' — новый объект. */
export function SiteEditor({ code, siteId, refs, onClose, onCreated }: { code: string; siteId: number | 'new' | undefined; refs: ManageRefs; onClose: () => void; onCreated: (id: number) => void }) {
  const isNew = siteId === 'new';
  const { data, error } = useQuery({ ...directionQueries.siteEdit(code, typeof siteId === 'number' ? siteId : 0), enabled: typeof siteId === 'number' });
  return (
    <Drawer opened={siteId != null} onClose={onClose} position="right" size="min(1000px, 100%)" title={<Text fw={700}>{isNew ? 'Новый объект' : (data?.shortName ?? data?.name ?? 'Объект')}</Text>}>
      {error && <Alert color="red">{(error as Error).message}</Alert>}
      {!isNew && !data && !error && <Skeleton h={400} />}
      {(isNew || data) && (
        <Tabs defaultValue="passport" keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="passport">Паспорт</Tabs.Tab>
            <Tabs.Tab value="items" disabled={isNew}>
              Позиции работ{data ? ` · ${data.items.filter((i) => !i.isArchived).length}` : ''}
            </Tabs.Tab>
            <Tabs.Tab value="people" disabled={isNew}>
              Ответственные{data ? ` · ${data.assignments.length}` : ''}
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="passport">
            <Passport code={code} site={data} refs={refs} onCreated={onCreated} />
          </Tabs.Panel>
          {data && (
            <>
              <Tabs.Panel value="items">
                <Items code={code} site={data} refs={refs} />
              </Tabs.Panel>
              <Tabs.Panel value="people">
                <People code={code} site={data} refs={refs} />
              </Tabs.Panel>
            </>
          )}
        </Tabs>
      )}
    </Drawer>
  );
}

/** Новый подрядчик прямо из формы: попадает в справочник организаций направления и сразу выбирается. */
function QuickContractor({ code, kind, onCreated }: { code: string; kind: 'CONTRACTOR' | 'SUBCONTRACTOR'; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [v, setV] = useState({ name: '', inn: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>(`/directions/${code}/manage/organizations`, { method: 'POST', body: { name: v.name, kind, inn: v.inn } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['dir', code, 'manage'] }), qc.invalidateQueries({ queryKey: ['contractors'] })]);
      onCreated(r.id);
      notifications.show({ color: 'green', message: `${ORGANIZATION_KIND_LABELS[kind]} «${v.name.trim()}» добавлен` });
      setOpened(false);
      setV({ name: '', inn: '' });
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      else throw e;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover opened={opened} onChange={setOpened} width={300} position="bottom-end" withArrow trapFocus>
      <Popover.Target>
        <Tooltip label={`Новый ${ORGANIZATION_KIND_LABELS[kind].toLowerCase()}`}>
          <ActionIcon variant="default" size={36} aria-label={`Добавить: ${ORGANIZATION_KIND_LABELS[kind].toLowerCase()}`} onClick={() => (setErrors({}), setOpened((o) => !o))}>
            <IconPlus size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <TextInput label="Название" required data-autofocus error={errors.name} value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
          <TextInput label="ИНН" error={errors.inn} value={v.inn} onChange={(e) => setV({ ...v, inn: e.currentTarget.value })} />
          <Button size="xs" loading={busy} onClick={save}>
            Добавить и выбрать
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function useRefresh(code: string) {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['dir', code] }), qc.invalidateQueries({ queryKey: ['overview'] }), qc.invalidateQueries({ queryKey: ['directions'] })]);
}

/** Паспорт объекта + доп. поля направления. */
function Passport({ code, site, refs, onCreated }: { code: string; site?: SiteEdit; refs: ManageRefs; onCreated: (id: number) => void }) {
  const refresh = useRefresh(code);
  const init = (): SiteInput => ({
    name: site?.name ?? '',
    shortName: site?.shortName ?? '',
    address: site?.address ?? '',
    okrug: site?.okrug ?? '',
    district: site?.district ?? '',
    sectionId: site?.sectionId ?? null,
    statusCode: site?.statusCode ?? null,
    planStart: site?.planStart ?? '',
    planEnd: site?.planEnd ?? '',
    contractorId: site?.contractorId ?? null,
    designerId: site?.designerId ?? null,
    limitAmount: site?.limitAmount ?? null,
    lat: site?.lat ?? null,
    lon: site?.lon ?? null,
    note: site?.note ?? '',
    attrs: { ...(site?.attrs ?? {}) },
  });
  const [v, setV] = useState<SiteInput>(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(init()), [site?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<SiteInput>) => setV((x) => ({ ...x, ...patch }));
  const setAttr = (k: string, val: unknown) => setV((x) => ({ ...x, attrs: { ...x.attrs, [k]: val } }));

  const orgs = (kinds: string[]) => refs.organizations.filter((o) => kinds.includes(o.kind)).map((o) => ({ value: String(o.id), label: o.name }));
  const siteStatuses = refs.statuses.filter((s) => s.entity === 'SITE');

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      if (site) {
        await api(`/directions/${code}/manage/sites/${site.id}`, { method: 'PATCH', body: { ...v, version: site.version } });
        notifications.show({ color: 'green', message: 'Объект сохранён' });
      } else {
        const r = await api<{ id: number }>(`/directions/${code}/manage/sites`, { method: 'POST', body: v });
        notifications.show({ color: 'green', message: 'Объект создан — теперь добавьте позиции работ и ответственных' });
        onCreated(r.id);
      }
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        notifications.show({ color: 'red', message: e.message });
      }
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!site) return;
    await api(`/directions/${code}/manage/sites/${site.id}/archive`, { method: 'POST', body: { archived: !site.isArchived } });
    notifications.show({ color: 'green', message: site.isArchived ? 'Объект возвращён из архива' : 'Объект перенесён в архив' });
    await refresh();
  };

  const groups = new Map<string, ManageRefs['fields']>();
  for (const f of refs.fields) groups.set(f.group ?? 'Дополнительно', [...(groups.get(f.group ?? 'Дополнительно') ?? []), f]);

  return (
    <Stack>
      {site?.isArchived && <Alert color="gray">Объект в архиве: не показывается в сводке, реестре и листе ввода.</Alert>}
      <TextInput label="Полное название" required value={v.name} error={errors.name} onChange={(e) => set({ name: e.currentTarget.value })} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Краткое название" description="в списках и на графиках" value={v.shortName ?? ''} error={errors.shortName} onChange={(e) => set({ shortName: e.currentTarget.value })} />
        <Select label="Раздел / лот" clearable data={refs.sections.filter((s) => !s.isArchived).map((s) => ({ value: String(s.id), label: s.name }))} value={v.sectionId ? String(v.sectionId) : null} onChange={(x) => set({ sectionId: x ? Number(x) : null })} />
        <TextInput label="Адрес" value={v.address ?? ''} onChange={(e) => set({ address: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="Округ" value={v.okrug ?? ''} onChange={(e) => set({ okrug: e.currentTarget.value })} />
          <TextInput label="Район" value={v.district ?? ''} onChange={(e) => set({ district: e.currentTarget.value })} />
        </Group>
        {siteStatuses.length > 0 && (
          <Select label="Статус объекта" clearable data={siteStatuses.map((s) => ({ value: s.code, label: s.name }))} value={v.statusCode ?? null} onChange={(x) => set({ statusCode: x })} />
        )}
        <Group grow>
          <TextInput type="date" label="Начало работ" value={v.planStart ?? ''} error={errors.planStart} onChange={(e) => set({ planStart: e.currentTarget.value })} />
          <TextInput type="date" label="Окончание" value={v.planEnd ?? ''} error={errors.planEnd} onChange={(e) => set({ planEnd: e.currentTarget.value })} />
        </Group>
        <Group gap={4} align="flex-end" wrap="nowrap">
          <Select label="Подрядчик" clearable searchable style={{ flex: 1 }} data={orgs(['CONTRACTOR', 'SUBCONTRACTOR'])} value={v.contractorId ? String(v.contractorId) : null} error={errors.contractorId} onChange={(x) => set({ contractorId: x ? Number(x) : null })} />
          <QuickContractor code={code} kind="CONTRACTOR" onCreated={(id) => set({ contractorId: id })} />
        </Group>
        <Select label="Проектировщик" clearable searchable data={orgs(['DESIGNER'])} value={v.designerId ? String(v.designerId) : null} onChange={(x) => set({ designerId: x ? Number(x) : null })} />
        <NumberInput label="Лимит / бюджет, ₽" min={0} thousandSeparator=" " decimalSeparator="," value={v.limitAmount ?? ''} onChange={(x) => set({ limitAmount: num(x) })} />
        <Group grow>
          <NumberInput label="Широта" decimalScale={6} value={v.lat ?? ''} error={errors.lat} onChange={(x) => set({ lat: num(x) })} />
          <NumberInput label="Долгота" decimalScale={6} value={v.lon ?? ''} error={errors.lon} onChange={(x) => set({ lon: num(x) })} />
        </Group>
      </SimpleGrid>
      <Textarea label="Примечание" autosize minRows={2} value={v.note ?? ''} onChange={(e) => set({ note: e.currentTarget.value })} />

      {[...groups].map(([g, fs]) => (
        <div key={g}>
          <Text fw={600} mb={4}>
            {g}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {fs.map((f) => {
              const val = v.attrs?.[f.code];
              const err = errors[`attrs.${f.code}`];
              const label = `${f.label}${f.unit ? `, ${f.unit}` : ''}`;
              switch (f.type) {
                case 'NUMBER':
                case 'MONEY':
                case 'PERCENT':
                  return <NumberInput key={f.code} label={label} required={f.required} error={err} thousandSeparator={f.type === 'MONEY' ? ' ' : undefined} decimalSeparator="," value={(val as number) ?? ''} onChange={(x) => setAttr(f.code, num(x))} />;
                case 'BOOL':
                  return <Checkbox key={f.code} mt="lg" label={label} checked={!!val} onChange={(e) => setAttr(f.code, e.currentTarget.checked)} />;
                case 'DATE':
                  return <TextInput key={f.code} type="date" label={label} error={err} value={(val as string) ?? ''} onChange={(e) => setAttr(f.code, blank(e.currentTarget.value))} />;
                case 'SELECT':
                  return <Select key={f.code} label={label} clearable error={err} data={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))} value={(val as string) ?? null} onChange={(x) => setAttr(f.code, x)} />;
                case 'MULTISELECT':
                  return <MultiSelect key={f.code} label={label} error={err} data={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))} value={(val as string[]) ?? []} onChange={(x) => setAttr(f.code, x)} />;
                default:
                  return <TextInput key={f.code} label={label} required={f.required} error={err} value={(val as string) ?? ''} onChange={(e) => setAttr(f.code, blank(e.currentTarget.value))} />;
              }
            })}
          </SimpleGrid>
        </div>
      ))}

      <Group justify="space-between">
        {site ? (
          <Button variant="subtle" color={site.isArchived ? 'blue' : 'red'} leftSection={site.isArchived ? <IconArrowBackUp size={16} /> : <IconArchive size={16} />} onClick={archive}>
            {site.isArchived ? 'Вернуть из архива' : 'В архив'}
          </Button>
        ) : (
          <span />
        )}
        <Button loading={saving} onClick={save}>
          {site ? 'Сохранить' : 'Создать объект'}
        </Button>
      </Group>
    </Stack>
  );
}

type Item = SiteEdit['items'][number];

/** Позиции работ объекта: добавить, изменить, убрать (с фактом — в архив, без факта — удаляется). */
function Items({ code, site, refs }: { code: string; site: SiteEdit; refs: ManageRefs }) {
  const refresh = useRefresh(code);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const typeName = (id: number) => refs.workTypes.find((t) => t.id === id)?.name ?? '—';
  const userName = (id: number | null) => refs.users.find((u) => u.id === id)?.fullName ?? '—';
  const rows = site.items.filter((i) => showArchived || !i.isArchived);

  const toggle = async (i: Item) => {
    if (!i.isArchived && !i.hasProgress && !confirm('Позиция без внесённого факта будет удалена. Продолжить?')) return;
    await api(`/directions/${code}/manage/items/${i.id}/archive`, { method: 'POST', body: { archived: !i.isArchived } });
    await refresh();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Checkbox label="Показать убранные в архив" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
        <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEdit('new')}>
          Добавить позицию
        </Button>
      </Group>
      <Table.ScrollContainer minWidth={760}>
        <Table striped verticalSpacing={6} styles={{ td: { whiteSpace: 'nowrap' } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Работа</Table.Th>
              <Table.Th>Проект</Table.Th>
              <Table.Th>Стоимость</Table.Th>
              <Table.Th>Сроки</Table.Th>
              <Table.Th>Ответственный</Table.Th>
              <Table.Th w={80} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((i) => (
              <Table.Tr key={i.id} style={{ opacity: i.isArchived ? 0.5 : 1 }}>
                <Table.Td style={{ whiteSpace: 'normal' }}>
                  <Text size="sm" fw={500}>
                    {i.label ?? typeName(i.workTypeId)}
                    {i.isArchived && (
                      <Badge ml={6} size="xs" color="gray">
                        архив
                      </Badge>
                    )}
                  </Text>
                  {i.label && (
                    <Text size="xs" c="dimmed">
                      {typeName(i.workTypeId)}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{i.planQty != null ? `${i.planQty} ${i.unit ?? ''}` : '—'}</Table.Td>
                <Table.Td>{money(i.planCost)}</Table.Td>
                <Table.Td>{i.planStart || i.planEnd ? `${date(i.planStart)} — ${date(i.planEnd)}` : '—'}</Table.Td>
                <Table.Td>{userName(i.responsibleId)}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon variant="subtle" aria-label="Изменить" onClick={() => setEdit(i)}>
                      <IconPencil size={16} />
                    </ActionIcon>
                    <Tooltip label={i.isArchived ? 'Вернуть' : i.hasProgress ? 'В архив (факт сохранится)' : 'Удалить'}>
                      <ActionIcon variant="subtle" color={i.isArchived ? 'blue' : i.hasProgress ? 'orange' : 'red'} onClick={() => toggle(i)} aria-label="Убрать">
                        {i.isArchived ? <IconArrowBackUp size={16} /> : i.hasProgress ? <IconArchive size={16} /> : <IconTrash size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {edit && <ItemModal code={code} siteId={site.id} item={edit === 'new' ? null : edit} refs={refs} onClose={() => setEdit(null)} onSaved={refresh} />}
    </Stack>
  );
}

function ItemModal({ code, siteId, item, refs, onClose, onSaved }: { code: string; siteId: number; item: Item | null; refs: ManageRefs; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [v, setV] = useState<WorkItemInput>({
    workTypeId: item?.workTypeId ?? 0,
    label: item?.label ?? '',
    unit: item?.unit ?? '',
    planQty: item?.planQty ?? null,
    planCost: item?.planCost ?? null,
    planStart: item?.planStart ?? '',
    planEnd: item?.planEnd ?? '',
    responsibleId: item?.responsibleId ?? null,
    contractorId: item?.contractorId ?? null,
    note: item?.note ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<WorkItemInput>) => setV((x) => ({ ...x, ...p }));
  const types = refs.workTypes.filter((t) => !t.isArchived || t.id === item?.workTypeId);

  const save = async () => {
    setSaving(true);
    try {
      if (item) await api(`/directions/${code}/manage/items/${item.id}`, { method: 'PATCH', body: v });
      else await api(`/directions/${code}/manage/sites/${siteId}/items`, { method: 'POST', body: v });
      await onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={item ? 'Позиция работ' : 'Новая позиция работ'} size="lg">
      <Stack>
        <Select
          label="Вид работ"
          required
          searchable
          error={errors.workTypeId}
          data={types.map((t) => ({ value: String(t.id), label: t.group ? `${t.group} · ${t.name}` : t.name }))}
          value={v.workTypeId ? String(v.workTypeId) : null}
          onChange={(x) => {
            const t = refs.workTypes.find((w) => w.id === Number(x));
            set({ workTypeId: Number(x), unit: v.unit || t?.unit || '', planStart: v.planStart || t?.planStart || '', planEnd: v.planEnd || t?.planEnd || '' });
          }}
        />
        <TextInput label="Своё название" description="если отличается от вида работ, например «Открытая прокладка Ø400»" value={v.label ?? ''} onChange={(e) => set({ label: e.currentTarget.value })} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput label="Проектный объём" min={0} decimalSeparator="," value={v.planQty ?? ''} onChange={(x) => set({ planQty: num(x) })} />
          <TextInput label="Единица" value={v.unit ?? ''} onChange={(e) => set({ unit: e.currentTarget.value })} />
          <NumberInput label="Стоимость, ₽" min={0} thousandSeparator=" " decimalSeparator="," value={v.planCost ?? ''} onChange={(x) => set({ planCost: num(x) })} />
          <TextInput type="date" label="Начало" value={v.planStart ?? ''} onChange={(e) => set({ planStart: e.currentTarget.value })} />
          <TextInput type="date" label="Окончание" error={errors.planEnd} value={v.planEnd ?? ''} onChange={(e) => set({ planEnd: e.currentTarget.value })} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Ответственный" clearable searchable data={refs.users.map((u) => ({ value: String(u.id), label: u.fullName }))} value={v.responsibleId ? String(v.responsibleId) : null} onChange={(x) => set({ responsibleId: x ? Number(x) : null })} />
          <Group gap={4} align="flex-end" wrap="nowrap">
            <Select
              label="Исполнитель"
              description="если работу ведёт не подрядчик объекта"
              clearable
              searchable
              style={{ flex: 1 }}
              data={refs.organizations.filter((o) => o.kind === 'CONTRACTOR' || o.kind === 'SUBCONTRACTOR').map((o) => ({ value: String(o.id), label: o.name }))}
              value={v.contractorId ? String(v.contractorId) : null}
              onChange={(x) => set({ contractorId: x ? Number(x) : null })}
            />
            <QuickContractor code={code} kind="SUBCONTRACTOR" onCreated={(id) => set({ contractorId: id })} />
          </Group>
        </SimpleGrid>
        <Textarea label="Примечание" autosize minRows={2} value={v.note ?? ''} onChange={(e) => set({ note: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={saving} onClick={save} disabled={!v.workTypeId}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Ответственные на объекте: куратор, ответственный за ввод, прораб, ГИП… */
function People({ code, site, refs }: { code: string; site: SiteEdit; refs: ManageRefs }) {
  const refresh = useRefresh(code);
  const [rows, setRows] = useState(site.assignments.map((a) => ({ userId: a.userId, role: a.role })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setRows(site.assignments.map((a) => ({ userId: a.userId, role: a.role }))), [site]);
  const users = refs.users.map((u) => ({ value: String(u.id), label: `${u.fullName}${u.canLogin ? '' : ' (без входа)'}` }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/directions/${code}/manage/sites/${site.id}/assignments`, { method: 'PUT', body: rows.filter((r) => r.userId) });
      notifications.show({ color: 'green', message: 'Ответственные сохранены' });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        «Ответственный за ввод» с областью прав «только назначенные объекты» вносит данные по этому объекту. Роль в направлении назначает администратор в «Пользователи и роли».
      </Text>
      {rows.map((r, i) => (
        <Group key={i} wrap="nowrap">
          <Select style={{ flex: 1 }} searchable placeholder="Сотрудник" data={users} value={r.userId ? String(r.userId) : null} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, userId: Number(x) } : y)))} />
          <Select w={240} data={ASSIGNMENT_ROLES.map((x) => ({ value: x, label: ASSIGNMENT_ROLE_LABELS[x] }))} value={r.role} allowDeselect={false} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, role: x as typeof r.role } : y)))} />
          <ActionIcon variant="subtle" color="red" aria-label="Убрать" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="space-between">
        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setRows([...rows, { userId: 0, role: 'ENTRY' }])}>
          Добавить
        </Button>
        <Button loading={saving} onClick={save}>
          Сохранить
        </Button>
      </Group>
    </Stack>
  );
}
