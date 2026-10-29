import { Alert, Badge, Card, Group, Skeleton, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { MEMBER_ROLE_LABELS, MEMBER_SCOPE_LABELS, type MemberRole, type MemberScope } from '@mvs/shared';
import { directionQueries } from '../../api';
import { date, int } from '../../ui/format';

const ASSIGN: Record<string, string> = {
  CURATOR: 'куратор',
  ENTRY: 'ввод',
  RESPONSIBLE: 'ответственный',
  FOREMAN: 'прораб',
  CHIEF_ENGINEER: 'ГИП',
};

/** Ответственные направления и контроль заполнения: кто внёс данные в текущую отчётную точку. */
export function PeopleTab({ code }: { code: string }) {
  const { data, error } = useQuery(directionQueries.people(code));
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return <Skeleton h={400} />;

  const editors = data.people.filter((p) => p.role === 'EDITOR');
  const entered = editors.filter((p) => p.enteredCurrent).length;
  const cur = data.currentPeriod;

  return (
    <Stack>
      {cur && editors.length > 0 && (
        <Alert color={entered === editors.length ? 'green' : 'orange'} variant="light">
          Отчётная точка {date(cur.date)} {cur.status === 'OPEN' ? 'открыта' : 'закрыта'}: внесли данные {entered} из {editors.length} ответственных за ввод.
          {entered < editors.length && ` Не внесли: ${editors.filter((p) => !p.enteredCurrent).map((p) => p.fullName).join(', ')}.`}
        </Alert>
      )}
      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={1000}>
          <Table striped verticalSpacing="sm" styles={{ td: { whiteSpace: 'nowrap' }, th: { whiteSpace: 'nowrap' } }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Сотрудник</Table.Th>
                <Table.Th>Роль в направлении</Table.Th>
                <Table.Th>На объектах</Table.Th>
                <Table.Th ta="right">Позиций (ответственный)</Table.Th>
                <Table.Th ta="right">Внесено записей</Table.Th>
                <Table.Th>Последний ввод</Table.Th>
                <Table.Th>В текущей точке</Table.Th>
                <Table.Th>Контакты</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.people.map((p) => (
                <Table.Tr key={p.userId}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {p.fullName}
                    </Text>
                    <Group gap={4}>
                      <Text size="xs" c="dimmed">
                        {p.position ?? ''}
                      </Text>
                      {!p.canLogin && (
                        <Badge size="xs" variant="outline" color="gray">
                          без входа
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {p.role ? (
                      <>
                        <Text size="sm">{MEMBER_ROLE_LABELS[p.role as MemberRole]}</Text>
                        {p.role === 'EDITOR' && p.scope && (
                          <Text size="xs" c="dimmed">
                            {p.scope === 'SECTIONS' ? p.sections.join(', ') : MEMBER_SCOPE_LABELS[p.scope as MemberScope].toLowerCase()}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {Object.entries(p.assignments)
                      .map(([r, n]) => `${ASSIGN[r] ?? r}: ${n}`)
                      .join(' · ') || '—'}
                  </Table.Td>
                  <Table.Td ta="right">{p.responsibleItems ? int(p.responsibleItems) : '—'}</Table.Td>
                  <Table.Td ta="right">{p.entries ? int(p.entries) : '—'}</Table.Td>
                  <Table.Td>{p.lastEntryAt ? new Date(p.lastEntryAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</Table.Td>
                  <Table.Td>
                    {p.role === 'EDITOR' ? (
                      p.enteredCurrent ? (
                        <Group gap={4} wrap="nowrap">
                          <IconCircleCheck size={16} color="var(--status-good)" aria-hidden />
                          <Text size="sm">внёс</Text>
                        </Group>
                      ) : (
                        <Group gap={4} wrap="nowrap">
                          <IconCircleX size={16} color="var(--status-critical)" aria-hidden />
                          <Text size="sm">не внёс</Text>
                        </Group>
                      )
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{[p.phone, p.email].filter(Boolean).join(' · ') || '—'}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      <Text size="xs" c="dimmed">
        Роли в направлении и область прав назначает администратор в «Пользователи и роли». Ответственные по объектам и позициям — из данных направления.
      </Text>
    </Stack>
  );
}
