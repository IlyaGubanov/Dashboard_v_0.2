import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Modal, NumberInput, Select, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { IconPlus } from '@tabler/icons-react';
import { PERIOD_KIND_LABELS, PROGRESS_METHOD_LABELS, type DirectionInput, type PeriodKind, type ProgressMethod } from '@mvs/shared';
import { api, ApiError } from '../../api';
import { DirectionIcon } from '../../ui/DirectionIcon';
import { DirectionForm, emptyDirection } from './DirectionForm';

interface Row {
  code: string;
  name: string;
  shortName: string;
  icon: string | null;
  color: string | null;
  isActive: boolean;
  isReadonly: boolean;
  periodKind: PeriodKind;
  progressMethod: ProgressMethod;
  sites: number;
  members: number;
  trackers: number;
  fields: number;
}

/** Конструктор направлений: список, новое направление (с нуля или по образцу), пороги сводки. */
export function AdminDirectionsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: rows, error } = useQuery({ queryKey: ['admin', 'directions'], queryFn: () => api<Row[]>('/admin/directions') });
  const [creating, setCreating] = useState(false);
  const [v, setV] = useState<DirectionInput>(emptyDirection);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = async () => {
    try {
      const r = await api<{ code: string }>('/admin/directions', { method: 'POST', body: v });
      await Promise.all([qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['directions'] }), qc.invalidateQueries({ queryKey: ['overview'] })]);
      notifications.show({ color: 'green', message: 'Направление создано. Настройте статусы, поля, надстройки и показатели.' });
      setCreating(false);
      navigate({ to: '/admin/directions/$code', params: { code: r.code } });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        notifications.show({ color: 'red', message: e.message });
      }
    }
  };

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Конструктор направлений</Title>
          <Text c="dimmed" size="sm">
            Новое направление собирается из настроек — без программирования. Кураторов и ответственных назначают в «Пользователи и роли»,
            разделы, виды работ и объекты — на вкладке «Управление» направления.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => (setV(emptyDirection), setErrors({}), setCreating(true))}>
          Новое направление
        </Button>
      </Group>
      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={800}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Направление</Table.Th>
                <Table.Th>Период</Table.Th>
                <Table.Th>Формула готовности</Table.Th>
                <Table.Th ta="right">Объектов</Table.Th>
                <Table.Th ta="right">Доп. полей</Table.Th>
                <Table.Th ta="right">Надстроек</Table.Th>
                <Table.Th ta="right">Участников</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows?.map((r) => (
                <Table.Tr key={r.code} style={{ cursor: 'pointer', opacity: r.isActive ? 1 : 0.5 }} onClick={() => navigate({ to: '/admin/directions/$code', params: { code: r.code } })}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <DirectionIcon icon={r.icon} color={r.color} />
                      <div>
                        <Text fw={500}>
                          <Link to="/admin/directions/$code" params={{ code: r.code }} onClick={(e) => e.stopPropagation()}>
                            {r.shortName}
                          </Link>
                          {!r.isActive && (
                            <Badge ml={6} size="xs" color="gray">
                              выключено
                            </Badge>
                          )}
                          {r.isReadonly && (
                            <Badge ml={6} size="xs" variant="outline" color="gray">
                              только просмотр
                            </Badge>
                          )}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {r.name} · {r.code}
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td>{PERIOD_KIND_LABELS[r.periodKind]}</Table.Td>
                  <Table.Td>{PROGRESS_METHOD_LABELS[r.progressMethod]}</Table.Td>
                  <Table.Td ta="right">{r.sites}</Table.Td>
                  <Table.Td ta="right">{r.fields}</Table.Td>
                  <Table.Td ta="right">{r.trackers}</Table.Td>
                  <Table.Td ta="right">{r.members}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <OverviewThresholds />

      <Modal opened={creating} onClose={() => setCreating(false)} title="Новое направление" size="xl">
        <Stack>
          <Select
            label="Создать по образцу"
            description="Скопируются статусы, доп. поля, надстройки, виды работ и показатели сводки. Объекты, факт и люди не копируются."
            clearable
            data={(rows ?? []).map((r) => ({ value: r.code, label: r.shortName }))}
            value={v.copyFrom ?? null}
            onChange={(x) => setV({ ...v, copyFrom: x ?? undefined })}
          />
          <DirectionForm v={v} setV={setV} errors={errors} isNew />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreating(false)}>
              Отмена
            </Button>
            <Button onClick={create}>Создать</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Пороги светофора направлений в сводке руководства. */
function OverviewThresholds() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'thresholds'], queryFn: () => api<{ warn: number; crit: number }>('/admin/settings/overview') });
  const [t, setT] = useState<{ warn: number; crit: number } | null>(null);
  const cur = t ?? data;
  if (!cur) return null;
  return (
    <Card withBorder padding="lg">
      <Text fw={600}>Светофор направлений в сводке руководства</Text>
      <Text size="sm" c="dimmed" mb="sm">
        Отклонение готовности направления от плана, п.п. Пороги для отдельных объектов задаются в настройках каждого направления.
      </Text>
      <Group align="flex-end">
        <NumberInput label="Отставание, если хуже" suffix=" п.п." max={0} min={-100} w={200} value={cur.warn} onChange={(x) => setT({ ...cur, warn: Number(x) })} />
        <NumberInput label="Критично, если хуже" suffix=" п.п." max={0} min={-100} w={200} value={cur.crit} onChange={(x) => setT({ ...cur, crit: Number(x) })} />
        <Button
          disabled={!t}
          onClick={async () => {
            try {
              await api('/admin/settings/overview', { method: 'PUT', body: cur });
              await qc.invalidateQueries();
              setT(null);
              notifications.show({ color: 'green', message: 'Пороги сохранены' });
            } catch (e) {
              notifications.show({ color: 'red', message: e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : 'Ошибка' });
            }
          }}
        >
          Сохранить
        </Button>
      </Group>
    </Card>
  );
}
