import { z } from 'zod';

export const STAFFING_CATEGORIES = ['АУП', 'ВП', 'ОП'] as const;
export const STAFFING_CATEGORY_LABELS = { АУП: 'Административно-управленческий персонал', ВП: 'Вспомогательный персонал', ОП: 'Основной персонал' };
const quantity = z.number().finite().min(0, 'Значение не может быть отрицательным').max(1_000_000).nullable();
const identity = { id: z.string().min(1).max(80), department: z.string().trim().min(2, 'Укажите подразделение').max(300), category: z.enum(STAFFING_CATEGORIES) };
export const staffingRowSchema = z.object({
  ...identity,
  planned: quantity,
  actual: z.number().int('Факт указывается в целых сотрудниках').min(0).max(1_000_000).nullable(),
  note: z.string().max(2000).default(''), function: z.string().max(10000).default(''), isArchived: z.boolean().default(false),
  /** Группа на диаграмме распределения; пусто — определяется по названию (staffingGroupOf). */
  group: z.string().trim().max(120, 'Название группы — не длиннее 120 символов').optional(),
});
export type StaffingRow = z.infer<typeof staffingRowSchema>;
export const staffingMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'Укажите месяц');
const dateSchema = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Некорректная дата');
const uniqueRows = <T extends { id: string }>(rows: T[]) => new Set(rows.map(r => r.id)).size === rows.length;
/** Должность среза: план (штатные единицы) и факт; потребность = план − факт. rowId — подразделение, group следует за его группой (см. staffingLinkPositions). */
export const staffingPositionSchema = z.object({
  id: z.string().min(1).max(80), group: z.string().trim().min(1, 'Укажите группу').max(120), title: z.string().trim().min(2, 'Укажите должность').max(200),
  planned: quantity, actual: z.number().int('Факт указывается в целых сотрудниках').min(0).max(1_000_000).nullable(),
  rowId: z.string().min(1).max(80).optional(), isArchived: z.boolean().default(false),
});
export type StaffingPosition = z.infer<typeof staffingPositionSchema>;
export const staffingPeriodSchema = z.object({
  month: staffingMonthSchema, asOf: dateSchema, note: z.string().max(3000).default(''), rows: z.array(staffingRowSchema).max(1000).refine(uniqueRows, 'Подразделение указано дважды'),
  positions: z.array(staffingPositionSchema).max(5000).refine(uniqueRows, 'Должность указана дважды').optional(),
}).refine(v => v.asOf.slice(0, 7) === v.month, { message: 'Дата среза должна относиться к выбранному месяцу', path: ['asOf'] })
  .refine(v => JSON.stringify(v).length <= 2_000_000, 'Срез слишком большой: сократите описания или число подразделений');
