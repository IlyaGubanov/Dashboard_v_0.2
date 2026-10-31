import { Group, Table, Text, Tooltip, VisuallyHidden } from '@mantine/core';
import type { SiteRisk } from '@mvs/shared';
import { TrackerValue, stageDone, type TrackerRawValue, type TrackerStage } from './TrackerValue';
import { RiskIcon } from './RiskBadge';
import { matrixStatusStyle } from './MatrixStatus';
import { date } from './format';

/** Для надстроек есть признак завершения и срок, но нет числового графика отставания. */
export function trackerState(stage: TrackerStage, value: TrackerRawValue, planDate: string | null | undefined, today: string) {
  const missing = value == null || value === '';
  const known = stage.valueType !== 'STATUS' || stage.options?.some((o) => o.value === value);
  const done = known ? stageDone(stage, value) : null;
  let risk: SiteRisk = 'na';
  let label = missing ? 'Нет данных' : 'Нет данных для оценки';
  if (done != null && Number.isFinite(done)) {
    if (done >= 1) { risk = 'done'; label = 'Выполнено'; }
    else if (planDate && planDate < today) { risk = 'warn'; label = 'Просрочено'; }
    else if (planDate) { risk = 'wait'; label = 'Срок не наступил'; }
    else label = 'Срок не задан';
  }
  return { risk, label };
}

export function TrackerMatrixCell({ stage, value, planDate, dueDate, today }: {
  stage: TrackerStage; value: TrackerRawValue; planDate?: string | null; dueDate?: string | null; today: string;
}) {
  const state = trackerState(stage, value, planDate, today);
  return (
    <Tooltip multiline w={260} withArrow events={{ hover: true, focus: true, touch: true }} label={
      <div><b>{stage.name}: {state.label}</b><div><TrackerValue stage={stage} value={value} /></div>
        {planDate && <div>Плановая дата: {date(planDate)}</div>}
        {dueDate && <div>Завершение: {date(dueDate)}</div>}
      </div>
    }>
      <Table.Td className="matrix-status-cell" data-risk={state.risk} style={matrixStatusStyle(state.risk)} tabIndex={0}>
        <VisuallyHidden>{stage.name}: {state.label}. </VisuallyHidden>
        <Group gap={4} wrap="nowrap">
          <RiskIcon risk={state.risk} />
          {value == null || value === '' ? <Text c="dimmed">—</Text> : <TrackerValue stage={stage} value={value} />}
        </Group>
      </Table.Td>
    </Tooltip>
  );
}
