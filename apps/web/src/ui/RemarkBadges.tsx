import { Group, Text } from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconCircleX, IconClockCheck, IconFlag, IconFlagFilled, IconProgress } from '@tabler/icons-react';
import { REMARK_SEVERITY_LABELS, REMARK_STATUS_LABELS, type RemarkSeverity, type RemarkStatus } from '@mvs/shared';

/** Статус замечания — иконка + подпись (цвет не несёт смысл в одиночку). */
const STATUS: Record<RemarkStatus, { color: string; Icon: typeof IconCircleCheck; short: string }> = {
  OPEN: { color: 'var(--status-critical)', Icon: IconAlertCircle, short: 'Открыто' },
  IN_PROGRESS: { color: 'var(--series-1)', Icon: IconProgress, short: 'В работе' },
  RESOLVED: { color: 'var(--status-warning)', Icon: IconClockCheck, short: 'На проверке' },
  VERIFIED: { color: 'var(--status-good)', Icon: IconCircleCheck, short: 'Принято' },
  REJECTED: { color: 'var(--status-none)', Icon: IconCircleX, short: 'Снято' },
};

export function RemarkStatusBadge({ status, full, size = 'sm' }: { status: RemarkStatus; full?: boolean; size?: 'xs' | 'sm' }) {
  const v = STATUS[status];
  return (
    <Group gap={4} wrap="nowrap">
      <v.Icon size={size === 'xs' ? 14 : 16} color={v.color} stroke={2.2} aria-hidden />
      <Text size={size} fw={500} style={{ whiteSpace: 'nowrap' }}>
        {full ? REMARK_STATUS_LABELS[status] : v.short}
      </Text>
    </Group>
  );
}

/** Важность: высокая и критическая — заметнее (заливка флажка, жирный текст). */
export function SeverityLabel({ severity, size = 'sm' }: { severity: RemarkSeverity; size?: 'xs' | 'sm' }) {
  const strong = severity === 'HIGH' || severity === 'CRITICAL';
  const Icon = strong ? IconFlagFilled : IconFlag;
  const color = severity === 'CRITICAL' ? 'var(--status-critical)' : severity === 'HIGH' ? 'var(--status-warning)' : 'var(--status-none)';
  return (
    <Group gap={4} wrap="nowrap">
      <Icon size={size === 'xs' ? 13 : 15} color={color} aria-hidden />
      <Text size={size} fw={strong ? 600 : 400} style={{ whiteSpace: 'nowrap' }}>
        {REMARK_SEVERITY_LABELS[severity]}
      </Text>
    </Group>
  );
}
