import { Group, Text, Tooltip } from '@mantine/core';
import { IconCircleCheck, IconCircleDashed, IconExclamationCircle, IconPlayerPause, IconTargetArrow } from '@tabler/icons-react';
import type { Forecast } from '@mvs/shared';
import { date } from './format';

const days = (n: number) => {
  const a = Math.abs(n), m10 = a % 10, m100 = a % 100;
  return m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'дня' : 'дней';
};

/** Пояснение: откуда взялся прогноз. */
export function forecastHint(f: Forecast) {
  const pace = f.pacePerWeek != null ? `темп ${(f.pacePerWeek * 100).toFixed(1).replace('.', ',')} п.п. в неделю с ${date(f.since)}` : null;
  const plan = f.planEnd ? `плановое окончание ${date(f.planEnd)}` : 'плановое окончание не задано';
  switch (f.status) {
    case 'done':
      return 'Выполнено';
    case 'nodata':
      return 'Мало истории: нужен факт хотя бы за две отчётные точки с разницей от недели';
    case 'stalled':
      return `Готовность почти не растёт (${pace ?? 'темпа нет'}) — при таком темпе работы не завершатся. ${plan}`;
    default:
      return `По текущему темпу (${pace}) — завершение ${date(f.date)}; ${plan}`;
  }
}

/** Прогноз завершения: иконка + подпись (цвет не несёт смысл в одиночку). */
export function ForecastLabel({ f, size = 'sm', withDate = true }: { f: Forecast | null; size?: 'xs' | 'sm'; withDate?: boolean }) {
  if (!f || f.status === 'nodata')
    return (
      <Text size={size} c="dimmed">
        —
      </Text>
    );
  const s = size === 'xs' ? 14 : 16;
  const view = {
    done: { Icon: IconCircleCheck, color: 'var(--status-good)', text: 'выполнено' },
    ontime: { Icon: IconTargetArrow, color: 'var(--status-good)', text: withDate ? `${date(f.date)} · в срок` : 'в срок' },
    // опоздание — отставание от срока: со знаком «−» и значком «!»
    late: {
      Icon: IconExclamationCircle,
      color: (f.delayDays ?? 0) > 30 ? 'var(--status-critical)' : 'var(--status-warning)',
      text: `${withDate ? `${date(f.date)} · ` : ''}−${f.delayDays} ${days(f.delayDays ?? 0)}`,
    },
    stalled: { Icon: IconPlayerPause, color: 'var(--status-critical)', text: 'темпа нет' },
    noplan: { Icon: IconCircleDashed, color: 'var(--status-none)', text: date(f.date) },
  }[f.status];
  return (
    <Tooltip label={forecastHint(f)} multiline w={300} withArrow>
      <Group gap={4} wrap="nowrap" style={{ cursor: 'help' }}>
        <view.Icon size={s} color={view.color} stroke={2.2} aria-hidden />
        <Text size={size} fw={f.status === 'late' || f.status === 'stalled' ? 600 : 400} style={{ whiteSpace: 'nowrap' }}>
          {view.text}
        </Text>
      </Group>
    </Tooltip>
  );
}

/** Ключ сортировки: опаздывающие и «темпа нет» — наверх. */
export const forecastSort = (f: Forecast | null) =>
  !f || f.status === 'nodata' ? null : f.status === 'stalled' ? 10_000 : f.status === 'done' ? -10_000 : (f.delayDays ?? -5_000);
