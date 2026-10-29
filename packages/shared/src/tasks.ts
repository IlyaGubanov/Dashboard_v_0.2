/**
 * «Мои задачи» — напоминания пользователю: что внести, что устранить, что проверить, что закрыть.
 * Считаются при каждом запросе из текущих данных, отдельно не хранятся.
 */
export type TaskKind = 'entry' | 'openPeriod' | 'closePeriod' | 'remarksFix' | 'remarksCheck';

export interface MyTask {
  key: string;
  kind: TaskKind;
  direction: { code: string; shortName: string };
  title: string;
  detail: string | null;
  count: number;
  /** critical — срок прошёл; warning — пора сделать; info — к сведению */
  level: 'critical' | 'warning' | 'info';
  /** куда перейти: вкладка направления */
  tab: 'entry' | 'remarks' | 'manage';
  /** отбор на вкладке замечаний: ждут проверки / мои */
  view?: 'check' | 'mine';
}

export interface MyTasks {
  items: MyTask[];
  /** число задач уровня warning и critical — для значка */
  badge: number;
}
