/**
 * Прогноз завершения по фактическому темпу.
 *
 * Темп — прирост готовности за последние ~4 недели (от отчётной точки, отстоящей от среза не меньше чем на 28 дней;
 * если истории меньше — от самой ранней точки не ближе 7 дней). Дата завершения = срез + остаток / темп.
 * Сравнивается с плановым окончанием: объекта (или самой поздней позиции), направления — самого позднего объекта.
 * Для направлений «по отчётам» (Благоустройство) прогноз не строится: отчёты разных программ, ряда нет.
 */
import type { Forecast } from '@mvs/shared';
import { DAY_MS, isoDate, type KDirection, type KPeriod, type KSite } from './model';

const WINDOW_DAYS = 28;
const MIN_DAYS = 7;
/** медленнее 0,1 п.п. в неделю или дальше 3 лет — «работы стоят» */
const MIN_PACE_PER_DAY = 0.001 / 7;
const MAX_DAYS = 3 * 365;

const has = (dir: KDirection, p: KPeriod) => dir.sites.some((s) => s.items.some((i) => i.entries.some((e) => e.date <= p.date)));

/** Точка, от которой считается темп. */
export function basePeriod(dir: KDirection, period: KPeriod): KPeriod | null {
  if (dir.periodKind === 'REPORT') return null;
  const before = dir.periods.filter((p) => p.date <= period.date - MIN_DAYS * DAY_MS && has(dir, p));
  if (!before.length) return null;
  const inWindow = before.filter((p) => p.date <= period.date - WINDOW_DAYS * DAY_MS);
  return inWindow.length ? inWindow[inWindow.length - 1] : before[0];
}

/** Плановое окончание объекта: дата объекта или самой поздней позиции. */
export function sitePlanEnd(site: KSite): number | null {
  if (site.planEnd != null) return site.planEnd;
  const ends = site.items.map((i) => i.planEnd).filter((x): x is number => x != null);
  return ends.length ? Math.max(...ends) : null;
}

/**
 * now / base — готовность 0…1 на срез и на базовую точку; from / baseDate — их даты; planEnd — плановое окончание.
 */
export function forecastOf(now: number | null, base: number | null, from: number, baseDate: number | null, planEnd: number | null): Forecast {
  const out: Forecast = { status: 'nodata', date: null, delayDays: null, pacePerWeek: null, since: baseDate == null ? null : isoDate(baseDate), planEnd: planEnd == null ? null : isoDate(planEnd) };
  if (now == null) return out;
  if (now >= 0.995) return { ...out, status: 'done' };
  if (base == null || baseDate == null) return out;
  const days = (from - baseDate) / DAY_MS;
  const pace = (now - base) / days;
  out.pacePerWeek = pace * 7;
  if (pace < MIN_PACE_PER_DAY || (1 - now) / pace > MAX_DAYS) return { ...out, status: 'stalled', delayDays: null };
  const date = from + Math.ceil((1 - now) / pace) * DAY_MS;
  out.date = isoDate(date);
  if (planEnd == null) return { ...out, status: 'noplan' };
  out.delayDays = Math.round((date - planEnd) / DAY_MS);
  out.status = out.delayDays > 0 ? 'late' : 'ontime';
  return out;
}
