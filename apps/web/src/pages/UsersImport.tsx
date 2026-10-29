import { useState } from 'react';
import { Alert, Badge, Button, FileButton, Group, List, Modal, Stack, Table, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { IconAlertTriangle, IconCheck, IconDownload, IconFileUpload, IconRefresh } from '@tabler/icons-react';
import { IMPORT_FIELDS, type ImportField, type UserImportResult } from '@mvs/shared';
import { api, ApiError } from '../api';

/** Разбор текста из Excel (табуляция) или CSV (; или ,), с кавычками. */
export function parseTable(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

const low = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');
/** Заголовки таблицы → поля загрузки. */
function mapHeaders(head: string[]) {
  const map: (ImportField | null)[] = head.map((h) => IMPORT_FIELDS.find((f) => low(f.label) === low(h) || f.aliases.some((a) => low(a) === low(h)))?.key ?? null);
  return { map, unknown: head.filter((_, i) => !map[i]) };
}

const csv = (rows: string[][]) => '﻿' + rows.map((r) => r.map((x) => `"${(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const TEMPLATE = [
  IMPORT_FIELDS.map((f) => f.label),
  ['Петрова Анна Николаевна', '', 'Инженер ПТО', 'petrova@example.ru', '+7 900 000-00-01', 'Сотрудник', 'МКД', 'Ответственный за ввод', 'Лот 1; Лот 2', 'да'],
  ['Петрова Анна Николаевна', '', '', '', '', '', 'Сети', 'Просмотр', '', 'да'],
  ['Соколов Дмитрий Андреевич', 'sokolov', 'Главный инженер', '', '', 'Сотрудник', 'МКД', 'Куратор', '', 'да'],
  ['Иванов Пётр Сергеевич', '', 'Прораб подрядчика', '', '+7 900 000-00-02', '', '', '', '', 'нет'],
];

/** Загрузка пользователей списком: вставить из Excel → проверить → загрузить → раздать логины и временные пароли. */
export function UsersImport({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [result, setResult] = useState<UserImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const table = text.trim() ? parseTable(text) : [];
  const { map, unknown } = table.length ? mapHeaders(table[0]) : { map: [], unknown: [] };
  const rows = table.slice(1).map((r) => Object.fromEntries(map.flatMap((k, i) => (k ? [[k, r[i] ?? '']] : []))) as Record<string, string>);
  const hasName = map.includes('fullName');

  const reset = () => (setText(''), setResult(null));
  const close = () => {
    if (result && !result.dryRun && result.rows.some((r) => r.password) && !confirm('Временные пароли больше нигде не показываются. Вы их сохранили?')) return;
    reset();
    onClose();
  };

  const send = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api<UserImportResult>('/users/import', { method: 'POST', body: { dryRun, rows } });
      setResult(r);
      if (!dryRun) {
        await qc.invalidateQueries({ queryKey: ['users'] });
        notifications.show({ color: 'green', message: `Загружено: новых ${r.created}, обновлено ${r.updated}` });
      }
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof ApiError ? e.message : 'Ошибка' });
    } finally {
      setBusy(false);
    }
  };

  const passwords = () =>
    download(
      `пользователи-пароли-${new Date().toISOString().slice(0, 10)}.csv`,
      csv([['ФИО', 'Логин', 'Временный пароль', 'Роли'], ...result!.rows.filter((r) => r.password).map((r) => [r.fullName, r.login ?? '', r.password!, r.roles.join('; ')])]),
    );

  const done = result && !result.dryRun;
  return (
    <Modal opened={opened} onClose={close} title="Загрузка пользователей списком" size="80rem">
      <Stack>
        {!result && (
          <>
            <Text size="sm">
              Скопируйте таблицу из Excel вместе со строкой заголовков и вставьте ниже — или выберите файл CSV. Столбцы распознаются по названию,
              порядок любой. Человек в нескольких направлениях — несколько строк с одинаковым ФИО (или логином).
            </Text>
            <Group>
              <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => download('шаблон-пользователи.csv', csv(TEMPLATE))}>
                Шаблон для Excel
              </Button>
              <FileButton accept=".csv,.txt" onChange={(f) => f && f.text().then(setText)}>
                {(p) => (
                  <Button {...p} variant="default" leftSection={<IconFileUpload size={16} />}>
                    Выбрать файл CSV
                  </Button>
                )}
              </FileButton>
            </Group>
            <Text size="xs" c="dimmed">
              Столбцы: {IMPORT_FIELDS.map((f) => f.label).join(', ')}. Обязательно только ФИО. Логин не указан — составится из ФИО (petrova.an).
              «Вход: нет» — человек без входа (прораб, ответственный от подрядчика): его можно назначать на объекты и в замечания.
            </Text>
            <Textarea
              placeholder="Вставьте сюда таблицу из Excel (Ctrl+V)"
              autosize
              minRows={8}
              maxRows={16}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
            />
            {table.length > 0 && (
              <Text size="sm">
                Строк: <b>{rows.length}</b>. Распознаны столбцы: {map.filter(Boolean).map((k) => IMPORT_FIELDS.find((f) => f.key === k)!.label).join(', ') || '—'}
                {unknown.length > 0 && <Text span c="orange"> · не распознаны (будут пропущены): {unknown.join(', ')}</Text>}
              </Text>
            )}
            {table.length > 0 && !hasName && <Alert color="red">Нет столбца «ФИО» — проверьте строку заголовков.</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Отмена
              </Button>
              <Button disabled={!rows.length || !hasName} loading={busy} onClick={() => send(true)}>
                Проверить
              </Button>
            </Group>
          </>
        )}

        {result && (
          <>
            <Group gap="lg">
              <Badge size="lg" variant="light" color="green">
                {done ? 'создано' : 'будет создано'}: {result.created}
              </Badge>
              <Badge size="lg" variant="light" color="blue">
                {done ? 'обновлено' : 'будет обновлено'}: {result.updated}
              </Badge>
              <Badge size="lg" variant="light" color={result.errors ? 'red' : 'gray'}>
                с ошибками: {result.errors}
              </Badge>
            </Group>
            {done && result.rows.some((r) => r.password) && (
              <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Сохраните временные пароли сейчас">
                Пароли показываются один раз. Скачайте файл и передайте каждому его логин и пароль лично (не общей рассылкой). При первом входе
                система попросит сменить пароль.
                <Button mt="sm" leftSection={<IconDownload size={16} />} onClick={passwords} display="block">
                  Скачать логины и пароли
                </Button>
              </Alert>
            )}
            {!done && result.errors > 0 && (
              <Alert color="red">Строки с ошибками будут пропущены. Можно исправить их в Excel и вставить заново, а можно загрузить остальные.</Alert>
            )}
            <Table.ScrollContainer minWidth={900} mah={460}>
              <Table striped verticalSpacing={4} stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={70}>Строка</Table.Th>
                    <Table.Th>ФИО</Table.Th>
                    <Table.Th w={150}>Логин</Table.Th>
                    <Table.Th>Роли</Table.Th>
                    <Table.Th w={140}>Действие</Table.Th>
                    <Table.Th>Замечания</Table.Th>
                    {done && <Table.Th w={150}>Временный пароль</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.rows.map((r) => (
                    <Table.Tr key={r.line}>
                      <Table.Td>{r.line}</Table.Td>
                      <Table.Td>{r.fullName || '—'}</Table.Td>
                      <Table.Td>{r.login ?? <Text c="dimmed" size="sm">без входа</Text>}</Table.Td>
                      <Table.Td>
                        <Text size="xs">{r.roles.join('; ') || '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        {r.status === 'error' ? (
                          <Group gap={4} wrap="nowrap">
                            <IconAlertTriangle size={14} color="var(--status-critical)" aria-hidden />
                            <Text size="sm">пропуск</Text>
                          </Group>
                        ) : (
                          <Group gap={4} wrap="nowrap">
                            {r.status === 'create' ? <IconCheck size={14} color="var(--status-good)" aria-hidden /> : <IconRefresh size={14} color="var(--series-1)" aria-hidden />}
                            <Text size="sm">{r.status === 'create' ? (done ? 'создан' : 'создать') : done ? 'обновлён' : 'обновить'}</Text>
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {r.messages.length > 0 && (
                          <List size="xs" spacing={0}>
                            {r.messages.map((m, i) => (
                              <List.Item key={i} c={r.status === 'error' && m.startsWith('строка') ? 'var(--status-critical)' : undefined}>
                                {m}
                              </List.Item>
                            ))}
                          </List>
                        )}
                      </Table.Td>
                      {done && (
                        <Table.Td>
                          <Text ff="monospace" size="sm">
                            {r.password ?? ''}
                          </Text>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group justify="flex-end">
              {done ? (
                <Button onClick={close}>Готово</Button>
              ) : (
                <>
                  <Button variant="default" onClick={() => setResult(null)}>
                    Назад к таблице
                  </Button>
                  <Button disabled={!(result.created + result.updated)} loading={busy} onClick={() => send(false)}>
                    Загрузить {result.created + result.updated}
                  </Button>
                </>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
