import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ECON_DEFAULT_VAT_RATE,
  ECON_SCOPE_LABELS,
  econIsCompanyKind,
  econIsOwnOrg,
  econLimitValue,
  econNet,
  econScopeKey,
  econSettingsSchema,
  type EconArticle,
  type EconArticleInput,
  type EconAuditItem,
  type EconBudget,
  type EconBudgetCreate,
  type EconBudgetSave,
  type EconEditors,
  type EconFactRow,
  type EconMonthSave,
  type EconMonthStatus,
  type EconMonthView,
  type EconOverview,
  type EconSettings,
  type EconSetup,
} from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import { econCoveredSites } from './coverage';
import { computeResults } from './results';
import type { AuthUser } from '../common/request';

const SETTINGS_KEY = 'economics.settings';
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const dec = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v));
/** Версия 0 у клиента — месяца ещё не было; строка, созданная при сохранении, получает версию 1. */
const sameVersion = (client: number, current: number) => client === current || (client === 0 && current === 1);
const conflict = (what: string) => new ConflictException(`${what} изменил другой пользователь. Обновите страницу и повторите правку.`);

type BudgetRecord = Prisma.EconBudgetGetPayload<{ include: { limits: true; site: { select: { name: true; shortName: true } }; section: { select: { name: true } } } }>;
type MonthRowRecord = Prisma.EconBudgetMonthGetPayload<{ include: { facts: true } }>;

