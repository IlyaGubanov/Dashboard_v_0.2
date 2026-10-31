import { useState } from 'react';
import { Alert, Button, Group, Modal, MultiSelect, NumberInput, Paper, Skeleton, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { econSettingsSchema, type EconAuditItem, type EconEditors, type EconSettings } from '@mvs/shared';
import { api } from '../../api';
import { errorText, numOrNull } from './format';

export function EconSettingsDialog({ settings, onClose }: { settings: EconSettings; onClose: () => void }) {
  const qc = useQueryClient();
  const [vat, setVat] = useState<number | null>(settings.vatRate);
  const [laborRate, setLaborRate] = useState<number | null>(settings.laborRate ?? null);
  const [machineRate, setMachineRate] = useState<number | null>(settings.machineRate ?? null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const parsed = econSettingsSchema.safeParse({ vatRate: vat, laborRate, machineRate });
    if (!parsed.success) return setFields(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    setBusy(true);
    setFields({});
    try {
      await api('/economics/settings', { method: 'PUT', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      notifications.show({ color: 'green', message: 'Ставки сохранены' });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const rate = { min: 0, decimalScale: 2, thousandSeparator: ' ', decimalSeparator: ',', hideControls: true } as const;
  return (
    <Modal opened onClose={onClose} title="Ставки и НДС" size="md">
      <Stack gap="sm">
        <NumberInput label="НДС, %" description="Стоимость и КС-2 в дашборде — с НДС; экономика считается без НДС. С 2026 года — 22%." value={vat ?? ''} onChange={(v) => setVat(numOrNull(v))} min={0} max={50} decimalScale={2} decimalSeparator="," error={fields.vatRate} />
        <NumberInput label="Средняя тарифная ставка рабочего, ₽ за чел.-ч" description="Норма трудочасов = лимит ФОТ ÷ ставка (кнопка «Подставить» в карточке лимитов)" value={laborRate ?? ''} onChange={(v) => setLaborRate(numOrNull(v))} {...rate} error={fields.laborRate} />
        <NumberInput label="Средняя стоимость машино-часа, ₽" description="Норма машино-часов = лимит техники ÷ стоимость часа" value={machineRate ?? ''} onChange={(v) => setMachineRate(numOrNull(v))} {...rate} error={fields.machineRate} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={save}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function EconEditorsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['economics', 'editors'], queryFn: () => api<EconEditors>('/economics/editors') });
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const value = ids ?? query.data?.userIds.map(String) ?? [];
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/economics/editors', { method: 'PUT', body: { userIds: value.map(Number) } });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      notifications.show({ color: 'green', message: 'Ответственные ПЭО сохранены' });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal opened onClose={onClose} title="Ответственные ПЭО" size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">Вносят лимиты и факт по всем направлениям, закрывают месяц. Руководство и кураторы видят раздел без права ввода.</Text>
        {!query.data ? <Skeleton height={36} /> : (
          <MultiSelect
            label="Сотрудники"
            data={query.data.users.map((u) => ({ value: String(u.id), label: u.login ? `${u.fullName} (${u.login})` : u.fullName }))}
            value={value}
            onChange={setIds}
            searchable
            clearable
            comboboxProps={{ zIndex: 1000 }}
          />
        )}
        {(error || query.error) && <Alert color="red">{error || query.error?.message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={save} disabled={!query.data}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const ENTITY: Record<string, string> = {
  econ_budget: 'Лимиты',
  econ_fact: 'Факт',
  econ_company_fact: 'Общие расходы',
  econ_month: 'Месяц',
  econ_article: 'Статья',
  econ_settings: 'Настройки',
  econ_editors: 'Ответственные',
  econ_demo: 'Демо-данные',
  econ_cash: 'ДДС',
};
const ACTION: Record<string, string> = { CREATE: 'Создание', UPDATE: 'Изменение', DELETE: 'Удаление', IMPORT: 'Загрузка', PERIOD_CLOSE: 'Закрытие', PERIOD_OPEN: 'Открытие' };

export function EconJournal() {
  const query = useQuery({ queryKey: ['economics', 'journal'], queryFn: () => api<EconAuditItem[]>('/economics/journal') });
  if (query.error) return <Alert color="red">{query.error.message}</Alert>;
  if (!query.data) return <Skeleton height={240} />;
  if (!query.data.length) return <Text size="sm" c="dimmed">Изменений пока нет.</Text>;
  return (
    <Paper withBorder radius="md">
      <Table.ScrollContainer minWidth={640}>
        <Table verticalSpacing={6} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={150}>Когда</Table.Th>
              <Table.Th>Кто</Table.Th>
              <Table.Th>Что</Table.Th>
              <Table.Th>Комментарий</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {query.data.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{new Date(r.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</Table.Td>
                <Table.Td>{r.user}</Table.Td>
                <Table.Td>{ACTION[r.action] ?? r.action}: {ENTITY[r.entity] ?? r.entity}{r.entity === 'econ_fact' || r.entity === 'econ_budget' ? ` ЦЗ-${r.entityId?.split(':')[0]}` : r.entityId && r.entity !== 'econ_settings' && r.entity !== 'econ_editors' && r.entity !== 'econ_demo' && r.entity !== 'econ_cash' ? ` ${r.entityId}` : ''}</Table.Td>
                <Table.Td>{r.comment}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