export type StaffingPeriodData = z.infer<typeof staffingPeriodSchema>;
export interface StaffingPeriod extends StaffingPeriodData { version: number; isArchived: boolean; updatedAt: string }
/** Запись среза: дополнительно запрещает одну должность дважды в подразделении. Чтение идёт по staffingPeriodSchema, чтобы старые данные всегда открывались. */
export const staffingPeriodWriteSchema = staffingPeriodSchema.superRefine((v, ctx) => {
  const title = staffingDuplicatePosition(v.positions);
  if (title) ctx.addIssue({ code: 'custom', path: ['positions'], message: `Должность «${title}» указана дважды в одном подразделении` });
});
export const staffingPeriodSaveSchema = z.object({ version: z.number().int().positive(), data: staffingPeriodWriteSchema, isArchived: z.boolean().optional() });
export const staffingPayrollSchema = z.object({
  year: z.number().int().min(2020).max(2099), label: z.string().trim().min(2).max(200),
  rows: z.array(z.object({ ...identity, amount: quantity })).max(1000).refine(uniqueRows, 'Подразделение указано дважды'),
});
export type StaffingPayrollData = z.infer<typeof staffingPayrollSchema>;
export interface StaffingPayroll extends StaffingPayrollData { version: number; updatedAt: string }
export const staffingPayrollSaveSchema = z.object({ version: z.number().int().positive(), data: staffingPayrollSchema });
/** Приём и увольнение за один день по группам (как лист «Приемыувольнения»: вносится утром за вчера). */
const headcount = z.number().int('Укажите целое число сотрудников').min(0, 'Значение не может быть отрицательным').max(100_000);
export const staffingMovementDaySchema = z.object({
  date: dateSchema, note: z.string().max(2000).default(''),
  rows: z.array(z.object({ group: z.string().trim().min(1, 'Укажите группу').max(120), hired: headcount, dismissed: headcount })).max(200)
    .refine(rows => new Set(rows.map(r => r.group)).size === rows.length, 'Группа указана дважды'),
});
export type StaffingMovementDayData = z.infer<typeof staffingMovementDaySchema>;
export interface StaffingMovementDay extends StaffingMovementDayData { version: number; updatedAt: string }
/** Без version — новый день; с version — правка существующего (при расхождении 409). */
export const staffingMovementSaveSchema = z.object({ version: z.number().int().positive().optional(), data: staffingMovementDaySchema });
export type StaffingMovementMode = 'day' | 'week' | 'month';
const isoDay = (v: string) => new Date(`${v}T00:00:00Z`);
const ymd = (v: Date) => v.toISOString().slice(0, 10);
/** Начало периода: сам день, понедельник недели или первое число месяца. */
export function staffingMovementBucket(date: string, mode: StaffingMovementMode): string {
  if (mode === 'day') return date;
  if (mode === 'month') return `${date.slice(0, 7)}-01`;
  const d = isoDay(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return ymd(d);
}
/** Суммы приёма и увольнения по периодам в диапазоне [from, to]; group — только одна группа. Пустые периоды внутри диапазона — нули. */
export function staffingMovementSeries(days: StaffingMovementDayData[], mode: StaffingMovementMode, from: string, to: string, group?: string) {
  const buckets = new Map<string, { start: string; hired: number; dismissed: number; days: number }>();
  for (let d = isoDay(staffingMovementBucket(from, mode)); ymd(d) <= to; mode === 'month' ? d.setUTCMonth(d.getUTCMonth() + 1) : d.setUTCDate(d.getUTCDate() + (mode === 'week' ? 7 : 1))) {
    buckets.set(ymd(d), { start: ymd(d), hired: 0, dismissed: 0, days: 0 });
  }
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    const b = buckets.get(staffingMovementBucket(day.date, mode));
    if (!b) continue;
    b.days++;
    for (const r of day.rows) if (!group || r.group === group) { b.hired += r.hired; b.dismissed += r.dismissed; }
  }
  return [...buckets.values()];
}
/** Итоги по группам за диапазон: принято, уволено, сальдо (от большего оборота к меньшему). */
export function staffingMovementByGroup(days: StaffingMovementDayData[], from: string, to: string) {
  const map = new Map<string, { group: string; hired: number; dismissed: number }>();
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    for (const r of day.rows) {
      const g = map.get(r.group) ?? { group: r.group, hired: 0, dismissed: 0 };
      g.hired += r.hired; g.dismissed += r.dismissed; map.set(r.group, g);
    }
  }
  return [...map.values()].map(g => ({ ...g, net: g.hired - g.dismissed })).sort((a, b) => b.hired + b.dismissed - (a.hired + a.dismissed) || a.group.localeCompare(b.group, 'ru'));
}
/** Должности группы с потребностью max(план − факт, 0); итог — суммы известных значений. */
export function staffingGroupPositions(positions: StaffingPosition[] | undefined, group: string) {
  const items = (positions ?? []).filter(p => p.group === group && !p.isArchived)
    .map(p => ({ ...p, need: p.planned == null || p.actual == null ? null : Math.max(0, Math.round((p.planned - p.actual) * 100) / 100) }))
    .sort((a, b) => (b.need ?? -1) - (a.need ?? -1) || (b.actual ?? -1) - (a.actual ?? -1) || a.title.localeCompare(b.title, 'ru'));
  const sum = (k: 'planned' | 'actual' | 'need') => items.some(p => p[k] != null) ? Math.round(items.reduce((s, p) => s + (p[k] ?? 0), 0) * 100) / 100 : null;
  return { items, planned: sum('planned'), actual: sum('actual'), need: sum('need') };
}
/** Ключ сравнения названий: без регистра и лишних пробелов; «а» на конце — след старого импорта («Стропальщик а»). */
export function staffingTitleKey(title: string) { return title.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru').replace(/ а$/, ''); }
/** Название без разряда: «Стропальщик 3 разряда» → «Стропальщик». */
export function staffingTitleBase(title: string) { return title.replace(/\s*\d+\s*-?\s*(?:го\s+)?разряд[а-яё]*/gi, ' ').replace(/\s+/g, ' ').trim(); }
/** Название должности, которая повторяется в одном подразделении (архивные не считаются), иначе null. */
export function staffingDuplicatePosition(positions: StaffingPosition[] | undefined): string | null {
  const seen = new Set<string>();
  for (const p of positions ?? []) {
    if (p.isArchived) continue;
    const key = `${p.rowId ?? `group:${p.group}`}|${staffingTitleKey(p.title)}`;
    if (seen.has(key)) return p.title;
    seen.add(key);
  }
  return null;
}
type StaffingStructure = Pick<StaffingPeriodData, 'rows' | 'positions'>;
/** Связывает должности с подразделениями: group всегда следует за подразделением; старая должность без rowId привязывается, если в её группе одно действующее подразделение. */
export function staffingLinkPositions<T extends StaffingStructure>(data: T): T {
  if (!data.positions?.length) return data;
  const byId = new Map(data.rows.map(r => [r.id, r]));
  const byGroup = new Map<string, StaffingRow[]>();
  for (const r of data.rows) if (!r.isArchived) byGroup.set(staffingGroupOf(r), [...(byGroup.get(staffingGroupOf(r)) ?? []), r]);
  return { ...data, positions: data.positions.map(p => {
    const row = p.rowId ? byId.get(p.rowId) : undefined;
    if (row) return { ...p, group: staffingGroupOf(row) };
    const { rowId: _rowId, ...rest } = p;
    const only = byGroup.get(p.group);
    return only?.length === 1 ? { ...rest, rowId: only[0].id } : rest;
  }) };
}
/** Действующие должности: без архивных и без должностей архивных подразделений. */
export function staffingActivePositions(data: StaffingStructure): StaffingPosition[] {
  const archived = new Set(data.rows.filter(r => r.isArchived).map(r => r.id));
  return (data.positions ?? []).filter(p => !p.isArchived && !(p.rowId && archived.has(p.rowId)));
}
/** Суммы известных значений по действующим должностям; пропуски не считаются нулём. */
export function staffingPositionTotals(positions: StaffingPosition[]) {
  const items = positions.filter(p => !p.isArchived);
  const sum = (pick: (p: StaffingPosition) => number | null) => items.some(p => pick(p) != null) ? Math.round(items.reduce((s, p) => s + (pick(p) ?? 0), 0) * 100) / 100 : null;
  return { count: items.length, planned: sum(p => p.planned), actual: sum(p => p.actual), need: sum(p => p.planned == null || p.actual == null ? null : Math.max(0, p.planned - p.actual)) };
}
/** Итог подразделения расходится с известной суммой должностей. Показатель, которого у должностей нет, не сравнивается: подставлять нечего. */
export function staffingTotalsDiffer(row: Pick<StaffingRow, 'planned' | 'actual'>, totals: Pick<ReturnType<typeof staffingPositionTotals>, 'planned' | 'actual'>) {
  return (totals.planned != null && totals.planned !== row.planned) || (totals.actual != null && totals.actual !== row.actual);
}
/** Штат и факт подразделения идут за суммой должностей, пока совпадали с ней; значение, внесённое вручную, не меняется. */
export function staffingSyncRow(row: StaffingRow, before: StaffingPosition[], after: StaffingPosition[]): StaffingRow {
  const was = staffingPositionTotals(before.filter(p => p.rowId === row.id)), now = staffingPositionTotals(after.filter(p => p.rowId === row.id));
  return { ...row, planned: row.planned === was.planned ? now.planned : row.planned, actual: row.actual === was.actual ? now.actual : row.actual };
}
/** Новый список должностей среза: связи и суммы подразделений обновляются. */
export function staffingSetPositions<T extends StaffingStructure>(data: T, positions: StaffingPosition[]): T {
  return staffingLinkPositions({ ...data, rows: data.rows.map(r => staffingSyncRow(r, data.positions ?? [], positions)), positions });
}
/** Копия структуры для нового среза: без архива, факт пустой (или сохраняется по выбору), должности — по выбору. Идентификаторы те же — для сравнения срезов. */
export function staffingCopyStructure(base: StaffingStructure, options: { positions: boolean; actual: boolean }) {
  const actual = <T extends { actual: number | null }>(v: T): T => options.actual ? v : { ...v, actual: null };
  return { rows: base.rows.filter(r => !r.isArchived).map(r => actual({ ...r, note: '' })), ...(options.positions ? { positions: staffingActivePositions(base).map(actual) } : {}) };
}

export interface StaffingTablePosition { title: string; planned: number | null; actual: number | null }
/** Блок таблицы: подразделение (name; null — без заголовка) с итогами из строки заголовка и должностями. */
export interface StaffingTableBlock { name: string | null; planned: number | null; actual: number | null; positions: StaffingTablePosition[] }
export interface StaffingTable { blocks: StaffingTableBlock[]; total: number | null; problems: string[] }
const tableNumber = (v: string | undefined) => { const s = (v ?? '').replace(/[\s ]/g, '').replace(',', '.'); return !s ? null : /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };
const addTablePosition = (block: StaffingTableBlock, p: StaffingTablePosition) => {
  const same = block.positions.find(x => staffingTitleKey(x.title) === staffingTitleKey(p.title));
  if (!same) { block.positions.push(p); return false; }
  const add = (a: number | null, b: number | null) => a == null && b == null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 100) / 100;
  same.planned = add(same.planned, p.planned); same.actual = add(same.actual, p.actual);
  return true;
};
/**
 * Разбор таблицы, скопированной из Excel (как лист «По должностям»: № / Должность / Количество).
 * Строка с номером — должность, без номера — подразделение с итогом; «Общий итог» — контроль. Если номеров нет вообще, вся вставка — должности одного подразделения.
 * Числа: столбцы «План/Штат» и «Факт» по заголовку, без заголовка два числа — план и факт, одно — quantity. ФИО руководителя из названия блока не переносится.
 */
