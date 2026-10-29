/** Прогноз завершения по темпу. БД не нужна. */
import { describe, expect, it } from 'vitest';
import { forecastOf } from './forecast';
import { parseDate } from './model';

const d = (s: string) => parseDate(s);

describe('прогноз завершения', () => {
  it('темп 5 п.п. в неделю, остаток 50 % — 10 недель; план раньше — опоздание', () => {
    const f = forecastOf(0.5, 0.3, d('2026-10-26'), d('2026-09-28'), d('2026-12-01'));
    expect(f.status).toBe('late');
    expect(f.date).toBe('2027-01-04');
    expect(f.delayDays).toBe(34);
    expect(f.pacePerWeek).toBeCloseTo(0.05, 10);
  });

  it('успевает к плану', () => {
    const f = forecastOf(0.8, 0.4, d('2026-10-26'), d('2026-09-28'), d('2026-12-31'));
    expect(f.status).toBe('ontime');
    expect(f.delayDays).toBeLessThan(0);
  });

  it('нет прироста — работы стоят', () => {
    expect(forecastOf(0.4, 0.4, d('2026-10-26'), d('2026-09-28'), d('2026-12-31')).status).toBe('stalled');
  });

  it('выполнено, мало истории, нет плана', () => {
    expect(forecastOf(1, 0.9, d('2026-10-26'), d('2026-09-28'), null).status).toBe('done');
    expect(forecastOf(0.5, null, d('2026-10-26'), null, null).status).toBe('nodata');
    expect(forecastOf(0.5, 0.3, d('2026-10-26'), d('2026-09-28'), null).status).toBe('noplan');
  });
});
