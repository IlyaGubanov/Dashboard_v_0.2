/** Замечания на дату среза: открытые и просроченные. БД не нужна. */
import { describe, expect, it } from 'vitest';
import { remarksAt } from './engine';
import { DAY_MS, parseDate, type KDirection, type KSite } from './model';

const d = (s: string) => parseDate(s);
const periods = [
  { id: 1, date: d('2026-10-12'), status: 'CLOSED' as const, program: 'main', label: null },
  { id: 2, date: d('2026-10-19'), status: 'OPEN' as const, program: 'main', label: null },
];
const dir = { periodKind: 'WEEK', planWeekday: 3, periods } as unknown as KDirection;
const site = (log: KSite['remarkLog']) => ({ remarkLog: log }) as KSite;

describe('замечания на дату среза', () => {
  const log = [
    // выставлено 10.10, срок 13.10, принято 20.10
    { created: d('2026-10-10'), closed: d('2026-10-20'), due: d('2026-10-13') },
    // выставлено 15.10 (после среза первой недели), не закрыто, срок 30.10
    { created: d('2026-10-15'), closed: null, due: d('2026-10-30') },
    // выставлено 01.10, без срока, не закрыто
    { created: d('2026-10-01'), closed: null, due: null },
  ];

  it('прошлая неделя — на конец дня плана (среда 14.10)', () => {
    expect(remarksAt(dir, site(log), periods[0])).toEqual({ remarksOpen: 2, remarksOverdue: 1 });
  });

  it('последняя точка — на текущий момент', () => {
    const now = d('2026-10-31') + 12 * 3600_000;
    expect(remarksAt(dir, site(log), periods[1], now)).toEqual({ remarksOpen: 2, remarksOverdue: 1 });
    expect(remarksAt(dir, site(log), periods[1], d('2026-10-29') + DAY_MS / 2)).toEqual({ remarksOpen: 2, remarksOverdue: 0 });
  });

  it('объект без замечаний', () => {
    expect(remarksAt(dir, site(undefined), periods[1])).toEqual({ remarksOpen: 0, remarksOverdue: 0 });
  });
});