export function parseStaffingTable(text: string, quantity: 'actual' | 'planned' = 'actual'): StaffingTable {
  const lines = text.split(/\r?\n/).map(l => l.split(l.includes('\t') ? '\t' : ';').map(c => c.trim()));
  const numbered = (c: string[]) => /^\d+\.?$/.test(c[0] ?? '') && !!c[1] && Number.isNaN(tableNumber(c[1]));
  const hasNumbers = lines.some(numbered);
  const table: StaffingTable = { blocks: [], total: null, problems: [] };
  let columns: { planned: number; actual: number } | null = null;
  let current: StaffingTableBlock | null = null;
  const open = (name: string | null, planned: number | null, actual: number | null) => { const block: StaffingTableBlock = { name, planned, actual, positions: [] }; current = block; table.blocks.push(block); return block; };
  lines.forEach((cells, i) => {
    if (cells.every(c => !c)) return;
    if (cells.some(c => /^должност/i.test(c))) {
      const at = (re: RegExp) => cells.findIndex(c => re.test(c));
      const planned = at(/план|штат/i), actual = at(/факт/i), count = at(/количеств|числен|чел/i);
      const found = { planned: planned >= 0 ? planned : quantity === 'planned' ? count : -1, actual: actual >= 0 ? actual : quantity === 'actual' ? count : -1 };
      columns = found.planned < 0 && found.actual < 0 ? null : found;
      return;
    }
    const isPosition = numbered(cells);
    const at = isPosition ? 1 : cells.findIndex(c => c);
    const title = cells[at].replace(/\s+/g, ' ');
    const rest = cells.slice(at + 1).filter(Boolean);
    const known = columns as { planned: number; actual: number } | null;
    const raw: [string | undefined, string | undefined] = known ? [cells[known.planned], cells[known.actual]] : rest.length >= 2 ? [rest[0], rest[1]] : quantity === 'planned' ? [rest[0], undefined] : [undefined, rest[0]];
    const planned = tableNumber(raw[0]), actual = tableNumber(raw[1]);
    const problem = (why: string) => { table.problems.push(`Строка ${i + 1}: «${title.slice(0, 80)}» — ${why}`); };
    if (!Number.isNaN(tableNumber(title))) return problem('нет названия');
    if (Number.isNaN(planned) || Number.isNaN(actual)) return problem('не удалось прочитать число');
    if (!isPosition && /^(общий\s+итог|итого|итог|всего)/i.test(title)) { table.total = actual ?? planned; return; }
    if (hasNumbers && !isPosition) {
      const name = title.replace(/\s*\(Рук\.[^)]*\)/i, '').trim();
      if (name.length < 2 || name.length > 300) return problem('название подразделения — от 2 до 300 символов');
      open(name, planned, actual);
      return;
    }
    if (title.length < 2 || title.length > 200) return problem('название должности — от 2 до 200 символов');
    if (actual != null && !Number.isInteger(actual)) return problem('факт указывается в целых сотрудниках');
    if (addTablePosition(current ?? open(null, null, null), { title, planned, actual })) table.problems.push(`«${title.slice(0, 80)}» встречается несколько раз — количество сложено`);
  });
  return table;
}
/** Складывает разряды одной должности: «Стропальщик 3 разряда» и «Стропальщик 4 разряда» → «Стропальщик». */
export function staffingMergeGrades(table: StaffingTable): StaffingTable {
  return { ...table, blocks: table.blocks.map(b => {
    const merged: StaffingTableBlock = { ...b, positions: [] };
    for (const p of b.positions) addTablePosition(merged, { ...p, title: staffingTitleBase(p.title) || p.title });
    return merged;
  }) };
}
/** Подразделение среза для блока таблицы: по точному названию или группе, если в группе одно действующее подразделение. */
export function staffingMatchRow(rows: StaffingRow[], name: string | null): StaffingRow | undefined {
  if (!name) return undefined;
  const key = staffingTitleKey(name);
  const active = rows.filter(r => !r.isArchived);
  const inGroup = active.filter(r => staffingTitleKey(staffingGroupOf(r)) === key);
  return active.find(r => staffingTitleKey(r.department) === key) ?? (inGroup.length === 1 ? inGroup[0] : undefined);
}
/**
 * Вносит должности в список одного подразделения: совпадающие по названию обновляются (и выходят из архива), новые добавляются, пустая ячейка не стирает значение.
 * updateMissing — таблица полная. Таблица факта не перечисляет должности без людей, поэтому должность с планом остаётся вакансией (факт 0), иначе потребность пропала бы.
 * В архив уходят должность без плана и должность, заменённая строками с разрядами («Стропальщик» → «Стропальщик 3 разряда»).
 */
