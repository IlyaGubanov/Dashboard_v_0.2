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
  describe('должности в подразделениях', () => {
    const october = () => staffing.staffingPeriodSchema.parse(source.periods.find(p => p.month === '2026-10'));
    const pos = (id: string, title: string, planned: number | null, actual: number | null, rowId = 'a', isArchived = false) => ({ id, group: 'a', title, planned, actual, rowId, isArchived });
    const period = (positions: ReturnType<typeof pos>[], rows = [{ ...row('a', null, null), department: 'Отдел' }]) => ({ month: '2026-11', asOf: '2026-11-01', note: '', rows, positions });
    // лист «По должностям» из Excel: блок без номера, должности с номером, контрольная строка; ФИО из названия блока не переносится
    const sheet = ['№\tДолжность\tКоличество сотрудников', '\tРСУ СР+УСР от Учредителя (Рук. Иванова И.И.)\t3', '1\tБетонщик\t2', '2\tСтропальщик 3 разряда\t1', '\tРСУ-9\t5', '1\tМаляр 5 разряд\t1 500', '2\tМаляр 6 разряда\t0', '\tОбщий итог\t8'].join('\r\n');

    it('старые должности привязываются к единственному подразделению группы и следуют за его группой', () => {
      const linked = staffing.staffingLinkPositions(october());
      expect(linked.positions!.filter(p => !p.rowId)).toEqual([]);
      expect(linked.positions!.find(p => p.group === 'РСУ-1')!.rowId).toBe(linked.rows.find(r => r.group === 'РСУ-1')!.id);
      const moved = staffing.staffingLinkPositions({ ...linked, rows: linked.rows.map(r => r.group === 'РСУ-1' ? { ...r, group: 'Новая группа' } : r) });
      expect(moved.positions!.filter(p => p.group === 'Новая группа').length).toBe(linked.positions!.filter(p => p.group === 'РСУ-1').length);
      // в группе несколько подразделений — привязывать не к чему, должность остаётся за группой
      const two = staffing.staffingLinkPositions({ rows: [row('Отдел 1', 1, 1), row('Отдел 2', 1, 1)], positions: [{ ...pos('x', 'Маляр', 1, 1), rowId: undefined, group: 'АУП' }] });
      expect(two.positions![0].rowId).toBeUndefined();
    });
    it('в названиях должностей нет обрывка «а» от слова «разряда»', () => {
      expect(october().positions!.filter(p => / а$/.test(p.title))).toEqual([]);
      expect(staffing.staffingTitleBase('Стропальщик 3 разряда')).toBe('Стропальщик');
      expect(staffing.staffingTitleBase('Маляр строительный 5 разряд')).toBe('Маляр строительный');
    });
    it('сумма считает только действующие должности и известные значения', () => {
      expect(staffing.staffingPositionTotals([pos('1', 'А1', 10, 8), pos('2', 'Б1', null, 2), pos('3', 'В1', 5, 5, 'a', true)])).toEqual({ count: 2, planned: 10, actual: 10, need: 2 });
      expect(staffing.staffingPositionTotals([])).toEqual({ count: 0, planned: null, actual: null, need: null });
      const archivedRow = staffing.staffingActivePositions({ rows: [row('a', 1, 1, true), row('b', 1, 1)], positions: [pos('1', 'А1', 1, 1, 'a'), pos('2', 'Б1', 1, 1, 'b'), pos('3', 'В1', 1, 1, 'b', true)] });
      expect(archivedRow.map(p => p.id)).toEqual(['2']);
    });
    it('итог подразделения следует за должностями, пока совпадал с суммой; ручное значение не меняется', () => {
      const before = [pos('1', 'А1', 10, 8)];
      const after = [...before, pos('2', 'Б1', 2, 2)];
      expect(staffing.staffingSyncRow(row('a', 10, 8), before, after)).toMatchObject({ planned: 12, actual: 10 });
      expect(staffing.staffingSyncRow(row('a', 100, 8), before, after)).toMatchObject({ planned: 100, actual: 10 });
      expect(staffing.staffingSyncRow(row('a', null, null), [], before)).toMatchObject({ planned: 10, actual: 8 });
      expect(staffing.staffingSetPositions(period(before, [row('a', 10, 8)]), after).rows[0]).toMatchObject({ planned: 12, actual: 10 });
    });
    it('расхождение с суммой считается только по показателям, которые есть у должностей', () => {
      expect(staffing.staffingTotalsDiffer({ planned: 100, actual: 5 }, { planned: null, actual: 5 })).toBe(false);
      expect(staffing.staffingTotalsDiffer({ planned: null, actual: 5 }, { planned: 7, actual: 5 })).toBe(true);
      expect(staffing.staffingTotalsDiffer({ planned: 7, actual: 4 }, { planned: 7, actual: 5 })).toBe(true);
    });
    it('запись среза запрещает должность дважды в подразделении, архивную и в другом подразделении — разрешает', () => {
      expect(staffing.staffingPeriodWriteSchema.safeParse(period([pos('1', 'Маляр', 1, 1), pos('2', ' маляр ', 1, 1)])).success).toBe(false);
      expect(staffing.staffingPeriodWriteSchema.safeParse(period([pos('1', 'Маляр', 1, 1), pos('2', 'Маляр', 1, 1, 'a', true)])).success).toBe(true);
      expect(staffing.staffingPeriodWriteSchema.safeParse(period([pos('1', 'Маляр', 1, 1), pos('2', 'Маляр', 1, 1, 'b')])).success).toBe(true);
      // чтение не отвергает старые данные
      expect(staffing.staffingPeriodSchema.safeParse(period([pos('1', 'Маляр', 1, 1), pos('2', 'Маляр', 1, 1)])).success).toBe(true);
    });
    it('разбирает таблицу как лист «По должностям»', () => {
      const t = staffing.parseStaffingTable(sheet);
      expect(t.problems).toEqual([]);
      expect(t.total).toBe(8);
      expect(t.blocks.map(b => [b.name, b.actual, b.positions.length])).toEqual([['РСУ СР+УСР от Учредителя', 3, 2], ['РСУ-9', 5, 2]]);
      expect(t.blocks[1].positions[0]).toEqual({ title: 'Маляр 5 разряд', planned: null, actual: 1500 });
    });
    it('разбирает вставку без номеров, с планом и фактом, и сообщает о плохих строках', () => {
      const t = staffing.parseStaffingTable('Маляр\t5\nПлотник\t2,5\t2\nМаляр\t1\nКровельщик\tмного\nБригадир\t1,5');
      expect(t.blocks).toHaveLength(1);
      expect(t.blocks[0].name).toBeNull();
      expect(t.blocks[0].positions).toEqual([{ title: 'Маляр', planned: null, actual: 6 }, { title: 'Плотник', planned: 2.5, actual: 2 }]);
      expect(t.problems).toHaveLength(3);
      expect(staffing.parseStaffingTable('Маляр\t5', 'planned').blocks[0].positions[0]).toEqual({ title: 'Маляр', planned: 5, actual: null });
      expect(staffing.parseStaffingTable('Должность\tФакт\tШтат\nМаляр\t3\t5').blocks[0].positions[0]).toEqual({ title: 'Маляр', planned: 5, actual: 3 });
    });
    it('складывает разряды одной должности по запросу', () => {
      const t = staffing.staffingMergeGrades(staffing.parseStaffingTable(sheet));
      expect(t.blocks[1].positions).toEqual([{ title: 'Маляр', planned: null, actual: 1500 }]);
    });
    it('находит подразделение по названию или единственной группе', () => {
      const rows = october().rows;
      expect(staffing.staffingMatchRow(rows, 'рсу-1')?.group).toBe('РСУ-1');
      expect(staffing.staffingMatchRow(rows, 'РЭБ (без ТЛС)')?.department).toBe('Ремонтно-эксплуатационная база (без ТЛС)');
      expect(staffing.staffingMatchRow(rows, 'Сотрудники административно-управленческого персонала (АУП)')?.group).toBe('АУП');
      expect(staffing.staffingMatchRow(rows, 'Неизвестный блок')).toBeUndefined();
    });
    it('загрузка: план совпавших сохраняется, новые добавляются, должность с планом остаётся вакансией, итог блока важнее суммы', () => {
      let id = 0;
      const data = period([pos('1', 'Бетонщик', 5, 1), pos('2', 'Газосварщик', 3, 3), pos('3', 'Курьер', null, 2)], [row('a', 8, 6)]);
      const [block] = staffing.parseStaffingTable(sheet).blocks;
      const { data: next, summary } = staffing.staffingApplyTable(data, [{ block, rowId: 'a' }], { updateMissing: true, makeId: () => `n${++id}` });
      expect(summary).toEqual({ added: 1, updated: 1, archived: 1, planLost: 0, vacant: 1, rowsAdded: 0 });
      expect(next.positions.find(p => p.title === 'Бетонщик')).toMatchObject({ planned: 5, actual: 2, rowId: 'a' });
      // в таблице факта нет должности без людей: это вакансия, потребность не пропадает
      expect(next.positions.find(p => p.title === 'Газосварщик')).toMatchObject({ isArchived: false, planned: 3, actual: 0 });
      expect(next.positions.find(p => p.title === 'Курьер')).toMatchObject({ isArchived: true });
      expect(next.positions.find(p => p.title === 'Стропальщик 3 разряда')).toMatchObject({ rowId: 'a', planned: null, actual: 1 });
      expect(next.rows[0]).toMatchObject({ actual: 3, planned: 8 });
      const kept = staffing.staffingApplyTable(data, [{ block, rowId: 'a' }], { updateMissing: false, makeId: () => `k${++id}` });
      expect(kept.summary).toMatchObject({ archived: 0, vacant: 0 });
      expect(kept.data.positions.find(p => p.title === 'Газосварщик')).toMatchObject({ actual: 3 });
      const created = staffing.staffingApplyTable(data, [{ block, rowId: null }], { updateMissing: true, makeId: () => `c${++id}` });
      expect(created.summary.rowsAdded).toBe(1);
      expect(created.data.rows[1]).toMatchObject({ department: 'РСУ СР+УСР от Учредителя', group: 'РСУ СР+УСР от Учредителя', actual: 3 });
      expect(created.data.positions.find(p => p.title === 'Курьер')).toMatchObject({ isArchived: false, rowId: 'a' });
    });
    it('загрузка: строки с разрядами заменяют должность без разряда, о потерянном плане сообщается; таблица плана не трогает занятые должности', () => {
      let id = 0;
      const data = period([pos('1', 'Стропальщик', 15, 15), pos('2', 'Плотник', 2, 2), pos('3', 'Курьер', null, null)]);
      const [block] = staffing.parseStaffingTable('\tОтдел\t15\n1\tСтропальщик 3 разряда\t13\n2\tСтропальщик 4 разряда\t2').blocks;
      const graded = staffing.staffingApplyTable(data, [{ block, rowId: 'a' }], { updateMissing: true, makeId: () => `n${++id}` });
      expect(graded.summary).toMatchObject({ added: 2, archived: 2, planLost: 1, vacant: 1 });
      expect(graded.data.positions.find(p => p.title === 'Стропальщик')).toMatchObject({ isArchived: true });
      const plan = staffing.parseStaffingTable('Бетонщик\t4', 'planned').blocks[0];
      const planned = staffing.staffingApplyTable(data, [{ block: plan, rowId: 'a' }], { updateMissing: true, makeId: () => `p${++id}` });
      expect(planned.data.positions.find(p => p.title === 'Плотник')).toMatchObject({ isArchived: false, planned: 2, actual: 2 });
      expect(planned.data.positions.find(p => p.title === 'Курьер')).toMatchObject({ isArchived: true });
    });
    it('вся таблица как лист «По должностям»: со сложением разрядов сохраняются факт, план и вакансии', () => {
      const data = staffing.staffingLinkPositions(october());
      const before = staffing.staffingPositionTotals(data.positions!);
      // часть листа по РСУ-1: должности есть, «Газосварщик» (вакансия, факт 0) в лист факта не попадает
      const row1 = data.rows.find(r => r.group === 'РСУ-1')!;
      const list = data.positions!.filter(p => p.rowId === row1.id && p.actual).map((p, i) => `${i + 1}\t${p.title}\t${p.actual}`);
      const [block] = staffing.staffingMergeGrades(staffing.parseStaffingTable(['\tРСУ-1\t524', ...list].join('\n'))).blocks;
      const { data: next, summary } = staffing.staffingApplyTable(data, [{ block, rowId: row1.id }], { updateMissing: true, makeId: () => 'x' });
      expect(summary).toMatchObject({ added: 0, updated: 0, archived: 0, planLost: 0 });
      expect(summary.vacant).toBeGreaterThan(0);
      expect(staffing.staffingPositionTotals(next.positions!)).toEqual(before);
      expect(next.positions!.find(p => p.rowId === row1.id && p.title === 'Газосварщик')).toMatchObject({ planned: 5, actual: 0 });
    });
    it('загрузка листа в срез 26.10.2026: совпадает с итогом и обновляет старые названия с обрывком «а»', () => {
      const data = october();
      const broken = { ...data, positions: data.positions!.map(p => p.title === 'Стропальщик' ? { ...p, title: 'Стропальщик а' } : p) };
      const table = staffing.staffingMergeGrades(staffing.parseStaffingTable('\tГУП МВС (СМУ+РСУ+ТЛС)\t15\n1\tСтропальщик 3 разряда\t13\n2\tСтропальщик 4 разряда\t2'));
      const target = staffing.staffingMatchRow(broken.rows, table.blocks[0].name)!;
      const { data: next, summary } = staffing.staffingApplyTable(broken, [{ block: table.blocks[0], rowId: target.id }], { updateMissing: false, makeId: () => 'x' });
      expect(summary.added).toBe(0);
      expect(next.positions.filter(p => p.rowId === target.id && /Стропальщик/.test(p.title)).map(p => p.title)).toEqual(['Стропальщик']);
    });
    it('копия среза: без архива, факт пустой, должности по выбору, идентификаторы сохраняются', () => {
      const data = period([pos('1', 'А1', 5, 4), pos('2', 'Б1', 5, 4, 'a', true), pos('3', 'В1', 5, 4, 'gone')], [row('a', 5, 4), row('gone', 5, 4, true)]);
      const copy = staffing.staffingCopyStructure(data, { positions: true, actual: false });
      expect(copy.rows.map(r => [r.id, r.actual])).toEqual([['a', null]]);
      expect(copy.positions!.map(p => [p.id, p.planned, p.actual])).toEqual([['1', 5, null]]);
      expect(staffing.staffingCopyStructure(data, { positions: true, actual: true }).positions![0].actual).toBe(4);
      expect(staffing.staffingCopyStructure(data, { positions: false, actual: false }).positions).toBeUndefined();
    });
    it('переименовывает и объединяет группы в срезе и в днях приёма/увольнения', () => {
      const data = october();
      const linked = staffing.staffingLinkPositions(data);
      const renamed = staffing.staffingRenameGroup(linked, 'РСУ-1', 'РСУ № 1')!;
      expect(staffing.staffingGroups(renamed.rows).map(g => g.group)).toContain('РСУ № 1');
      expect(renamed.positions!.some(p => p.group === 'РСУ-1')).toBe(false);
      expect(staffing.staffingRenameGroup(linked, 'Нет такой', 'Икс')).toBeNull();
      const merged = staffing.staffingRenameGroup(linked, 'РСУ-1', 'РСУ-2')!;
      expect(staffing.staffingGroups(merged.rows).find(g => g.group === 'РСУ-2')).toMatchObject({ actual: 524 + 541, count: 2 });
      const day = { date: '2026-10-27', note: '', rows: [{ group: 'РСУ-1', hired: 1, dismissed: 2 }, { group: 'РСУ-2', hired: 3, dismissed: 4 }] };
      expect(staffing.staffingRenameGroupInDay(day, 'РСУ-1', 'РСУ-2')!.rows).toEqual([{ group: 'РСУ-2', hired: 4, dismissed: 6 }]);
      expect(staffing.staffingRenameGroupInDay(day, 'РСУ-7', 'РСУ-2')).toBeNull();
      expect(day.rows[1].hired).toBe(3);
      expect(staffing.staffingGroupRenameSchema.safeParse({ from: 'А', to: ' А ' }).success).toBe(false);
    });
    it('журнал описывает, что изменилось, и укладывается в размер колонки', () => {
      const before = period([pos('1', 'Маляр', 5, 4)], [row('a', 5, 4)]);
      const after = { ...before, rows: [{ ...before.rows[0], actual: 6 }, row('Новый', null, null)], positions: [pos('1', 'Маляр', 5, 6), pos('2', 'Плотник', 1, 0)] };
      const text = staffing.staffingChangeSummary(before, after);
      expect(text).toContain('a: факт 4 → 6');
      expect(text).toContain('добавлено подразделение «Новый»');
      expect(text).toContain('должности: добавлено 1, изменено 1');
      expect(text).toContain('«Маляр»: факт 4 → 6');
      expect(staffing.staffingChangeSummary(before, before)).toBe('');
      const many = { ...before, rows: Array.from({ length: 200 }, (_, i) => row(`Подразделение № ${i}`, 1, 1)) };
      expect(staffing.staffingChangeSummary(before, many).length).toBeLessThanOrEqual(1000);
    });
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
