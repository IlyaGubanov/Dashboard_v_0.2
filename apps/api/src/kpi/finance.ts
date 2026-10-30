/**
 * Сотруднику с отключённой возможностью «Видеть финансы» денежные данные не отдаются вовсе:
 * стоимость, КС-2, оплата, авансы, лимиты, денежные плитки и доп. поля типа «деньги».
 * Функции возвращают копии — рассчитанные показатели лежат в кэше и общие для всех пользователей.
 */
import type { DirectionKpi, DynamicsPoint, EntrySheet, SiteCard, SiteKpiRow } from '@mvs/shared';

const NO_MONEY = { portfolio: null, closed: null, paid: null };

export const kpiNoFinance = (k: DirectionKpi): DirectionKpi => ({ ...k, money: null, kpis: k.kpis.filter((t) => t.format !== 'money') });

export const rowNoFinance = (r: SiteKpiRow): SiteKpiRow => ({ ...r, money: NO_MONEY });

export const pointNoFinance = (p: DynamicsPoint): DynamicsPoint => ({ ...p, closed: null, paid: null });

export const cardNoFinance = (c: SiteCard): SiteCard => ({
  ...c,
  row: rowNoFinance(c.row),
  limit: null,
  fields: c.fields.filter((f) => f.type !== 'MONEY'),
  items: c.items.map((i) => ({ ...i, planCost: null, ks: null, paid: null })),
  contracts: c.contracts.map((x) => ({ ...x, amount: null, advance: null })),
  history: c.history.map(pointNoFinance),
});

/** Лист ввода без денежных колонок; при сохранении сервер такие значения не принимает (остаются прежними). */
export const sheetNoFinance = (s: EntrySheet): EntrySheet => ({
  ...s,
  fields: { ...s.fields, ks: false, paid: false, reportKs: false, reportPaid: false },
  sites: s.sites.map((x) => ({
    ...x,
    report: { ...x.report, value: { ...x.report.value, ks: null, paid: null } },
    items: x.items.map((i) => ({ ...i, planCost: null, value: { ...i.value, ks: null, paid: null } })),
  })),
});