export function staffingMergePositions(existing: StaffingPosition[], incoming: StaffingTablePosition[], target: { rowId: string; group: string }, makeId: () => string, updateMissing = false) {
  const result = [...existing];
  const seen = new Set<string>();
  const bases = new Set(incoming.map(t => staffingTitleKey(staffingTitleBase(t.title))));
  const hasPlanned = incoming.some(t => t.planned != null), hasActual = incoming.some(t => t.actual != null);
  let added = 0, updated = 0, archived = 0, planLost = 0, vacant = 0;
  for (const t of incoming) {
    const key = staffingTitleKey(t.title);
    seen.add(key);
    const same = (p: StaffingPosition) => staffingTitleKey(p.title) === key;
    const i = result.findIndex(p => same(p) && !p.isArchived);
    const at = i >= 0 ? i : result.findIndex(same);
    if (at < 0) { result.push({ id: makeId(), group: target.group, rowId: target.rowId, title: t.title, planned: t.planned, actual: t.actual, isArchived: false }); added++; continue; }
    const p = result[at];
    const next = { ...p, title: t.title, planned: t.planned ?? p.planned, actual: t.actual ?? p.actual, isArchived: false };
    if (next.title !== p.title || next.planned !== p.planned || next.actual !== p.actual || p.isArchived) updated++;
    result[at] = next;
  }
  if (updateMissing) result.forEach((p, i) => {
    if (p.isArchived || seen.has(staffingTitleKey(p.title))) return;
    const replaced = bases.has(staffingTitleKey(staffingTitleBase(p.title)));
    if (!replaced && hasActual && !hasPlanned && p.planned != null) { result[i] = { ...p, actual: 0 }; vacant++; return; }
    // таблица плана ничего не говорит о людях: занятую должность не трогаем
    if (!replaced && hasPlanned && !hasActual && p.actual != null) return;
    result[i] = { ...p, isArchived: true }; archived++;
    if (p.planned != null) planLost++;
  });
  return { positions: result, added, updated, archived, planLost, vacant };
}
/** Загрузка таблицы в срез. rowId: null — создать подразделение из названия блока. Итог из строки блока важнее суммы должностей; показатель, которого нет в таблице, не меняется. */
export function staffingApplyTable<T extends StaffingStructure>(data: T, items: { block: StaffingTableBlock; rowId: string | null }[], options: { updateMissing: boolean; makeId: () => string }) {
  const linked = staffingLinkPositions(data);
  let rows = [...linked.rows], positions = [...(linked.positions ?? [])];
  const summary = { added: 0, updated: 0, archived: 0, planLost: 0, vacant: 0, rowsAdded: 0 };
  for (const { block, rowId } of items) {
    let row = rows.find(r => r.id === rowId);
    if (!row) {
      row = { id: options.makeId(), department: block.name ?? 'Новое подразделение', category: /АУП|управленч/i.test(block.name ?? '') ? 'АУП' : 'ОП', planned: null, actual: null, note: '', function: '', isArchived: false, ...(block.name ? { group: block.name.slice(0, 120).trim() } : {}) };
      rows.push(row); summary.rowsAdded++;
    }
    const id = row.id;
    const merged = staffingMergePositions(positions.filter(p => p.rowId === id), block.positions, { rowId: id, group: staffingGroupOf(row) }, options.makeId, options.updateMissing);
    positions = [...positions.filter(p => p.rowId !== id), ...merged.positions];
    summary.added += merged.added; summary.updated += merged.updated; summary.archived += merged.archived; summary.planLost += merged.planLost; summary.vacant += merged.vacant;
    const totals = staffingPositionTotals(merged.positions);
    const hasPlanned = block.planned != null || block.positions.some(p => p.planned != null), hasActual = block.actual != null || block.positions.some(p => p.actual != null);
    rows = rows.map(r => r.id !== id ? r : { ...r, planned: hasPlanned ? block.planned ?? totals.planned : r.planned, actual: hasActual ? block.actual ?? totals.actual : r.actual });
  }
  return { data: staffingLinkPositions({ ...data, rows, positions }), summary };
}
export const staffingGroupRenameSchema = z.object({
  from: z.string().trim().min(1, 'Выберите группу').max(120), to: z.string().trim().min(1, 'Укажите новое название').max(120, 'Название группы — не длиннее 120 символов'),
  /** Только этот срез; без него — все срезы и приём/увольнение. */
  month: staffingMonthSchema.optional(),
}).refine(v => v.from !== v.to, { message: 'Новое название совпадает с прежним', path: ['to'] });
export type StaffingGroupRename = z.infer<typeof staffingGroupRenameSchema>;
/** Переименование или (если новое название уже есть) объединение групп в срезе. Без изменений возвращает null. */
export function staffingRenameGroup<T extends StaffingStructure>(data: T, from: string, to: string): T | null {
  if (!data.rows.some(r => staffingGroupOf(r) === from) && !data.positions?.some(p => p.group === from)) return null;
  return staffingLinkPositions({ ...data, rows: data.rows.map(r => staffingGroupOf(r) === from ? { ...r, group: to } : r), ...(data.positions ? { positions: data.positions.map(p => p.group === from ? { ...p, group: to } : p) } : {}) });
}
/** То же в дне приёма и увольнения: значения объединяемых групп складываются. Без изменений возвращает null. */
export function staffingRenameGroupInDay<T extends StaffingMovementDayData>(day: T, from: string, to: string): T | null {
  if (!day.rows.some(r => r.group === from)) return null;
  const rows: StaffingMovementDayData['rows'] = [];
  for (const r of day.rows) {
    const group = r.group === from ? to : r.group;
    const same = rows.find(x => x.group === group);
    if (same) { same.hired += r.hired; same.dismissed += r.dismissed; } else rows.push({ ...r, group });
  }
  return { ...day, rows };
}
/** Что изменилось в срезе — короткой строкой для журнала (колонка до 1000 символов). */
export function staffingChangeSummary(before: StaffingPeriodData, after: StaffingPeriodData): string {
  const value = (v: number | null | undefined) => v == null ? '—' : String(v);
  const parts: string[] = [];
  if (before.asOf !== after.asOf) parts.push(`дата среза ${before.asOf} → ${after.asOf}`);
  if (before.note !== after.note) parts.push('изменён источник и примечание');
  const rows = new Map(before.rows.map(r => [r.id, r]));
  for (const r of after.rows) {
    const old = rows.get(r.id);
    if (!old) { parts.push(`добавлено подразделение «${r.department}»`); continue; }
    const d: string[] = [];
    if (old.department !== r.department) d.push(`было «${old.department}»`);
    if (old.isArchived !== r.isArchived) d.push(r.isArchived ? 'в архив' : 'восстановлено');
    if (old.planned !== r.planned) d.push(`штат ${value(old.planned)} → ${value(r.planned)}`);
    if (old.actual !== r.actual) d.push(`факт ${value(old.actual)} → ${value(r.actual)}`);
    if (old.category !== r.category) d.push(`категория ${r.category}`);
    if (staffingGroupOf(old) !== staffingGroupOf(r)) d.push(`группа «${staffingGroupOf(r)}»`);
    if (old.function !== r.function || old.note !== r.note) d.push('описание');
    if (d.length) parts.push(`${r.department}: ${d.join(', ')}`);
  }
  const removed = before.rows.filter(r => !after.rows.some(x => x.id === r.id)).length;
  if (removed) parts.push(`убрано подразделений: ${removed}`);
  const positions = new Map((before.positions ?? []).map(p => [p.id, p]));
  const count = { added: 0, changed: 0, archived: 0, restored: 0 };
  const details: string[] = [];
  for (const p of after.positions ?? []) {
    const old = positions.get(p.id);
    if (!old) { count.added++; details.push(`«${p.title}» добавлена`); continue; }
    if (old.isArchived !== p.isArchived) { count[p.isArchived ? 'archived' : 'restored']++; details.push(`«${p.title}» ${p.isArchived ? 'в архив' : 'восстановлена'}`); }
    const d: string[] = [];
    if (old.title !== p.title) d.push(`было «${old.title}»`);
    if (old.planned !== p.planned) d.push(`план ${value(old.planned)} → ${value(p.planned)}`);
    if (old.actual !== p.actual) d.push(`факт ${value(old.actual)} → ${value(p.actual)}`);
    if (old.rowId !== p.rowId) d.push('другое подразделение');
    if (d.length) { count.changed++; details.push(`«${p.title}»: ${d.join(', ')}`); }
  }
  const removedPositions = (before.positions ?? []).filter(p => !after.positions?.some(x => x.id === p.id)).length;
  const total = [count.added && `добавлено ${count.added}`, count.changed && `изменено ${count.changed}`, count.archived && `в архив ${count.archived}`, count.restored && `восстановлено ${count.restored}`, removedPositions && `убрано ${removedPositions}`].filter(Boolean);
  if (total.length) parts.push(`должности: ${total.join(', ')}${details.length && details.length <= 5 ? ` (${details.join('; ')})` : ''}`);
  const text = parts.join('; ');
  return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}