@Injectable()
export class EconomicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
  ) {}

  async permissions(user: AuthUser) {
    const { canView, canEdit, canAdmin } = await this.access.economicsPermissions(user);
    return { canView, canEdit, canAdmin };
  }

  async settings(): Promise<EconSettings> {
    const s = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const r = econSettingsSchema.safeParse(s?.value);
    return r.success ? r.data : { vatRate: ECON_DEFAULT_VAT_RATE, laborRate: null, machineRate: null };
  }

  async setup(user: AuthUser): Promise<EconSetup> {
    const p = await this.access.assertEconomics(user);
    const dirFilter = p.directionIds ? { id: { in: p.directionIds } } : {};
    const [settings, articles, directions, budgets, months, counts] = await Promise.all([
      this.settings(),
      this.prisma.econArticle.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.direction.findMany({
        where: { isActive: true, ...dirFilter },
        orderBy: [{ sort: 'asc' }, { name: 'asc' }],
        include: {
          sections: { where: { isArchived: false }, orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { id: true, name: true } },
          sites: { where: { isArchived: false }, orderBy: [{ sort: 'asc' }, { num: 'asc' }, { name: 'asc' }], select: { id: true, name: true, shortName: true, sectionId: true } },
        },
      }),
      this.prisma.econBudget.findMany({
        where: { direction: { isActive: true, ...dirFilter } },
        include: { limits: true, site: { select: { name: true, shortName: true } }, section: { select: { name: true } } },
      }),
      this.prisma.econMonth.findMany({ orderBy: { month: 'desc' } }),
      this.prisma.econBudgetMonth.groupBy({ by: ['month'], _count: { _all: true }, where: { budget: { direction: { isActive: true, ...dirFilter } } } }),
    ]);
    const rows = new Map(counts.map((c) => [c.month, c._count._all]));
    const known = new Set(months.map((m) => m.month));
    const monthItems = [
      ...months.map((m) => ({ month: m.month, status: m.status, rows: rows.get(m.month) ?? 0 })),
      ...[...rows].filter(([m]) => !known.has(m)).map(([month, n]) => ({ month, status: 'OPEN' as const, rows: n })),
    ].sort((a, b) => b.month.localeCompare(a.month));
    const views: EconBudget[] = [];
    for (const d of directions) {
      const own = budgets.filter((b) => b.directionId === d.id);
      if (!own.length) continue;
      const [money, contractors] = await Promise.all([this.kpi.siteMoney(d.id), this.contractorsBySite(d.id)]);
      views.push(...own.map((b) => this.budgetView(b, own, d.sites, money, contractors, settings.vatRate)));
    }
    return {
      permissions: { canView: p.canView, canEdit: p.canEdit, canAdmin: p.canAdmin },
      settings,
      articles: articles.map(article),
      directions: directions.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        shortName: d.shortName,
        sections: d.sections,
        sites: d.sites.map((s) => ({ id: s.id, name: s.shortName || s.name, sectionId: s.sectionId })),
      })),
      budgets: views,
      months: monthItems,
      canExport: this.access.has(user, 'export'),
      canAudit: this.access.has(user, 'audit'),
      hasDemo: !!(await this.prisma.appSetting.findUnique({ where: { key: 'economics.demo' } })),
    };
  }

  /**
   * Договоры и работы подрядчиков по объектам направления, с НДС: договоры объекта с организацией
   * и стоимость позиций с подрядчиком, не привязанных к договору (чтобы не считать дважды).
   */
  private async contractorsBySite(directionId: number) {
    const [contracts, items] = await Promise.all([
      this.prisma.contract.findMany({ where: { site: { directionId }, organizationId: { not: null }, amount: { not: null } }, select: { siteId: true, amount: true, organization: { select: { name: true } } } }),
      this.prisma.workItem.findMany({
        where: { site: { directionId }, isArchived: false, contractorId: { not: null }, contractId: null, planCost: { not: null } },
        select: { siteId: true, planCost: true, contractor: { select: { name: true } } },
      }),
    ]);
    const bySite = new Map<number, { name: string; amount: number }[]>();
    const add = (siteId: number, name: string | undefined, amount: Prisma.Decimal | null) => {
      if (!name || amount == null) return;
      bySite.set(siteId, [...(bySite.get(siteId) ?? []), { name, amount: Number(amount) }]);
    };
    for (const c of contracts) add(c.siteId, c.organization?.name, c.amount);
    for (const i of items) add(i.siteId, i.contractor?.name, i.planCost);
    return bySite;
  }

  private budgetView(
    b: BudgetRecord,
    all: BudgetRecord[],
    sites: { id: number; sectionId: number | null }[],
    money: Map<number, { portfolio: number | null; closed: number | null; paid: number | null; fact: number | null }>,
    contractorsBySite: Map<number, { name: string; amount: number }[]>,
    vatRate: number,
  ): EconBudget {
    const covered = econCoveredSites(b, all, sites);
    const m = covered.map((s) => money.get(s.id)).filter((v): v is NonNullable<typeof v> => !!v);
    const total = (list: (number | null)[]) => { const v = list.filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((a, x) => a + x, 0) * 100) / 100 : null; };
    const costGross = total(m.map((x) => x.portfolio));
    // готовность центра затрат — средняя по объектам, взвешенная по стоимости (без стоимости — простое среднее)
    const weighted = m.filter((x) => x.fact != null && x.portfolio);
    const facts = m.filter((x) => x.fact != null);
    const progress = weighted.length
      ? weighted.reduce((a, x) => a + x.fact! * x.portfolio!, 0) / weighted.reduce((a, x) => a + x.portfolio!, 0)
      : facts.length ? facts.reduce((a, x) => a + x.fact!, 0) / facts.length : null;
    const byOrg = new Map<string, number>();
    for (const s of covered) for (const c of contractorsBySite.get(s.id) ?? []) byOrg.set(c.name, (byOrg.get(c.name) ?? 0) + c.amount);
    const contractors = [...byOrg].map(([name, amount]) => ({ name, amountGross: Math.round(amount * 100) / 100, own: econIsOwnOrg(name) })).sort((a, b) => b.amountGross - a.amountGross);
    const costNet = num(b.costNet);
    const costBase = costNet ?? econNet(costGross, vatRate, b.vatExempt);
    const limits = b.limits.map((l) => {
      const v = { articleId: l.articleId, method: l.method, sharePct: num(l.sharePct), amount: num(l.amount), setBy: l.setBy, note: l.note };
      return { ...v, value: econLimitValue(v, costBase) };
    });
    const known = limits.filter((l) => l.value != null);
    return {
      id: b.id,
      directionId: b.directionId,
      scope: b.scope,
      sectionId: b.sectionId,
      siteId: b.siteId,
      title: budgetTitle(b),
      sitesCount: covered.length,
      costGross,
      costNet,
      costBase,
      vatExempt: b.vatExempt,
      laborHoursNorm: num(b.laborHoursNorm),
      machineHoursNorm: num(b.machineHoursNorm),
      note: b.note,
      isArchived: b.isArchived,
      version: b.version,
      updatedAt: b.updatedAt.toISOString(),
      limits,
      limitTotal: known.length ? Math.round(known.reduce((a, l) => a + l.value!, 0) * 100) / 100 : null,
      progress: progress == null ? null : Math.round(progress * 10000) / 10000,
      ksGross: total(m.map((x) => x.closed)),
      paidGross: total(m.map((x) => x.paid)),
      contractors,
    };
  }

  private async budgetInScope(user: AuthUser, id: number) {
    const p = await this.access.assertEconomics(user, true);
    const b = await this.prisma.econBudget.findUnique({ where: { id }, include: { direction: { select: { isActive: true } } } });
    if (!b || !b.direction.isActive || (p.directionIds && !p.directionIds.includes(b.directionId))) throw new NotFoundException('Центр затрат не найден');
    return b;
  }

  async createBudget(user: AuthUser, input: EconBudgetCreate, ip: string | null) {
    const p = await this.access.assertEconomics(user, true);
    const dir = await this.prisma.direction.findUnique({ where: { id: input.directionId } });
    if (!dir || !dir.isActive || (p.directionIds && !p.directionIds.includes(dir.id))) throw new NotFoundException('Направление не найдено');
    const sectionId = input.scope === 'SECTION' ? input.sectionId! : null;
    const siteId = input.scope === 'SITE' ? input.siteId! : null;
    if (sectionId && !(await this.prisma.section.findFirst({ where: { id: sectionId, directionId: dir.id, isArchived: false } })))
      throw new BadRequestException({ message: 'Лот не найден в направлении', fields: { sectionId: 'Лот не найден в направлении' } });
    if (siteId && !(await this.prisma.site.findFirst({ where: { id: siteId, directionId: dir.id, isArchived: false } })))
      throw new BadRequestException({ message: 'Объект не найден в направлении', fields: { siteId: 'Объект не найден в направлении' } });
    const scopeKey = econScopeKey(input.scope, sectionId, siteId);
    const existing = await this.prisma.econBudget.findUnique({ where: { directionId_scopeKey: { directionId: dir.id, scopeKey } } });
    if (existing) throw new ConflictException(existing.isArchived ? 'Такой центр затрат уже есть в архиве — восстановите его.' : 'Такой центр затрат уже есть.');
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.econBudget.create({ data: { directionId: dir.id, scope: input.scope, scopeKey, sectionId, siteId } });
      await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'econ_budget', entityId: b.id, directionId: dir.id, siteId, after: { scope: b.scope, sectionId, siteId }, ip }, tx);
      return { id: b.id };
    });
  }

  async saveBudget(user: AuthUser, id: number, input: EconBudgetSave, ip: string | null) {
    const b = await this.budgetInScope(user, id);
    const articles = await this.prisma.econArticle.findMany({ where: { id: { in: input.limits.map((l) => l.articleId) } } });
    const known = new Set((await this.prisma.econLimit.findMany({ where: { budgetId: id }, select: { articleId: true } })).map((l) => l.articleId));
    for (const l of input.limits) {
      const a = articles.find((x) => x.id === l.articleId);
      if (!a || (a.isArchived && !known.has(a.id))) throw new BadRequestException(`Статья №${l.articleId} не найдена или в архиве`);
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.econBudget.findUniqueOrThrow({ where: { id }, include: { limits: true } });
      const changed = await tx.econBudget.updateMany({
        where: { id, version: input.version },
        data: {
          costNet: dec(input.costNet),
          vatExempt: input.vatExempt,
          laborHoursNorm: dec(input.laborHoursNorm),
          machineHoursNorm: dec(input.machineHoursNorm),
          note: input.note || null,
          ...(input.isArchived === undefined ? {} : { isArchived: input.isArchived }),
          version: { increment: 1 },
        },
      });
      if (!changed.count) throw conflict('Центр затрат');
      await tx.econLimit.deleteMany({ where: { budgetId: id } });
      if (input.limits.length)
        await tx.econLimit.createMany({
          data: input.limits.map((l) => ({
            budgetId: id,
            articleId: l.articleId,
            method: l.method,
            sharePct: l.method === 'SHARE' ? dec(l.sharePct) : null,
            amount: l.method === 'AMOUNT' ? dec(l.amount) : null,
            setBy: l.setBy || null,
            note: l.note || null,
          })),
        });
      const after = await tx.econBudget.findUniqueOrThrow({ where: { id }, include: { limits: true } });
      const comment = input.isArchived === true && !before.isArchived ? 'Центр затрат в архиве' : input.isArchived === false && before.isArchived ? 'Центр затрат восстановлен' : 'Лимиты и нормы';
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'econ_budget', entityId: id, directionId: b.directionId, siteId: b.siteId, before: plain(before), after: plain(after), comment, ip }, tx);
      return { id, version: after.version };
    });
  }

  private async monthStatus(month: string) {
    return (await this.prisma.econMonth.findUnique({ where: { month } })) ?? null;
  }

  async month(user: AuthUser, month: string): Promise<EconMonthView> {
    const p = await this.access.assertEconomics(user);
    const dirFilter = p.directionIds ? { id: { in: p.directionIds } } : {};
    const [m, rows, company] = await Promise.all([
      this.monthStatus(month),
      this.prisma.econBudgetMonth.findMany({ where: { month, budget: { direction: { isActive: true, ...dirFilter } } }, include: { facts: true } }),
      this.prisma.econCompanyFact.findMany({ where: { month } }),
    ]);
    const [editors, reportHours, revenue] = await Promise.all([this.userNames([...rows.map((r) => r.updatedById), m?.closedById]), this.reportHours(month, p.directionIds), this.revenueHints(month, p.directionIds)]);
    return {
      month,
      status: m?.status ?? 'OPEN',
      version: m?.version ?? 0,
      closedAt: m?.closedAt?.toISOString() ?? null,
      closedBy: m?.closedById ? (editors.get(m.closedById) ?? null) : null,
      rows: rows.map((r) => factRow(r, editors)),
      company: Object.fromEntries(company.map((c) => [String(c.articleId), Number(c.amount)])),
      reportHours,
      revenue,
    };
  }

  /** Подсказки для ввода: КС-2 из дашборда за месяц (разница нарастающих итогов) и расчётное НЗП на конец месяца. */
  private async revenueHints(month: string, directionIds: number[] | null): Promise<EconMonthView['revenue']> {
    const vat = (await this.settings()).vatRate;
    const visible = new Set((await this.prisma.econBudget.findMany({ where: directionIds ? { directionId: { in: directionIds } } : {}, select: { id: true } })).map((b) => b.id));
    const d = new Date(`${month}-01T00:00:00Z`);
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const [cur, before] = await Promise.all([computeResults(this.prisma, this.kpi, month, vat), computeResults(this.prisma, this.kpi, prev, vat)]);
    const out: EconMonthView['revenue'] = {};
    for (const r of cur.results.values()) {
      if (!visible.has(r.budgetId)) continue;
      const p = before.results.get(r.budgetId)?.ksDash ?? 0;
      out[r.budgetId] = { ksDashMonth: r.ksDash == null ? null : Math.round((r.ksDash - p) * 100) / 100, nzpAuto: r.nzpAuto, ksSource: r.ksSource };
    }
    return out;
  }

  /** Объекты, которые покрывает каждый центр затрат доступных направлений. */
  private async coverage(directionIds: number[] | null) {
    const dirFilter = directionIds ? { id: { in: directionIds } } : {};
    const [budgets, sites] = await Promise.all([
      this.prisma.econBudget.findMany({ where: { direction: { isActive: true, ...dirFilter } }, select: { id: true, directionId: true, scope: true, sectionId: true, siteId: true, isArchived: true } }),
      this.prisma.site.findMany({ where: { isArchived: false, direction: { isActive: true, ...dirFilter } }, select: { id: true, directionId: true, sectionId: true } }),
    ]);
    return new Map(budgets.map((b) => [b.id, econCoveredSites(b, budgets.filter((x) => x.directionId === b.directionId), sites.filter((s) => s.directionId === b.directionId)).map((s) => s.id)]));
  }

  /**
   * Оценка часов за месяц по отчётам дашборда: люди и техника на объекте × 8 ч за дневной отчёт, × 40 ч за недельный.
   * Для направлений с отчётами другого вида (Благоустройство) оценки нет.
   */
  private async reportHours(month: string, directionIds: number[] | null): Promise<EconMonthView['reportHours']> {
    const cover = await this.coverage(directionIds);
    const siteIds = [...new Set([...cover.values()].flat())];
    if (!siteIds.length) return {};
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const reports = await this.prisma.siteReport.findMany({
      where: { siteId: { in: siteIds }, period: { date: { gte: from, lt: to }, direction: { periodKind: { in: ['DAY', 'WEEK'] } } } },
      select: { siteId: true, workers: true, machines: true, period: { select: { date: true, direction: { select: { periodKind: true } } } } },
    });
    const out: EconMonthView['reportHours'] = {};
    for (const [budgetId, ids] of cover) {
      const own = reports.filter((r) => ids.includes(r.siteId));
      if (!own.length) continue;
      const h = (r: (typeof own)[number]) => (r.period.direction.periodKind === 'DAY' ? 8 : 40);
      const sum = (f: (r: (typeof own)[number]) => number | null) => { const v = own.filter((r) => f(r) != null); return v.length ? v.reduce((a, r) => a + f(r)! * h(r), 0) : null; };
      out[budgetId] = { labor: sum((r) => r.workers), machine: sum((r) => r.machines), days: new Set(own.map((r) => r.period.date.toISOString())).size };
    }
    return out;
  }

  /** Обзор: факт нарастающим итогом до месяца включительно и помесячный ряд за 12 месяцев. */
  async overview(user: AuthUser, month: string, directionId?: number): Promise<EconOverview> {
    const p = await this.access.assertEconomics(user);
    const ids = directionId ? (p.directionIds ? p.directionIds.filter((x) => x === directionId) : [directionId]) : p.directionIds;
    const dirFilter = ids ? { id: { in: ids } } : {};
    const start = new Date(`${month}-01T00:00:00Z`);
    const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7));
    const [rows, company] = await Promise.all([
      this.prisma.econBudgetMonth.findMany({ where: { month: { lte: month }, budget: { direction: { isActive: true, ...dirFilter } } }, include: { facts: true } }),
      // общие расходы компании — только в обзоре без выбора направления
      directionId ? [] : this.prisma.econCompanyFact.findMany({ where: { month: { lte: month } } }),
    ]);
    const budgets = new Map<number, EconOverview['budgets'][number]>();
    const monthly = new Map(months.map((m) => [m, {} as Record<string, number>]));
    const add = (rec: Record<string, number>, key: number, v: number) => (rec[key] = Math.round(((rec[key] ?? 0) + v) * 100) / 100);
    for (const r of rows) {
      const b = budgets.get(r.budgetId) ?? { budgetId: r.budgetId, facts: {}, laborHours: null, machineHours: null, months: 0 };
      for (const f of r.facts) {
        add(b.facts, f.articleId, Number(f.amount));
        const mm = monthly.get(r.month);
        if (mm) add(mm, f.articleId, Number(f.amount));
      }
      if (r.laborHours != null) b.laborHours = (b.laborHours ?? 0) + Number(r.laborHours);
      if (r.machineHours != null) b.machineHours = (b.machineHours ?? 0) + Number(r.machineHours);
      b.months++;
      budgets.set(r.budgetId, b);
    }
    const companyTotal: Record<string, number> = {};
    for (const c of company) {
      add(companyTotal, c.articleId, Number(c.amount));
      const mm = monthly.get(c.month);
      if (mm) add(mm, c.articleId, Number(c.amount));
    }
    const [settings, visible] = await Promise.all([this.settings(), this.prisma.econBudget.findMany({ where: { isArchived: false, direction: { isActive: true, ...dirFilter } }, select: { id: true } })]);
    const r = await computeResults(this.prisma, this.kpi, month, settings.vatRate);
    const results = visible.map((b) => r.results.get(b.id)).filter((x): x is NonNullable<typeof x> => !!x).map(({ ksDash: _k, ...x }) => x);
    return { month, budgets: [...budgets.values()], company: companyTotal, monthly: months.map((m) => ({ month: m, byArticle: monthly.get(m)! })), results, programRevenue: r.programRevenue, asOf: r.asOf };
  }

  private async userNames(ids: (number | null | undefined)[]) {
    const list = [...new Set(ids.filter((v): v is number => v != null))];
    const users = list.length ? await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  /**
   * Сохранение факта за месяц одним пакетом (форма или загрузка из Excel): всё или ничего.
   * Строка без version (0) создаётся; с version — правится, при расхождении версий — 409.
   */
  async saveMonth(user: AuthUser, month: string, input: EconMonthSave, ip: string | null) {
    const p = await this.access.assertEconomics(user, true);
    const articles = new Map((await this.prisma.econArticle.findMany()).map((a) => [a.id, a]));
    const checkAmounts = (amounts: Record<string, number | null>, company: boolean, where: string) => {
      for (const key of Object.keys(amounts)) {
        const a = articles.get(Number(key));
        if (!a) throw new BadRequestException(`${where}: статья №${key} не найдена`);
        if (econIsCompanyKind(a.kind) !== company)
          throw new BadRequestException(company ? `Статья «${a.name}» вносится по центрам затрат` : `${where}: статья «${a.name}» вносится общей суммой на компанию`);
      }
    };
    const budgets = await this.prisma.econBudget.findMany({ where: { id: { in: input.rows.map((r) => r.budgetId) } }, include: { direction: { select: { isActive: true } }, site: { select: { name: true, shortName: true } }, section: { select: { name: true } } } });
    for (const r of input.rows) {
      const b = budgets.find((x) => x.id === r.budgetId);
      if (!b || !b.direction.isActive || (p.directionIds && !p.directionIds.includes(b.directionId))) throw new NotFoundException(`Центр затрат №${r.budgetId} не найден`);
      if (b.isArchived) throw new BadRequestException(`Центр затрат «${budgetTitle(b)}» в архиве — восстановите его, чтобы вносить факт`);
      checkAmounts(r.amounts, false, budgetTitle(b));
    }
    if (input.company) checkAmounts(input.company.amounts, true, 'Общие расходы');

    return this.prisma.$transaction(async (tx) => {
      // Строка месяца блокируется на время сохранения: смена статуса и параллельное сохранение ждут.
      let period = await tx.econMonth.upsert({ where: { month }, create: { month }, update: { updatedAt: new Date() } });
      if (period.status !== 'OPEN') throw new ForbiddenException(`Месяц ${period.status === 'LOCKED' ? 'заблокирован администратором' : 'закрыт'} — правки невозможны. Откройте месяц.`);
      if (input.company) {
        if (!sameVersion(input.company.version, period.version)) throw conflict('Общие расходы за месяц');
        period = await tx.econMonth.update({ where: { month }, data: { version: { increment: 1 } } });
        const before = await tx.econCompanyFact.findMany({ where: { month } });
        await tx.econCompanyFact.deleteMany({ where: { month } });
        const data = Object.entries(input.company.amounts).filter(([, v]) => v != null).map(([k, v]) => ({ month, articleId: Number(k), amount: dec(v)! }));
        if (data.length) await tx.econCompanyFact.createMany({ data });
        if (!sameAmounts(before.map((x) => [x.articleId, Number(x.amount)]), data.map((x) => [x.articleId, Number(x.amount)])))
          await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'econ_company_fact', entityId: month, before: amountsObj(before), after: amountsObj(data), comment: input.comment || 'Общие расходы за месяц', ip }, tx);
      }
      let saved = 0;
      for (const r of input.rows) {
        const b = budgets.find((x) => x.id === r.budgetId)!;
        const amounts = Object.entries(r.amounts).filter(([, v]) => v != null).map(([k, v]) => ({ articleId: Number(k), amount: dec(v)! }));
        const fields = {
          laborHours: dec(r.laborHours),
          machineHours: dec(r.machineHours),
          ksAmount: dec(r.ksAmount ?? null),
          nzpOverride: dec(r.nzpOverride ?? null),
          nzpNote: r.nzpOverride == null ? null : r.nzpNote?.trim() || null,
          note: r.note || null,
          updatedById: user.id,
        };
        let row: { id: number };
        let before: MonthRowRecord | null = null;
        if (r.version === 0) {
          if (await tx.econBudgetMonth.findUnique({ where: { budgetId_month: { budgetId: r.budgetId, month } } })) throw conflict(`Факт «${budgetTitle(b)}»`);
          if (!amounts.length && r.laborHours == null && r.machineHours == null && r.ksAmount == null && r.nzpOverride == null && !r.note) continue;
          row = await tx.econBudgetMonth.create({ data: { budgetId: r.budgetId, month, ...fields } });
        } else {
          before = await tx.econBudgetMonth.findUnique({ where: { budgetId_month: { budgetId: r.budgetId, month } }, include: { facts: true } });
          if (!before) throw conflict(`Факт «${budgetTitle(b)}»`);
          const after = { laborHours: num(fields.laborHours), machineHours: num(fields.machineHours), note: fields.note };
          const same = num(before.laborHours) === after.laborHours && num(before.machineHours) === after.machineHours && before.note === after.note &&
            num(before.ksAmount) === num(fields.ksAmount) && num(before.nzpOverride) === num(fields.nzpOverride) && before.nzpNote === fields.nzpNote &&
            sameAmounts(before.facts.map((f) => [f.articleId, Number(f.amount)]), amounts.map((f) => [f.articleId, Number(f.amount)]));
          if (before.version !== r.version) throw conflict(`Факт «${budgetTitle(b)}»`);
          if (same) continue;
          const changed = await tx.econBudgetMonth.updateMany({ where: { id: before.id, version: r.version }, data: { ...fields, version: { increment: 1 } } });
          if (!changed.count) throw conflict(`Факт «${budgetTitle(b)}»`);
          row = before;
          await tx.econFact.deleteMany({ where: { budgetMonthId: row.id } });
        }
        if (amounts.length) await tx.econFact.createMany({ data: amounts.map((a) => ({ budgetMonthId: row.id, ...a })) });
        const after = await tx.econBudgetMonth.findUniqueOrThrow({ where: { id: row.id }, include: { facts: true } });
        await this.audit.write(
          { userId: user.id, action: before ? 'UPDATE' : 'CREATE', entity: 'econ_fact', entityId: `${r.budgetId}:${month}`, directionId: b.directionId, siteId: b.siteId, before: before ? rowPlain(before) : null, after: rowPlain(after), comment: input.comment || `Факт за ${month}`, ip },
          tx,
        );
        saved++;
      }
      return { saved, monthVersion: period.version };
    });
  }

  async setMonthStatus(user: AuthUser, month: string, input: { status: EconMonthStatus; version: number }, ip: string | null) {
    const p = await this.access.assertEconomics(user, true);
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.econMonth.upsert({ where: { month }, create: { month }, update: { updatedAt: new Date() } });
      if (!sameVersion(input.version, m.version)) throw conflict('Статус месяца');
      if (!p.canAdmin && (m.status === 'LOCKED' || input.status === 'LOCKED')) throw new ForbiddenException('Блокировать и разблокировать месяц может администратор');
      if (m.status === input.status) return { status: m.status, version: m.version };
      const closing = input.status !== 'OPEN';
      const after = await tx.econMonth.update({
        where: { month },
        data: { status: input.status, version: { increment: 1 }, closedById: closing ? user.id : null, closedAt: closing ? new Date() : null },
      });
      await this.audit.write({ userId: user.id, action: closing ? 'PERIOD_CLOSE' : 'PERIOD_OPEN', entity: 'econ_month', entityId: month, before: { status: m.status }, after: { status: after.status }, ip }, tx);
      return { status: after.status, version: after.version };
    });
  }

  async createArticle(user: AuthUser, input: EconArticleInput, ip: string | null) {
    await this.access.assertEconomics(user, true);
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.econArticle.aggregate({ _max: { sort: true } });
      const a = await tx.econArticle.create({
        data: { code: `c${Date.now().toString(36)}`, name: input.name, kind: input.kind, method: input.method || null, sort: input.sort ?? (last._max.sort ?? 0) + 10, isArchived: input.isArchived ?? false },
      });
      await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'econ_article', entityId: a.id, after: article(a), ip }, tx);
      return article(a);
    });
  }

  async saveArticle(user: AuthUser, id: number, input: EconArticleInput, ip: string | null) {
    await this.access.assertEconomics(user, true);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.econArticle.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Статья не найдена');
      if (before.kind !== input.kind && ((await tx.econFact.count({ where: { articleId: id } })) || (await tx.econCompanyFact.count({ where: { articleId: id } }))))
        throw new BadRequestException({ message: 'По статье уже внесён факт — вид статьи изменить нельзя', fields: { kind: 'По статье уже внесён факт' } });
      const a = await tx.econArticle.update({ where: { id }, data: { name: input.name, kind: input.kind, method: input.method || null, sort: input.sort ?? before.sort, isArchived: input.isArchived ?? before.isArchived } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'econ_article', entityId: id, before: article(before), after: article(a), ip }, tx);
      return article(a);
    });
  }

  async saveSettings(user: AuthUser, input: EconSettings, ip: string | null) {
    await this.access.assertEconomics(user, true);
    const before = await this.settings();
    await this.prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value: input }, update: { value: input } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'econ_settings', entityId: 'settings', before, after: input, ip }, tx);
    });
    return input;
  }

  async editors(user: AuthUser): Promise<EconEditors> {
    if (!(await this.access.economicsPermissions(user)).canAdmin) throw new ForbiddenException('Назначать ответственных ПЭО может администратор');
    const [users, editors] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true, canLogin: true }, select: { id: true, fullName: true, login: true }, orderBy: { fullName: 'asc' } }),
      this.prisma.econEditor.findMany(),
    ]);
    return { users, userIds: editors.map((e) => e.userId) };
  }

  async setEditors(user: AuthUser, userIds: number[], ip: string | null) {
    if (!(await this.access.economicsPermissions(user)).canAdmin) throw new ForbiddenException('Назначать ответственных ПЭО может администратор');
    const ids = [...new Set(userIds)];
    if ((await this.prisma.user.count({ where: { id: { in: ids }, isActive: true, canLogin: true } })) !== ids.length) throw new BadRequestException('Выберите действующих пользователей со входом в систему');
    await this.prisma.$transaction(async (tx) => {
      // Блокировка общей строки сериализует одновременное назначение ответственных.
      await tx.appSetting.upsert({ where: { key: 'economics.editors.lock' }, create: { key: 'economics.editors.lock', value: {} }, update: { value: {} } });
      const before = await tx.econEditor.findMany();
      await tx.econEditor.deleteMany();
      if (ids.length) await tx.econEditor.createMany({ data: ids.map((userId) => ({ userId })) });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'econ_editors', entityId: 'editors', before: before.map((r) => r.userId), after: ids, ip }, tx);
    });
    return this.editors(user);
  }

  async journal(user: AuthUser): Promise<EconAuditItem[]> {
    const p = await this.access.assertEconomics(user);
    this.access.assertFeature(user, 'audit');
    const entities = ['econ_budget', 'econ_fact', 'econ_company_fact', 'econ_month', 'econ_article', 'econ_settings', 'econ_demo', ...(p.canAdmin ? ['econ_editors'] : [])];
    const rows = await this.prisma.auditLog.findMany({
      where: { entity: { in: entities }, ...(p.directionIds ? { directionId: { in: p.directionIds } } : {}) },
      take: 200,
      orderBy: { id: 'desc' },
      include: { user: { select: { fullName: true } } },
    });
    return rows.map((r) => ({ id: String(r.id), at: r.at.toISOString(), user: r.user?.fullName ?? 'Система', action: r.action, entity: r.entity, entityId: r.entityId, comment: r.comment }));
  }
}

