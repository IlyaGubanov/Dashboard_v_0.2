import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconArchive, IconArrowBackUp, IconPencil, IconPlus, IconSearch } from '@tabler/icons-react';
import { ORGANIZATION_KIND_LABELS, ORGANIZATION_KINDS, type ManageRefs } from '@mvs/shared';
import { api, ApiError, directionQueries } from '../../api';
import { date } from '../../ui/format';
import { SiteEditor } from './SiteEditor';

/** Управление направлением (куратор, администратор): объекты, разделы, виды работ, организации. */
export function ManageTab({ code, editId, onEdit }: { code: string; editId?: number; onEdit: (id: number | undefined) => void }) {
  const { data: refs, error } = useQuery(directionQueries.manage(code));
  const [creating, setCreating] = useState(false);
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!refs) return <Skeleton h={400} />;
  if (!refs.canManage) return <Alert color="gray">Управлять направлением могут куратор и администратор.</Alert>;

  return (
    <>
      <Tabs defaultValue="sites" variant="pills" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="sites">Объекты · {refs.sites.filter((s) => !s.isArchived).length}</Tabs.Tab>
          <Tabs.Tab value="sections">Разделы · {refs.sections.filter((s) => !s.isArchived).length}</Tabs.Tab>
          <Tabs.Tab value="types">Виды работ · {refs.workTypes.filter((s) => !s.isArchived).length}</Tabs.Tab>
          <Tabs.Tab value="orgs">Организации · {refs.organizations.length}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="sites">
          <Sites refs={refs} onEdit={onEdit} onCreate={() => setCreating(true)} />
        </Tabs.Panel>
        <Tabs.Panel value="sections">
          <Sections code={code} refs={refs} />
        </Tabs.Panel>
        <Tabs.Panel value="types">
          <WorkTypes code={code} refs={refs} />
        </Tabs.Panel>
        <Tabs.Panel value="orgs">
          <Orgs code={code} refs={refs} />
        </Tabs.Panel>
      </Tabs>
      <SiteEditor
        code={code}
        refs={refs}
        siteId={creating ? 'new' : editId}
        onClose={() => (setCreating(false), onEdit(undefined))}
        onCreated={(id) => (setCreating(false), onEdit(id))}
      />
    </>
  );
}