export const staffingEditorsSchema = z.object({ userIds: z.array(z.number().int().positive()).max(200) });
export interface StaffingPermissions { canView: boolean; canEdit: boolean; canManageEditors: boolean }
export interface StaffingView { periods: StaffingPeriod[]; payroll: StaffingPayroll[]; movements: StaffingMovementDay[]; permissions: StaffingPermissions; canExport: boolean; canAudit: boolean; canFinance: boolean }
export interface StaffingEditors { users: { id: number; fullName: string; login: string | null }[]; userIds: number[] }
export interface StaffingAuditItem { id: string; at: string; user: string; action: string; entityId: string | null; comment: string | null }

/** Частичная сумма имеет отдельный счётчик пропусков. Дефицит — только по заполненным парам. */
export function summarizeStaffing(input: StaffingRow[]) {
  const rows = input.filter(r => !r.isArchived);
  const sum = (key: 'planned' | 'actual') => rows.some(r => r[key] !== null) ? Math.round(rows.reduce((s, r) => s + (r[key] ?? 0), 0) * 100) / 100 : null;
  const pairs = rows.filter(r => r.planned !== null && r.actual !== null);
  const round = (v: number) => Math.round(v * 100) / 100;
  const comparablePlanned = pairs.reduce((s, r) => s + r.planned!, 0);
  const comparableActual = pairs.reduce((s, r) => s + r.actual!, 0);
  const missingPlan = rows.filter(r => r.planned === null).length;
  const missingActual = rows.filter(r => r.actual === null).length;
  return {
    count: rows.length, planned: sum('planned'), actual: sum('actual'), missingPlan, missingActual, paired: pairs.length,
    vacancies: pairs.length ? round(pairs.reduce((s, r) => s + Math.max(0, r.planned! - r.actual!), 0)) : null,
    excess: pairs.length ? round(pairs.reduce((s, r) => s + Math.max(0, r.actual! - r.planned!), 0)) : null,
    netGap: rows.length && !missingPlan && !missingActual ? round(comparablePlanned - comparableActual) : null,
    occupancy: comparablePlanned > 0 ? comparableActual / comparablePlanned : null,
  };
}
/** Блоки как в сводке «СВОД по подразделениям»: РСУ по номеру, затем известные названия, остальное — АУП. */
export const STAFFING_GROUP_OTHER = 'АУП';
const groupHints: [RegExp, string][] = [
  [/эксплуатационная база/i, 'РЭБ (без ТЛС)'],
  [/^(Строительно-монтажное управление|Ремонтно-строительное управление)$|Транспортно-логистическ/i, 'ГУП МВС (СМУ+РСУ+ТЛС)'],
  [/от Учредителя/i, 'РСУ СР+УСР от Учредителя'],
  [/Управление гражданского строительства/i, 'Управление гражданского строительства'],
  [/Управление обеспечения и эксплуатации производственной базы/i, 'Управление обеспечения и эксплуатации производственной базы'],
];
export function staffingGroupOf(row: Pick<StaffingRow, 'department' | 'group'>): string {
  if (row.group?.trim()) return row.group.trim();
  const rsu = row.department.match(/РСУ\s*-?\s*(\d+)/i);
  if (rsu) return `РСУ-${rsu[1]}`;
  return groupHints.find(([re]) => re.test(row.department.trim()))?.[1] ?? STAFFING_GROUP_OTHER;
}
/** Суммы по группам (без архивных строк), от большего факта к меньшему; пропуски не считаются нулём. */
export function staffingGroups(input: StaffingRow[]) {
  const map = new Map<string, StaffingRow[]>();
  for (const r of input.filter(r => !r.isArchived)) map.set(staffingGroupOf(r), [...(map.get(staffingGroupOf(r)) ?? []), r]);
  const size = (v: number | null) => v ?? -1;
  return [...map].map(([group, rows]) => ({ group, ...summarizeStaffing(rows) }))
    .sort((a, b) => size(b.actual) - size(a.actual) || size(b.planned) - size(a.planned) || a.group.localeCompare(b.group, 'ru'));
}
export function staffingDelta(row: StaffingRow, previous: StaffingRow[]): number | null {
  const before = previous.find(r => r.id === row.id && !r.isArchived);
  return row.actual !== null && before?.actual != null ? row.actual - before.actual : null;
}
export function staffingCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^\s*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
