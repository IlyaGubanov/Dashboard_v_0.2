import { ActionIcon, Card, Group, Indicator, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { IconAlertCircle, IconBell, IconCircleCheck, IconClipboardList, IconInfoCircle } from '@tabler/icons-react';
import type { MyTask } from '@mvs/shared';
import { myTasksQuery } from '../api';

const LEVEL = {
  critical: { Icon: IconAlertCircle, color: 'var(--status-critical)' },
  warning: { Icon: IconClipboardList, color: 'var(--status-warning)' },
  info: { Icon: IconInfoCircle, color: 'var(--status-none)' },
} as const;

function TaskRow({ t, onGo }: { t: MyTask; onGo: (t: MyTask) => void }) {
  const v = LEVEL[t.level];
  return (
    <UnstyledButton className="row-link" p={8} onClick={() => onGo(t)}>
      <Group gap={8} wrap="nowrap" align="flex-start">
        <v.Icon size={18} color={v.color} stroke={2} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={500}>
            {t.title}
          </Text>
          <Text size="xs" c="dimmed">
            {t.direction.shortName}
            {t.detail ? ` · ${t.detail}` : ''}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  );
}

function useGo() {
  const navigate = useNavigate();
  return (t: MyTask) => navigate({ to: '/d/$code', params: { code: t.direction.code }, search: { tab: t.tab, rv: t.view } });
}

/** Колокольчик в шапке: число задач «пора сделать» и «срок прошёл», список по щелчку. */
export function TasksBell() {
  const { data } = useQuery(myTasksQuery);
  const nav = useGo();
  const [opened, { toggle, close }] = useDisclosure(false);
  const go = (t: MyTask) => (close(), nav(t));
  const items = data?.items ?? [];
  return (
    <Popover position="bottom-end" width={360} shadow="md" withArrow opened={opened} onChange={(o) => (o ? undefined : close())}>
      <Popover.Target>
        <Indicator label={data?.badge} size={16} disabled={!data?.badge} color={items.some((i) => i.level === 'critical') ? 'red' : 'orange'} offset={4}>
          <ActionIcon variant="subtle" color="gray" size="lg" title="Мои задачи" aria-label={`Мои задачи: ${data?.badge ?? 0}`} onClick={toggle}>
            <IconBell size={18} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={6}>
        <Text fw={600} px={8} py={4}>
          Мои задачи
        </Text>
        {items.length ? (
          <Stack gap={0} mah={420} style={{ overflowY: 'auto' }}>
            {items.map((t) => (
              <TaskRow key={t.key} t={t} onGo={go} />
            ))}
          </Stack>
        ) : (
          <Group gap={6} p={8}>
            <IconCircleCheck size={18} color="var(--status-good)" aria-hidden />
            <Text size="sm">Задач нет — всё внесено и проверено</Text>
          </Group>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

/** Блок «Мои задачи» на главной — только если есть что делать. */
export function MyTasksCard() {
  const { data } = useQuery(myTasksQuery);
  const go = useGo();
  const items = (data?.items ?? []).filter((i) => i.level !== 'info');
  if (!items.length) return null;
  return (
    <Card withBorder padding="sm">
      <Text fw={600} px={8} mb={4}>
        Мои задачи
      </Text>
      <Stack gap={0}>
        {items.map((t) => (
          <TaskRow key={t.key} t={t} onGo={go} />
        ))}
      </Stack>
    </Card>
  );
}