function article(a: { id: number; code: string; name: string; kind: EconArticle['kind']; method: string | null; sort: number; isArchived: boolean }): EconArticle {
  return { id: a.id, code: a.code, name: a.name, kind: a.kind, method: a.method, sort: a.sort, isArchived: a.isArchived };
}

function budgetTitle(b: { scope: EconBudget['scope']; site: { name: string; shortName: string | null } | null; section: { name: string } | null }) {
  if (b.scope === 'SITE') return b.site?.shortName || b.site?.name || 'Объект';
  if (b.scope === 'SECTION') return b.section?.name ?? 'Лот';
  return ECON_SCOPE_LABELS.DIRECTION;
}

function factRow(r: MonthRowRecord, users: Map<number, string>): EconFactRow {
  return {
    budgetId: r.budgetId,
    version: r.version,
    laborHours: num(r.laborHours),
    machineHours: num(r.machineHours),
    note: r.note,
    amounts: Object.fromEntries(r.facts.map((f) => [String(f.articleId), Number(f.amount)])),
    ksAmount: num(r.ksAmount),
    nzpOverride: num(r.nzpOverride),
    nzpNote: r.nzpNote,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedById ? (users.get(r.updatedById) ?? null) : null,
  };
}

/** Для журнала: десятичные — числами. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Prisma.Decimal ? Number(x) : x)));
const rowPlain = (r: MonthRowRecord) => ({ laborHours: num(r.laborHours), machineHours: num(r.machineHours), ksAmount: num(r.ksAmount), nzpOverride: num(r.nzpOverride), nzpNote: r.nzpNote, note: r.note, amounts: amountsObj(r.facts) });
const amountsObj = (list: { articleId: number; amount: Prisma.Decimal }[]) => Object.fromEntries(list.map((x) => [x.articleId, Number(x.amount)]));
function sameAmounts(a: [number, number][], b: [number, number][]) {
  const key = (l: [number, number][]) => JSON.stringify([...l].sort((x, y) => x[0] - y[0]));
  return key(a) === key(b);
}