function Sites({ refs, onEdit, onCreate }: { refs: ManageRefs; onEdit: (id: number) => void; onCreate: () => void }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const ql = q.trim().toLowerCase();
  const rows = refs.sites.filter((s) => (archived || !s.isArchived) && (!ql || s.name.toLowerCase().includes(ql)));
  return (
    <Card withBorder padding={0}>
      <Group p="md" gap="sm">
        <TextInput aria-label="Поиск" placeholder="Поиск" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={260} />
        <Checkbox label="Показать архив" checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />
        <Button ml="auto" leftSection={<IconPlus size={16} />} onClick={onCreate}>
          Новый объект
        </Button>
      </Group>
      <Table.ScrollContainer minWidth={700}>
        <Table striped highlightOnHover verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Объект</Table.Th>
              <Table.Th>Раздел</Table.Th>
              <Table.Th ta="right">Позиций</Table.Th>
              <Table.Th>Куратор</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((s) => (
              <Table.Tr key={s.id} style={{ cursor: 'pointer', opacity: s.isArchived ? 0.5 : 1 }} onClick={() => onEdit(s.id)}>
                <Table.Td>
                  {s.name}
                  {s.isArchived && (
                    <Badge ml={6} size="xs" color="gray">
                      архив
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{s.section ?? '—'}</Table.Td>
                <Table.Td ta="right">{s.items}</Table.Td>
                <Table.Td>{s.curators.join(', ') || '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

/** Общая форма справочника: модальное окно, сохранение, ошибки по полям. */
function useRefSave(code: string) {
  const qc = useQueryClient();
  return async (path: string, method: 'POST' | 'PATCH', body: unknown, setErrors: (e: Record<string, string>) => void) => {
    try {
      await api(`/directions/${code}/manage/${path}`, { method, body });
      await Promise.all([qc.invalidateQueries({ queryKey: ['dir', code] }), qc.invalidateQueries({ queryKey: ['contractors'] })]);
      notifications.show({ color: 'green', message: 'Сохранено' });
      return true;
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        notifications.show({ color: 'red', message: e.message });
      }
      return false;
    }
  };
}

function ArchiveButton({ code, path, archived }: { code: string; path: string; archived: boolean }) {
  const qc = useQueryClient();
  return (
    <ActionIcon
      variant="subtle"
      color={archived ? 'blue' : 'red'}
      aria-label={archived ? 'Вернуть из архива' : 'В архив'}
      onClick={async (e) => {
        e.stopPropagation();
        await api(`/directions/${code}/manage/${path}/archive`, { method: 'POST', body: { archived: !archived } });
        await qc.invalidateQueries({ queryKey: ['dir', code] });
      }}
    >
      {archived ? <IconArrowBackUp size={16} /> : <IconArchive size={16} />}
    </ActionIcon>
  );
}

function Sections({ code, refs }: { code: string; refs: ManageRefs }) {
  const save = useRefSave(code);
  const [edit, setEdit] = useState<{ id?: number; name: string; note: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Card withBorder padding={0}>
      <Group p="md" justify="space-between">
        <Text size="sm" c="dimmed">
          Разделы и лоты группируют объекты; по ним можно ограничить права ответственного за ввод.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => (setErrors({}), setEdit({ name: '', note: '' }))}>
          Добавить раздел
        </Button>
      </Group>
      <Table striped verticalSpacing={6}>
        <Table.Tbody>
          {refs.sections.map((s) => (
            <Table.Tr key={s.id} style={{ opacity: s.isArchived ? 0.5 : 1 }}>
              <Table.Td>
                <Text fw={500}>{s.name}</Text>
                {s.note && (
                  <Text size="xs" c="dimmed">
                    {s.note}
                  </Text>
                )}
              </Table.Td>
              <Table.Td ta="right">{s.sites} объектов</Table.Td>
              <Table.Td w={90}>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon variant="subtle" aria-label="Изменить" onClick={() => (setErrors({}), setEdit({ id: s.id, name: s.name, note: s.note ?? '' }))}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ArchiveButton code={code} path={`sections/${s.id}`} archived={s.isArchived} />
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Раздел' : 'Новый раздел'}>
        {edit && (
          <Stack>
            <TextInput label="Название" required error={errors.name} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            <Textarea label="Примечание" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button
                onClick={async () => {
                  if (await save(edit.id ? `sections/${edit.id}` : 'sections', edit.id ? 'PATCH' : 'POST', { name: edit.name, note: edit.note }, setErrors)) setEdit(null);
                }}
              >
                Сохранить
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}

type TypeEdit = { id?: number; name: string; group: string; unit: string; weight: number | null; planStart: string; planEnd: string };

function WorkTypes({ code, refs }: { code: string; refs: ManageRefs }) {
  const save = useRefSave(code);
  const [edit, setEdit] = useState<TypeEdit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const groups = [...new Set(refs.workTypes.map((t) => t.group).filter(Boolean))] as string[];
  const hasWeights = refs.workTypes.some((t) => t.weight != null);
  return (
    <Card withBorder padding={0}>
      <Group p="md" justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={() => (setErrors({}), setEdit({ name: '', group: '', unit: '', weight: null, planStart: '', planEnd: '' }))}>
          Добавить вид работ
        </Button>
      </Group>
      <Table.ScrollContainer minWidth={700}>
        <Table striped verticalSpacing={6} styles={{ td: { whiteSpace: 'nowrap' } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Группа</Table.Th>
              <Table.Th>Вид работ</Table.Th>
              <Table.Th>Ед.</Table.Th>
              {hasWeights && <Table.Th>Вес</Table.Th>}
              <Table.Th>Типовые сроки</Table.Th>
              <Table.Th ta="right">Позиций</Table.Th>
              <Table.Th w={90} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {refs.workTypes.map((t) => (
              <Table.Tr key={t.id} style={{ opacity: t.isArchived ? 0.5 : 1 }}>
                <Table.Td>{t.group ?? '—'}</Table.Td>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td>{t.unit ?? '—'}</Table.Td>
                {hasWeights && <Table.Td>{t.weight ?? '—'}</Table.Td>}
                <Table.Td>{t.planStart || t.planEnd ? `${date(t.planStart)} — ${date(t.planEnd)}` : '—'}</Table.Td>
                <Table.Td ta="right">{t.items}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      aria-label="Изменить"
                      onClick={() => (setErrors({}), setEdit({ id: t.id, name: t.name, group: t.group ?? '', unit: t.unit ?? '', weight: t.weight, planStart: t.planStart ?? '', planEnd: t.planEnd ?? '' }))}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ArchiveButton code={code} path={`work-types/${t.id}`} archived={t.isArchived} />
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Modal opened={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Вид работ' : 'Новый вид работ'}>
        {edit && (
          <Stack>
            <TextInput label="Название" required error={errors.name} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            <Select label="Группа" searchable clearable data={groups} value={edit.group || null} onChange={(x) => setEdit({ ...edit, group: x ?? '' })} />
            <TextInput label="Или новая группа" value={groups.includes(edit.group) ? '' : edit.group} onChange={(e) => setEdit({ ...edit, group: e.currentTarget.value })} />
            <SimpleGrid cols={2}>
              <TextInput label="Единица" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.currentTarget.value })} />
              <NumberInput label="Вес в готовности" description="0…1, если формула по весам" min={0} max={1} decimalScale={4} value={edit.weight ?? ''} onChange={(x) => setEdit({ ...edit, weight: x === '' ? null : Number(x) })} />
              <TextInput type="date" label="Типовое начало" value={edit.planStart} onChange={(e) => setEdit({ ...edit, planStart: e.currentTarget.value })} />
              <TextInput type="date" label="Типовое окончание" value={edit.planEnd} onChange={(e) => setEdit({ ...edit, planEnd: e.currentTarget.value })} />
            </SimpleGrid>
            <Group justify="flex-end">
              <Button
                onClick={async () => {
                  const { id, ...body } = edit;
                  if (await save(id ? `work-types/${id}` : 'work-types', id ? 'PATCH' : 'POST', body, setErrors)) setEdit(null);
                }}
              >
                Сохранить
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}

type OrgEdit = { id?: number; name: string; kind: (typeof ORGANIZATION_KINDS)[number]; inn: string; note: string };

function Orgs({ code, refs }: { code: string; refs: ManageRefs }) {
  const save = useRefSave(code);
  const [edit, setEdit] = useState<OrgEdit | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Card withBorder padding={0}>
      <Group p="md" justify="space-between">
        <Text size="sm" c="dimmed">
          Справочник организаций — свой у каждого направления.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => (setErrors({}), setEdit({ name: '', kind: 'CONTRACTOR', inn: '', note: '' }))}>
          Добавить организацию
        </Button>
      </Group>
      <Table striped verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Организация</Table.Th>
            <Table.Th>Роль</Table.Th>
            <Table.Th>ИНН</Table.Th>
            <Table.Th ta="right">Объектов</Table.Th>
            <Table.Th w={50} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {refs.organizations.map((o) => (
            <Table.Tr key={o.id}>
              <Table.Td>{o.name}</Table.Td>
              <Table.Td>{ORGANIZATION_KIND_LABELS[o.kind]}</Table.Td>
              <Table.Td>{o.inn ?? '—'}</Table.Td>
              <Table.Td ta="right">{o.sites}</Table.Td>
              <Table.Td>
                <ActionIcon variant="subtle" aria-label="Изменить" onClick={() => (setErrors({}), setEdit({ id: o.id, name: o.name, kind: o.kind, inn: o.inn ?? '', note: o.note ?? '' }))}>
                  <IconPencil size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Организация' : 'Новая организация'}>
        {edit && (
          <Stack>
            <TextInput label="Название" required error={errors.name} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            <Select label="Роль" allowDeselect={false} data={ORGANIZATION_KINDS.map((k) => ({ value: k, label: ORGANIZATION_KIND_LABELS[k] }))} value={edit.kind} onChange={(x) => setEdit({ ...edit, kind: x as OrgEdit['kind'] })} />
            <TextInput label="ИНН" error={errors.inn} value={edit.inn} onChange={(e) => setEdit({ ...edit, inn: e.currentTarget.value })} />
            <Textarea label="Примечание" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button
                onClick={async () => {
                  const { id, ...body } = edit;
                  if (await save(id ? `organizations/${id}` : 'organizations', id ? 'PATCH' : 'POST', body, setErrors)) setEdit(null);
                }}
              >
                Сохранить
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}
