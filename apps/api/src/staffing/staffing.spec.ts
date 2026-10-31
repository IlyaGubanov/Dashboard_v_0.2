import { describe, expect, it } from 'vitest';
import * as staffing from '../../../../packages/shared/src/staffing';
import { AccessService } from '../auth/access.service';
import source from './source.json';

const row = (id: string, planned: number | null, actual: number | null, isArchived = false) => ({ id, department: id, category: 'ОП' as const, planned, actual, isArchived, note: '', function: '' });

describe('штатная численность', () => {
  it('сверяет управленческие показатели с контрольными суммами исходного листа на 01.07.2026', () => {
    const period = staffing.staffingPeriodSchema.parse(source.periods.find(p => p.month === '2026-07'));
    expect(staffing.summarizeStaffing(period.rows)).toMatchObject({ count: 41, planned: 4547, actual: 4539, vacancies: 8, excess: 0, paired: 30, missingActual: 11 });
  });
  it('разделяет вакансии и превышение, сохраняет дробные штатные единицы', () => {
    expect(staffing.summarizeStaffing([row('a', 10.5, 8), row('b', 5, 7), row('archive', 100, 0, true)])).toMatchObject({ planned: 15.5, actual: 15, vacancies: 2.5, excess: 2, netGap: 0.5, paired: 2 });
  });
  it('не считает пропуски нулём и считает укомплектованность только по сопоставимым строкам', () => {
    expect(staffing.summarizeStaffing([row('a', 10, 8), row('b', null, 7), row('c', 5, null)])).toMatchObject({ planned: 15, actual: 15, missingPlan: 1, missingActual: 1, vacancies: 2, paired: 1, occupancy: 0.8, netGap: null });
    expect(staffing.summarizeStaffing([row('a', null, null)])).toMatchObject({ planned: null, actual: null, vacancies: null, occupancy: null });
    expect(staffing.summarizeStaffing([row('a', 0, 0)])).toMatchObject({ planned: 0, actual: 0, vacancies: 0, occupancy: null });
  });
  it('отклоняет отрицательный штат, дробный факт, повторные идентификаторы и дату вне месяца', () => {
    expect(staffing.staffingRowSchema.safeParse(row('a', -1, 1)).success).toBe(false);
    expect(staffing.staffingRowSchema.safeParse(row('a', 1.5, 1.5)).success).toBe(false);
    expect(staffing.staffingPeriodSchema.safeParse({ month: '2026-02', asOf: '2026-02-30', rows: [] }).success).toBe(false);
    expect(staffing.staffingPeriodSchema.safeParse({ month: '2026-02', asOf: '2026-03-01', rows: [] }).success).toBe(false);
    expect(staffing.staffingPeriodSchema.safeParse({ month: '2026-02', asOf: '2026-02-01', rows: [row('a', 1, 1), row('a', 2, 2)] }).success).toBe(false);
  });
  it('не переносит значения прошлых периодов в пропуски и сопоставляет подразделения по идентификатору', () => {
    const previous = [row('a', 10, 8), row('b', 3, null)];
    expect(staffing.staffingDelta(row('a', 12, 9), previous)).toBe(1);
    expect(staffing.staffingDelta(row('b', 3, 2), previous)).toBeNull();
    expect(staffing.staffingDelta(row('new', 3, 2), previous)).toBeNull();
  });
  it('группирует подразделения по РСУ как лист «СВОД по подразделениям»: явная группа важнее названия', () => {
    const july = staffing.staffingPeriodSchema.parse(source.periods.find(p => p.month === '2026-07'));
    const groups = Object.fromEntries(staffing.staffingGroups(july.rows).map(g => [g.group, g.actual]));
    expect(groups).toMatchObject({ 'РСУ-3': 1488, 'РСУ-1': 684, 'РЭБ (без ТЛС)': 614, 'РСУ-2': 564, 'ГУП МВС (СМУ+РСУ+ТЛС)': 455, 'РСУ-6': 295, 'РСУ СР+УСР от Учредителя': 35, 'Управление гражданского строительства': 39, 'Управление обеспечения и эксплуатации производственной базы': 44, 'РСУ-4': null, АУП: 321 });
    expect(staffing.staffingGroups(july.rows).reduce((s, g) => s + (g.actual ?? 0), 0)).toBe(4539);
    expect(staffing.staffingGroupOf({ department: 'Управление строительства / РСУ-2', group: '  Своя группа ' })).toBe('Своя группа');
    expect(staffing.staffingGroupOf({ department: 'Пресс-служба', group: '' })).toBe('АУП');
    expect(staffing.staffingGroups([row('a', 1, 1, true)])).toEqual([]);
  });
  it('срез на 26.10.2026 совпадает с итогом сводки и не содержит выдуманного штата', () => {
    const october = staffing.staffingPeriodSchema.parse(source.periods.find(p => p.month === '2026-10'));
    expect(staffing.summarizeStaffing(october.rows)).toMatchObject({ count: 11, actual: 4484, planned: null, missingPlan: 11 });
    const groups = staffing.staffingGroups(october.rows);
    expect(groups[0]).toMatchObject({ group: 'РСУ-3', actual: 1358 });
    expect(Math.round(groups[0].actual! / 4484 * 10000) / 100).toBe(30.29);
  });
  it('должности 26.10.2026: факт по группам совпадает со сводкой, план = факт + вакансии', () => {
    const october = staffing.staffingPeriodSchema.parse(source.periods.find(p => p.month === '2026-10'));
    for (const r of october.rows) expect(staffing.staffingGroupPositions(october.positions, r.group!).actual).toBe(r.actual);
    expect(staffing.staffingGroupPositions(october.positions, 'РСУ-1')).toMatchObject({ planned: 612, actual: 524, need: 88 });
    expect(staffing.staffingGroupPositions(october.positions, 'РСУ-1').items[0]).toMatchObject({ title: 'Слесарь-сантехник', planned: 121, actual: 102, need: 19 });
    // у групп без вакансий в источнике план не выдумывается
    expect(staffing.staffingGroupPositions(october.positions, 'АУП')).toMatchObject({ planned: null, actual: 323, need: null });
    expect(staffing.staffingGroupPositions(undefined, 'РСУ-1')).toMatchObject({ items: [], planned: null });
  });
  it('приём и увольнение 14.09–26.10.2026 совпадают с итогами листа «Приемыувольнения»', () => {
    const days = source.movements.map(d => staffing.staffingMovementDaySchema.parse(d));
    const by = Object.fromEntries(staffing.staffingMovementByGroup(days, '2026-09-14', '2026-10-26').map(g => [g.group, g]));
    expect(by['РСУ-3']).toMatchObject({ hired: 64, dismissed: 307, net: -243 });
    expect(by['РСУ СР+УСР от Учредителя']).toMatchObject({ hired: 402, dismissed: 29 });
    expect(by['ГУП МВС (СМУ+РСУ+ТЛС)']).toMatchObject({ hired: 2, dismissed: 11 });
    const weeks = staffing.staffingMovementSeries(days, 'week', '2026-09-14', '2026-10-26');
    expect(weeks.map(w => w.start)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(weeks.reduce((s, w) => s + w.hired, 0)).toBe(685);
    expect(weeks.reduce((s, w) => s + w.dismissed, 0)).toBe(534);
    expect(staffing.staffingMovementSeries(days, 'month', '2026-09-14', '2026-10-26').map(m => m.start)).toEqual(['2026-09-01', '2026-10-01']);
    expect(staffing.staffingMovementSeries(days, 'day', '2026-10-25', '2026-10-27', 'РСУ-1').map(x => x.days)).toEqual([1, 1, 0]);
  });
  it('день приёма и увольнения: целые неотрицательные значения, группа один раз, неделя — с понедельника', () => {
    const ok = { date: '2026-10-27', rows: [{ group: 'РСУ-1', hired: 2, dismissed: 0 }] };
    expect(staffing.staffingMovementDaySchema.safeParse(ok).success).toBe(true);
    expect(staffing.staffingMovementDaySchema.safeParse({ ...ok, rows: [{ group: 'РСУ-1', hired: -1, dismissed: 0 }] }).success).toBe(false);
    expect(staffing.staffingMovementDaySchema.safeParse({ ...ok, rows: [{ group: 'РСУ-1', hired: 1.5, dismissed: 0 }] }).success).toBe(false);
    expect(staffing.staffingMovementDaySchema.safeParse({ ...ok, rows: [ok.rows[0], ok.rows[0]] }).success).toBe(false);
    expect(staffing.staffingMovementDaySchema.safeParse({ ...ok, date: '2026-02-30' }).success).toBe(false);
    expect(staffing.staffingMovementBucket('2026-10-31', 'week')).toBe('2026-10-26');
    expect(staffing.staffingMovementBucket('2026-10-26', 'week')).toBe('2026-10-26');
    expect(staffing.staffingMovementBucket('2026-11-01', 'week')).toBe('2026-10-26');
  });
  it('экранирует формулы при выгрузке в Excel', () => {
    expect(staffing.staffingCsvCell('=1+1')).toBe('"\'=1+1"');
    expect(staffing.staffingCsvCell('Отдел "А"')).toBe('"Отдел ""А"""');
  });
});

describe('доступ к штатной численности', () => {
  const user = (role: string, hiddenSections: string[] = []) => ({ id: 1, globalRole: role, hiddenSections, deniedFeatures: [] }) as any;
  const access = new AccessService({ staffingEditor: { findUnique: async ({ where }: any) => where.userId === 2 ? { userId: 2 } : null }, directionMember: { findFirst: async ({ where }: any) => where.userId === 3 ? { role: 'CURATOR' } : null } } as any);
  it('даёт просмотр руководству, редактирование администратору и назначенному ответственному', async () => {
    expect(await access.staffingPermissions(user('MANAGEMENT'))).toEqual({ canView: true, canEdit: false, canManageEditors: false });
    expect(await access.staffingPermissions(user('ADMIN'))).toEqual({ canView: true, canEdit: true, canManageEditors: true });
    expect(await access.staffingPermissions({ ...user('USER'), id: 2 })).toEqual({ canView: true, canEdit: true, canManageEditors: false });
  });
  it('не даёт кадровые данные обычному пользователю и учитывает скрытие раздела', async () => {
    expect((await access.staffingPermissions(user('USER'))).canView).toBe(false);
    expect((await access.staffingPermissions({ ...user('USER', ['staffing']), id: 2 })).canEdit).toBe(false);
  });
  it('разрешает куратору направления назначать кадровых ответственных без автоматического права редактирования', async () => {
    expect(await access.staffingPermissions({ ...user('USER'), id: 3 })).toEqual({ canView: true, canEdit: false, canManageEditors: true });
    expect((await access.staffingPermissions({ ...user('USER', ['staffing']), id: 3 })).canManageEditors).toBe(false);
  });
});
