import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Modal, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconArchive, IconArchiveOff, IconCheck, IconPencil, IconPlus, IconX } from '@tabler/icons-react';
import { departmentSchema, type DepartmentItem } from '@mvs/shared';
import { api, ApiError, departmentsQuery } from '../api';

/** Справочник подразделений: добавить, переименовать, убрать в архив (сотрудники остаются в нём, новым не выбрать). */
export function DepartmentsModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { data: deps = [] } = useQuery({ ...departmentsQuery, enabled: opened });
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string; error?: string } | null>(null);

  const done = async (message: string) => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['departments'] }), qc.invalidateQueries({ queryKey: ['users'] })]);
    notifications.show({ color: 'green', message });
  };
  const fail = (e: unknown) => (e instanceof ApiError ? (e.fields.name ?? e.message) : 'Не удалось сохранить');

  const add = useMutation({
    mutationFn: (n: string) => api<DepartmentItem>('/departments', { method: 'POST', body: { name: n } }),
    onSuccess: (d) => {
      setName('');
      setError(null);
      return done(`Подразделение «${d.name}» добавлено`);
    },
    onError: (e) => setError(fail(e)),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; isArchived?: boolean }) => api<DepartmentItem>(`/departments/${id}`, { method: 'PATCH', body }),
    onSuccess: (d, v) => {
      setEditing(null);
      return done(v.isArchived === undefined ? 'Подразделение переименовано' : d.isArchived ? `«${d.name}» — в архиве` : `«${d.name}» возвращено из архива`);
    },
    onError: (e, v) => (v.name !== undefined && editing ? setEditing({ ...editing, error: fail(e) }) : notifications.show({ color: 'red', message: fail(e) })),
  });

  function submitNew() {
    const r = departmentSchema.safeParse({ name });
    if (!r.success) return setError(r.error.issues[0].message);
    add.mutate(r.data.name);
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Подразделения" size="lg">
      <Stack>
        <Group align="flex-start" wrap="nowrap">
          <TextInput
            style={{ flex: 1 }}
            aria-label="Новое подразделение"
            placeholder="Новое подразделение, например «Отдел технического надзора»"
            value={name}
            error={error}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitNew()}
          />
          <Button leftSection={<IconPlus size={16} />} loading={add.isPending} onClick={submitNew}>
            Добавить
          </Button>
        </Group>
        {!deps.length && <Text c="dimmed">Справочник пуст. Подразделения можно добавлять и прямо в карточке сотрудника.</Text>}
        {!!deps.length && (
          <Table.ScrollContainer minWidth={360}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Название</Table.Th>
                  <Table.Th ta="right">Сотрудников</Table.Th>
                  <Table.Th w={90} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {deps.map((d) => (
                  <Table.Tr key={d.id} style={{ opacity: d.isArchived ? 0.6 : 1 }}>
                    <Table.Td>
                      {editing?.id === d.id ? (
                        <TextInput
                          size="xs"
                          aria-label="Название подразделения"
                          value={editing.name}
                          error={editing.error}
                          autoFocus
                          onChange={(e) => setEditing({ id: d.id, name: e.currentTarget.value })}
                          onKeyDown={(e) => e.key === 'Enter' && patch.mutate({ id: d.id, name: editing.name })}
                        />
                      ) : (
                        <Group gap={6}>
                          <Text size="sm">{d.name}</Text>
                          {d.isArchived && (
                            <Badge size="xs" color="gray" variant="light">
                              архив
                            </Badge>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{d.users}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {editing?.id === d.id ? (
                          <>
                            <ActionIcon variant="subtle" aria-label="Сохранить" onClick={() => patch.mutate({ id: d.id, name: editing.name })}>
                              <IconCheck size={16} />
                            </ActionIcon>
                            <ActionIcon variant="subtle" color="gray" aria-label="Отмена" onClick={() => setEditing(null)}>
                              <IconX size={16} />
                            </ActionIcon>
                          </>
                        ) : (
                          <>
                            <Tooltip label="Переименовать">
                              <ActionIcon variant="subtle" aria-label="Переименовать" onClick={() => setEditing({ id: d.id, name: d.name })}>
                                <IconPencil size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={d.isArchived ? 'Вернуть из архива' : 'В архив'}>
                              <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label={d.isArchived ? 'Вернуть из архива' : 'В архив'}
                                onClick={() => patch.mutate({ id: d.id, isArchived: !d.isArchived })}
                              >
                                {d.isArchived ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                              </ActionIcon>
                            </Tooltip>
                          </>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Modal>
  );
}
