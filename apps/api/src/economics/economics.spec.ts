import { describe, expect, it } from 'vitest';
import { econDefaultMonth, econDeviation, econForecast, econIsOwnOrg, econLimitValue, econNet, econParseNumber, econPlanCost, econScopeKey, econStatus, econBudgetSaveSchema, econMonthSaveSchema } from '@mvs/shared';
import { econCoveredSites } from './coverage';

describe('экономика: расчёты', () => {
  it('стоимость без НДС: 22% и объект без НДС', () => {
    expect(econNet(1_220_000, 22, false)).toBe(1_000_000);
    expect(econNet(1_000_000, 22, true)).toBe(1_000_000);
    expect(econNet(null, 22, false)).toBeNull();
  });

  it('лимит: доля от стоимости или сумма', () => {
    expect(econLimitValue({ method: 'SHARE', sharePct: 32.5, amount: null }, 1_000_000)).toBe(325_000);
    expect(econLimitValue({ method: 'SHARE', sharePct: 10, amount: null }, null)).toBeNull();
    expect(econLimitValue({ method: 'AMOUNT', sharePct: null, amount: 15_000 }, null)).toBe(15_000);
  });

  it('числа из Excel', () => {
    expect(econParseNumber('1 234 567,89')).toBe(1234567.89);
    expect(econParseNumber('1 234 567')).toBe(1234567);
    expect(econParseNumber('1234567.5')).toBe(1234567.5);
    expect(econParseNumber('1,234,567.5')).toBe(1234567.5);
    expect(econParseNumber('12 000 ₽')).toBe(12000);
    expect(econParseNumber('')).toBeNull();
    expect(econParseNumber('—')).toBeNull();
    expect(econParseNumber('abc')).toBeNaN();
  });

  it('месяц по умолчанию — предыдущий', () => {
    expect(econDefaultMonth(new Date('2026-11-05T10:00:00Z'))).toBe('2026-10');
    expect(econDefaultMonth(new Date('2027-01-03T10:00:00Z'))).toBe('2026-12');
  });

  it('ключ центра затрат', () => {
    expect(econScopeKey('DIRECTION')).toBe('D');
    expect(econScopeKey('SECTION', 5)).toBe('S5');
    expect(econScopeKey('SITE', null, 9)).toBe('O9');
  });
});

describe('экономика: какие объекты покрывает центр затрат', () => {
  const sites = [
    { id: 1, sectionId: 10 },
    { id: 2, sectionId: 10 },
    { id: 3, sectionId: 20 },
    { id: 4, sectionId: null },
  ];
  const site1 = { scope: 'SITE' as const, sectionId: null, siteId: 1, isArchived: false };
  const lot10 = { scope: 'SECTION' as const, sectionId: 10, siteId: null, isArchived: false };
  const dir = { scope: 'DIRECTION' as const, sectionId: null, siteId: null, isArchived: false };
  const all = [site1, lot10, dir];
  const ids = (b: typeof dir | typeof lot10 | typeof site1, list = all) => econCoveredSites(b, list, sites).map((s) => s.id);

  it('объект со своим бюджетом исключается из лота, лот — из направления', () => {
    expect(ids(site1)).toEqual([1]);
    expect(ids(lot10)).toEqual([2]);
    expect(ids(dir)).toEqual([3, 4]);
  });

  it('архивный бюджет не отнимает объекты', () => {
    const list = [{ ...site1, isArchived: true }, lot10, dir];
    expect(ids(lot10, list)).toEqual([1, 2]);
    expect(ids(dir, [site1, { ...lot10, isArchived: true }, dir])).toEqual([2, 3, 4]);
  });
});

describe('экономика: проверка ввода', () => {
  it('лимит долей требует долю, суммой — сумму', () => {
    const base = { version: 1, costNet: null, vatExempt: false, laborHoursNorm: null, machineHoursNorm: null, note: null };
    const r = econBudgetSaveSchema.safeParse({ ...base, limits: [{ articleId: 1, method: 'SHARE', sharePct: null, amount: 5 }] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['limits', 0, 'sharePct']);
    expect(econBudgetSaveSchema.safeParse({ ...base, limits: [{ articleId: 1, method: 'AMOUNT', sharePct: null, amount: 5 }] }).success).toBe(true);
    expect(econBudgetSaveSchema.safeParse({ ...base, limits: [{ articleId: 1, method: 'SHARE', sharePct: 120, amount: null }] }).success).toBe(false);
  });

  it('отрицательные суммы и повторы центров затрат отклоняются', () => {
    const row = { budgetId: 1, version: 0, laborHours: null, machineHours: null, note: null, amounts: { '1': -5 } };
    expect(econMonthSaveSchema.safeParse({ rows: [row] }).success).toBe(false);
    const ok = { ...row, amounts: { '1': 5 } };
    expect(econMonthSaveSchema.safeParse({ rows: [ok, ok] }).success).toBe(false);
    expect(econMonthSaveSchema.safeParse({ rows: [ok] }).success).toBe(true);
  });
});

describe('экономика: план затрат, отклонение, прогноз', () => {
  it('план на выполненный объём = лимит × готовность (готовность ограничена 0…1)', () => {
    expect(econPlanCost(1_000_000, 0.4)).toBe(400_000);
    expect(econPlanCost(1_000_000, 1.3)).toBe(1_000_000);
    expect(econPlanCost(null, 0.4)).toBeNull();
  });

  it('отклонение: + экономия, − перерасход; пороги −2% / −10%', () => {
    expect(econDeviation(400_000, 380_000)).toEqual({ amount: 20_000, pct: 0.05 });
    const over = econDeviation(400_000, 420_000);
    expect(over.amount).toBe(-20_000);
    expect(econStatus(over.pct)).toBe('warning');
    expect(econStatus(-0.015)).toBe('good');
    expect(econStatus(-0.12)).toBe('critical');
    expect(econStatus(null)).toBe('none');
  });

  it('прогноз на завершение: факт ÷ готовность; при готовности < 5% не строится', () => {
    expect(econForecast(1_000_000, 440_000, 0.4)).toEqual({ expected: 1_100_000, result: -100_000 });
    expect(econForecast(1_000_000, 10_000, 0.03)).toBeNull();
  });

  it('свои подразделения не считаются субподрядом', () => {
    for (const own of ['СМУ-1 (инженерные системы)', 'СМУ АНО МВС СТ', 'Электромонтажный участок', 'Проектный отдел', 'АНО "МосводостокСтройТрест"', 'РСУ-3']) expect(econIsOwnOrg(own)).toBe(true);
    for (const ext of ['ООО «Глобалинжстрой»', 'Сети Столицы', 'УСТР-М', 'ООО «Стройимпульс»']) expect(econIsOwnOrg(ext)).toBe(false);
  });
});
