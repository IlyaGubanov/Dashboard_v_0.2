import { useState } from 'react';
import { Alert, Badge, Card, Group, Pagination, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { directionQueries } from '../../api';

const ACTION: Record<string, { label: string; color: string }> = {
  CREATE: { label: 'внесено', color: 'blue' },
  UPDATE: { label: 'изменено', color: 'yellow' },
  DELETE: { label: 'удалено', color: 'red' },
  IMPORT: { label: 'загрузка', color: 'gray' },
  PERIOD_OPEN: { label: 'точка открыта', color: 'teal' },
  PERIOD_CLOSE: { label: 'точка закрыта', color: 'green' },
};
const PAGE = 50;

const show = (v: unknown) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('ru-RU');
  return String(v);
};

/** Журнал изменений направления: кто, когда, по какому объекту, что было → что стало. */
export function JournalTab({ code }: { code: string }) {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error, isFetching } = useQuery({
    ...directionQueries.audit(code, { skip: (page - 1) * PAGE, take: PAGE, from: from || undefined, to: to || undefined }),
    placeholderData: (prev) => prev,
  });
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;

  return (
    <Stack>
      <Group gap="sm" align="flex-end">
        <TextInput type="date" label="С" value={from} onChange={(e) => (setFrom(e.currentTarget.value), setPage(1))} w={170} />
        <TextInput type="date" label="По" value={to} onChange={(e) => (setTo(e.currentTarget.value), setPage(1))} w={170} />
        <Text size="sm" c="dimmed" pb={8}>
          записей: {data.total.toLocaleString('ru-RU')}
          {isFetching ? ' · обновление…' : ''}
        </Text>
      </Group>
      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={900}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={140}>Когда</Table.Th>
                <Table.Th w={170}>Кто</Table.Th>
                <Table.Th w={150}>Действие</Table.Th>
                <Table.Th>Объект и что</Table.Th>
                <Table.Th>Было → стало</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.rows.map((r) => {
                const a = ACTION[r.action] ?? { label: r.action.toLowerCase(), color: 'gray' };
                return (
                  <Table.Tr key={r.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</Table.Td>
                    <Table.Td>{r.user ?? <Text c="dimmed" size="sm">система</Text>}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={a.color} size="sm" style={{ overflow: 'visible' }} maw="none">
                        {a.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {r.site && (
                        <Text size="sm" fw={500}>
                          {r.site}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {r.comment}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {r.changes.map((c) => (
                        <Text key={c.field} size="xs">
                          {c.field}: <s style={{ opacity: 0.7 }}>{show(c.before)}</s> → <b>{show(c.after)}</b>
                        </Text>
                      ))}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      {data.total > PAGE && <Pagination total={Math.ceil(data.total / PAGE)} value={page} onChange={setPage} />}
    </Stack>
  );
}
