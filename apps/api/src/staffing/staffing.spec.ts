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
