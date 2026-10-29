/**
 * Библиотека дополнительных показателей. Направление выбирает нужные в настройках
 * (direction.settings.kpis = [{ metric, label, params }]) — новые направления собирают свой набор без программирования.
 */
import type { KpiFormat, KpiTile } from '@mvs/shared';
import type { CalcResult } from './engine';
import { calculate } from './engine';
import { DAY_MS, type KDirection, type KPeriod } from './model';

interface Ctx {
  dir: KDirection;
  period: KPeriod;
  P: number;
  r: CalcResult;
  params: Record<string, unknown>;
}
type Metric = (c: Ctx) => { value: number | null; format: KpiFormat; unit?: string; of?: number };

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const items = (c: Ctx) => c.r.sites.flatMap((s) => s.items);

export const METRICS: Record<string, { title: string; fn: Metric }> = {
  toPay: {
    title: 'К оплате: принято по КС-2, но не оплачено',
    fn: (c) => ({
      value: items(c).reduce((a, i) => a + Math.max(0, (i.entry?.ks ?? 0) - (i.entry?.paid ?? 0)), 0),
      format: 'money',
    }),
  },
  overdueItems: {
    title: 'Позиций с истёкшим сроком и не выполненных',
    fn: (c) => ({ value: items(c).filter((i) => i.overdue).length, format: 'int' }),
  },
  itemsByStatus: {
    title: 'Позиций в статусах (params.statuses — коды)',
    fn: (c) => {
      const st = list(c.params.statuses);
      return { value: items(c).filter((i) => i.entry?.statusCode && st.includes(i.entry.statusCode)).length, format: 'int' };
    },
  },
  qtyByUnit: {
    title: 'Сумма фактических объёмов в единице (params.unit)',
    fn: (c) => {
      const unit = String(c.params.unit ?? '');
      return { value: items(c).filter((i) => i.item.unit === unit).reduce((a, i) => a + (i.entry?.factQty ?? 0), 0), format: 'qty', unit };
    },
  },
  sitesDone: {
    title: 'Выполненных объектов',
    fn: (c) => ({ value: c.r.sites.filter((s) => s.risk === 'done').length, format: 'int', of: c.r.sites.length }),
  },
  advance: {
    title: 'Аванс по договорам',
    fn: (c) => ({ value: c.r.sites.reduce((a, s) => a + s.site.contracts.reduce((x, k) => x + (k.advance ?? 0), 0), 0), format: 'money' }),
  },
  scheduleLagDays: {
    title: 'Отставание от графика в днях: сколько дней назад план был равен текущему факту',
    fn: (c) => {
      const F = c.r.fact;
      if (F == null || c.r.plan == null || F >= c.r.plan) return { value: 0, format: 'days' };
      const starts = c.dir.sites.flatMap((s) => s.items.map((i) => i.planStart)).filter((x): x is number => x != null);
      if (!starts.length) return { value: null, format: 'days' };
      const t0 = Math.min(...starts);
      for (let t = t0; t <= c.P; t += DAY_MS) {
        const plan = calculate(c.dir, c.period, t).plan;
        if (plan != null && plan >= F) return { value: Math.round((c.P - t) / DAY_MS), format: 'days' };
      }
      return { value: Math.round((c.P - t0) / DAY_MS), format: 'days' };
    },
  },
  trackerOverdue: {
    title: 'Строк надстройки с прошедшей плановой датой и незавершённым этапом (params.tracker, params.stage)',
    fn: (c) => {
      const t = c.dir.trackers.find((x) => x.code === c.params.tracker);
      const stage = String(c.params.stage ?? '');
      if (!t) return { value: null, format: 'int' };
      return {
        value: t.rows.filter((r) => r.planDate != null && r.planDate < c.P && (r.values[stage]?.num ?? 0) < 100).length,
        format: 'int',
      };
    },
  },
  trackerStatusDone: {
    title: 'Объектов, где этап надстройки в итоговом статусе (params.tracker, params.stage)',
    fn: (c) => {
      const t = c.dir.trackers.find((x) => x.code === c.params.tracker);
      const stage = t?.stages.find((s) => s.code === c.params.stage);
      if (!t || !stage) return { value: null, format: 'int' };
      const done = new Set(stage.options.filter((o) => o.done).map((o) => o.value));
      const sites = new Set(t.rows.filter((r) => done.has(r.values[stage.code]?.text ?? '')).map((r) => r.siteId));
      return { value: sites.size, format: 'int', of: c.r.sites.length };
    },
  },
  reportStatusCount: {
    title: 'Объектов отчёта со статусом из списка (params.statuses — тексты)',
    fn: (c) => {
      const st = list(c.params.statuses);
      const rows = c.r.sites.filter((s) => s.report);
      return { value: rows.filter((s) => st.includes(s.report!.statusText ?? '')).length, format: 'int', of: rows.length };
    },
  },
  sitesWithRemainder: {
    title: 'Объектов с невыполненными объёмами, кроме завершённых по статусу (params.doneStatuses)',
    fn: (c) => {
      const st = list(c.params.doneStatuses);
      return {
        value: c.r.sites.filter((s) => s.report && !st.includes(s.report.statusText ?? '') && s.pos - s.posDone > 0).length,
        format: 'int',
      };
    },
  },
  remarksTotal: {
    title: 'Замечаний в отчёте',
    fn: (c) => ({ value: c.r.sites.reduce((a, s) => a + (s.report?.remarks ?? 0), 0), format: 'int' }),
  },
  remarksOpen: {
    title: 'Замечаний не закрыто (из N за всё время)',
    fn: (c) => ({
      value: c.r.sites.reduce((a, s) => a + s.remarksOpen, 0),
      format: 'int',
      of: c.r.sites.reduce((a, s) => a + (s.site.remarkLog?.length ?? 0), 0),
    }),
  },
  remarksOverdue: {
    title: 'Замечаний просрочено',
    fn: (c) => ({ value: c.r.sites.reduce((a, s) => a + s.remarksOverdue, 0), format: 'int' }),
  },
  forecastLate: {
    title: 'Объектов, не успевающих к сроку по прогнозу',
    fn: (c) => {
      const withPlan = c.r.sites.filter((s) => s.forecast?.planEnd && s.forecast.status !== 'nodata');
      return { value: withPlan.filter((s) => s.forecast!.status === 'late' || s.forecast!.status === 'stalled').length, format: 'int', of: withPlan.length };
    },
  },
  peopleTotal: {
    title: 'Людей на объектах',
    fn: (c) => ({ value: c.r.sites.reduce((a, s) => a + (s.people ?? 0), 0), format: 'int' }),
  },
};

export function computeTiles(dir: KDirection, period: KPeriod, P: number, r: CalcResult): KpiTile[] {
  return (dir.settings.kpis ?? []).flatMap((k) => {
    const m = METRICS[k.metric];
    if (!m) return [];
    const v = m.fn({ dir, period, P, r, params: k.params ?? {} });
    return [{ key: k.metric, label: k.label, ...v }];
  });
}
