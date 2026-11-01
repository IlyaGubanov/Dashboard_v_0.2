import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ECON_CASH_COMPANY, ECON_CASH_INFLOW_BY_DIRECTION, econCashScope, econIsOwnOrg, econNet, econScopeKey, econYearMonths, type EconScope } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';
import { econCoveredSites } from './coverage';
import { EconomicsDeviationsService } from './economics-deviations.service';

/** Что создано демо-загрузкой — удаляется только это. */
const DEMO_KEY = 'economics.demo';
const SETTINGS_KEY = 'economics.settings';
/** Демо-месяцы: факт за апрель–октябрь 2026, октябрь открыт, остальные закрыты ПЭО. */
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
/** Доля расходов месяца в накопленных (S-кривая освоения). */
const CURVE = [0.06, 0.1, 0.14, 0.17, 0.18, 0.18, 0.17];
/** Направления, где КС-2 в дашборде не ведутся — в демо их вносит ПЭО. */
const MANUAL_KS = ['schools', 'streets'];
const LABOR_RATE = 850;
const MACHINE_RATE = 4200;
const ARTICLES = ['fot', 'materials', 'machinery', 'subcontract', 'waste', 'overhead', 'admin'] as const;
type Code = (typeof ARTICLES)[number];
/** Типовые доли статей от стоимости без НДС, % — по направлениям. */
const SHARES: Record<string, Record<Code, number>> = {
  schools: { fot: 16, materials: 38, machinery: 6, subcontract: 18, waste: 2.5, overhead: 6, admin: 4 },
  mkd: { fot: 22, materials: 34, machinery: 4, subcontract: 12, waste: 1.5, overhead: 6, admin: 4 },
  networks: { fot: 14, materials: 26, machinery: 14, subcontract: 22, waste: 3, overhead: 6, admin: 4 },
  streets: { fot: 18, materials: 36, machinery: 12, subcontract: 12, waste: 2, overhead: 6, admin: 4 },
};
/** Отклонения факта от плана затрат (+ перерасход) — чтобы в обзоре были и экономия, и перерасход. */
const SPECIAL: { dir: string; nth: number; code: Code; dev: number }[] = [
  { dir: 'schools', nth: 0, code: 'materials', dev: 0.14 },
  { dir: 'schools', nth: 2, code: 'fot', dev: 0.06 },
  { dir: 'mkd', nth: 1, code: 'machinery', dev: 0.07 },
  { dir: 'mkd', nth: 3, code: 'fot', dev: 0.12 },
  { dir: 'networks', nth: 0, code: 'subcontract', dev: 0.12 },
  { dir: 'networks', nth: 1, code: 'machinery', dev: 0.05 },
  { dir: 'streets', nth: 0, code: 'waste', dev: 0.2 },
];
/** Детерминированный разброс −1…1 (одинаковые демо-данные при каждой загрузке). */
const jitter = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return (x - Math.floor(x)) * 2 - 1;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Plan { directionId: number; code: string; scope: EconScope; sectionId: number | null; siteId: number | null; costNet: number | null; note: string | null }

@Injectable()
export class EconomicsDemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
    private readonly deviations: EconomicsDeviationsService,
  ) {}

  private async assertAdmin(user: AuthUser) {
    if (!(await this.access.economicsPermissions(user)).canAdmin) throw new ForbiddenException('Демо-данные загружает и удаляет администратор');
  }

  private async marker() {
    const s = await this.prisma.appSetting.findUnique({ where: { key: DEMO_KEY } });
    return (s?.value ?? null) as { budgetIds: number[]; months: string[]; companyMonths: string[]; cashSheetIds?: number[] } | null;
  }

  /** Центры затрат для демо: школы — по объекту, МКД — по лотам и крупнейший объект, Сети — СР-лоты и остальное направление, Благоустройство — всё направление. */
  private async plans(): Promise<Plan[]> {
    const dirs = await this.prisma.direction.findMany({
      where: { isActive: true, code: { in: Object.keys(SHARES) } },
      include: { sections: { where: { isArchived: false } }, sites: { where: { isArchived: false }, select: { id: true, sectionId: true } } },
    });
    const plans: Plan[] = [];
    for (const d of dirs) {
      if (!d.sites.length) continue;
      const money = await this.kpi.siteMoney(d.id);
      const cost = (id: number) => money.get(id)?.portfolio ?? 0;
      const base = { directionId: d.id, code: d.code, costNet: null, note: 'Демо-данные' };
      if (d.code === 'schools') {
        for (const s of d.sites.filter((s) => cost(s.id) >= 1e7)) plans.push({ ...base, scope: 'SITE', sectionId: null, siteId: s.id });
      } else if (d.code === 'mkd') {
        const big = [...d.sites].sort((a, b) => cost(b.id) - cost(a.id))[0];
        if (big && cost(big.id)) plans.push({ ...base, scope: 'SITE', sectionId: null, siteId: big.id });
        for (const sec of d.sections) plans.push({ ...base, scope: 'SECTION', sectionId: sec.id, siteId: null });
      } else if (d.code === 'networks') {
        for (const sec of d.sections.filter((s) => /коллектор|пруд|водн/i.test(s.name))) plans.push({ ...base, scope: 'SECTION', sectionId: sec.id, siteId: null });
        plans.push({ ...base, scope: 'DIRECTION', sectionId: null, siteId: null });
      } else {
        // в Благоустройстве стоимости в дашборде нет — ПЭО задаёт её по сметам
        plans.push({ ...base, scope: 'DIRECTION', sectionId: null, siteId: null, costNet: 1_180_000_000, note: 'Демо-данные. Стоимость без НДС — по сметам (в дашборде стоимости нет)' });
      }
    }
    return plans;
  }

  async load(user: AuthUser, ip: string | null) {
    await this.assertAdmin(user);
    if (await this.marker()) throw new ConflictException('Демо-данные экономики уже загружены. Чтобы загрузить заново, сначала удалите их.');
    const settings = ((await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } }))?.value ?? {}) as { vatRate?: number; laborRate?: number | null; machineRate?: number | null };
    const vat = settings.vatRate ?? 22;
    const articles = new Map((await this.prisma.econArticle.findMany({ where: { code: { in: [...ARTICLES] } } })).map((a) => [a.code, a]));
    if (articles.size !== ARTICLES.length) throw new ConflictException('Нет статей расходов по умолчанию — проверьте справочник');
    const plans = await this.plans();
    const existing = await this.prisma.econBudget.findMany({ select: { directionId: true, scopeKey: true } });
    const taken = new Set(existing.map((b) => `${b.directionId}:${b.scopeKey}`));
    const todo = plans.filter((p) => !taken.has(`${p.directionId}:${econScopeKey(p.scope, p.sectionId, p.siteId)}`));

    // готовность и подрядчики считаются по итоговому составу центров затрат направления
    const sitesByDir = new Map<number, { id: number; sectionId: number | null }[]>();
    for (const d of new Set(todo.map((p) => p.directionId)))
      sitesByDir.set(d, await this.prisma.site.findMany({ where: { directionId: d, isArchived: false }, select: { id: true, sectionId: true } }));
    const scopeOf = (p: Plan) => ({ scope: p.scope, sectionId: p.sectionId, siteId: p.siteId, isArchived: false });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const budgetIds: number[] = [];
        const directTotals = new Map<string, number>();
        const nth = new Map<string, number>();
        for (const p of todo) {
          const k = nth.get(p.code) ?? 0;
          nth.set(p.code, k + 1);
          const allScopes = [...plans.filter((x) => x.directionId === p.directionId).map(scopeOf)];
          const covered = econCoveredSites(scopeOf(p), allScopes, sitesByDir.get(p.directionId) ?? []);
          const money = await this.kpi.siteMoney(p.directionId);
          const m = covered.map((s) => money.get(s.id)).filter((x): x is NonNullable<typeof x> => !!x);
          const gross = m.reduce((a, x) => a + (x.portfolio ?? 0), 0);
          const costBase = p.costNet ?? econNet(gross || null, vat, false);
          if (!costBase) continue;
          const w = m.filter((x) => x.fact != null && x.portfolio);
          const progress = w.length ? w.reduce((a, x) => a + x.fact! * x.portfolio!, 0) / w.reduce((a, x) => a + x.portfolio!, 0) : 0.35;

          // субподряд Сетей — по договорам сторонних подрядчиков из дашборда (без своих СМУ)
          let subcontract: number | null = null;
          if (p.code === 'networks') {
            const contracts = await tx.contract.findMany({ where: { siteId: { in: covered.map((s) => s.id) }, organizationId: { not: null } }, select: { amount: true, organization: { select: { name: true } } } });
            const ext = contracts.filter((c) => c.organization && !econIsOwnOrg(c.organization.name)).reduce((a, c) => a + Number(c.amount ?? 0), 0);
            if (ext > 0) subcontract = r2(Math.min(econNet(ext, vat, false)!, costBase * 0.6));
          }

          // при субподряде по договорам собственные прямые статьи уменьшаются пропорционально: лимиты всего ≈ 92% стоимости
          const shares = { ...SHARES[p.code] };
          if (subcontract != null) {
            const subPct = (subcontract / costBase) * 100;
            const own = ['fot', 'materials', 'machinery', 'waste'] as const;
            const room = 92 - subPct - shares.overhead - shares.admin;
            const sumOwn = own.reduce((a, c) => a + shares[c], 0);
            for (const c of own) shares[c] = Math.max(0.5, (shares[c] * room) / sumOwn);
          }
          const b = await tx.econBudget.create({
            data: { directionId: p.directionId, scope: p.scope, scopeKey: econScopeKey(p.scope, p.sectionId, p.siteId), sectionId: p.sectionId, siteId: p.siteId, costNet: p.costNet == null ? null : new Prisma.Decimal(p.costNet), note: p.note },
          });
          budgetIds.push(b.id);
          const limit: Record<Code, number> = {} as Record<Code, number>;
          for (const [i, code] of ARTICLES.entries()) {
            const pct = r2(shares[code] * (1 + 0.08 * jitter(b.id * 10 + i)));
            const asAmount = p.costNet != null || (code === 'subcontract' && subcontract != null);
            const amount = code === 'subcontract' && subcontract != null ? subcontract : r2((costBase * pct) / 100);
            limit[code] = asAmount ? amount : r2((costBase * pct) / 100);
            await tx.econLimit.create({
              data: {
                budgetId: b.id,
                articleId: articles.get(code)!.id,
                method: asAmount ? 'AMOUNT' : 'SHARE',
                sharePct: asAmount ? null : new Prisma.Decimal(pct),
                amount: asAmount ? new Prisma.Decimal(amount) : null,
                setBy: code === 'subcontract' && subcontract != null ? 'ПЭО по договорам подрядчиков' : asAmount ? 'ПЭО по сметам' : 'ПЭО, доля по аналогам',
              },
            });
          }
          await tx.econBudget.update({ where: { id: b.id }, data: { laborHoursNorm: new Prisma.Decimal(r2(limit.fot / LABOR_RATE)), machineHoursNorm: new Prisma.Decimal(r2(limit.machinery / MACHINE_RATE)) } });

          // факт: накопленный = лимит × готовность × (1 + отклонение), разнесённый по месяцам
          const devs = new Map<Code, number>();
          for (const [i, code] of ARTICLES.entries()) {
            const special = SPECIAL.find((s) => s.dir === p.code && s.nth === k && s.code === code);
            devs.set(code, special ? special.dev : 0.05 * jitter(b.id * 31 + i) - 0.01);
          }
          for (const [mi, month] of MONTHS.entries()) {
            const share = CURVE[mi] * (1 + 0.15 * jitter(b.id * 7 + mi));
            const amounts = (['fot', 'materials', 'machinery', 'subcontract', 'waste'] as const).map((code) => ({ code, v: r2(limit[code] * progress * (1 + devs.get(code)!) * share) }));
            const row = await tx.econBudgetMonth.create({
              data: {
                budgetId: b.id,
                month,
                laborHours: new Prisma.Decimal(r2((amounts[0].v / LABOR_RATE) * (1 + 0.04 * jitter(b.id + mi)))),
                machineHours: new Prisma.Decimal(r2((amounts[2].v / MACHINE_RATE) * (1 + 0.06 * jitter(b.id * 3 + mi)))),
                // где в дашборде КС-2 нет (Школы, Благоустройство), ПЭО вносит их сам: ~85% выполненного за месяц
                ksAmount: MANUAL_KS.includes(p.code) ? new Prisma.Decimal(r2(costBase * progress * share * 0.85)) : null,
                // пример поправки НЗП: в последнем месяце у первого центра Школ часть работ не принята заказчиком
                ...(p.code === 'schools' && k === 0 && mi === MONTHS.length - 1
                  ? { nzpOverride: new Prisma.Decimal(r2(costBase * progress * 0.15 * 0.6)), nzpNote: 'Часть выполненных работ не будет принята: замечания заказчика по фасаду' }
                  : {}),
                // закупка материалов: обычно на 5–15% больше списанного; у второго центра МКД — почти вдвое (деньги на складе)
                materialsPurchased: new Prisma.Decimal(r2(amounts[1].v * (p.code === 'mkd' && k === 1 ? 1.95 : 1.1 + 0.05 * jitter(b.id * 13 + mi)))),
                updatedById: user.id,
              },
            });
            await tx.econFact.createMany({ data: amounts.filter((a) => a.v > 0).map((a) => ({ budgetMonthId: row.id, articleId: articles.get(a.code)!.id, amount: new Prisma.Decimal(a.v) })) });
            directTotals.set(month, (directTotals.get(month) ?? 0) + amounts.reduce((s, a) => s + a.v, 0));
          }
        }

        // общие расходы компании: только за месяцы, где их ещё нет
        const companyMonths: string[] = [];
        for (const month of MONTHS) {
          const total = directTotals.get(month);
          if (!total) continue;
          await tx.econMonth.upsert({ where: { month }, create: { month }, update: {} });
          if (await tx.econCompanyFact.count({ where: { month } })) continue;
          await tx.econCompanyFact.createMany({
            data: [
              { month, articleId: articles.get('overhead')!.id, amount: new Prisma.Decimal(r2(total * 0.072)) },
              { month, articleId: articles.get('admin')!.id, amount: new Prisma.Decimal(r2(total * 0.046)) },
            ],
          });
          companyMonths.push(month);
        }
        // апрель–сентябрь закрыты ПЭО, октябрь открыт для ввода
        const months = MONTHS.filter((m) => directTotals.has(m));
        for (const month of months.slice(0, -1)) {
          const cur = await tx.econMonth.findUniqueOrThrow({ where: { month } });
          if (cur.status === 'OPEN') await tx.econMonth.update({ where: { month }, data: { status: 'CLOSED', closedById: user.id, closedAt: new Date(), version: { increment: 1 } } });
        }
        if (settings.laborRate == null || settings.machineRate == null)
          await tx.appSetting.upsert({
            where: { key: SETTINGS_KEY },
            create: { key: SETTINGS_KEY, value: { vatRate: vat, laborRate: LABOR_RATE, machineRate: MACHINE_RATE } },
            update: { value: { vatRate: vat, laborRate: settings.laborRate ?? LABOR_RATE, machineRate: settings.machineRate ?? MACHINE_RATE } },
          });
        const cashSheetIds = await this.demoCash(tx, budgetIds, vat);
        const marker = { budgetIds, months, companyMonths, cashSheetIds };
        await tx.appSetting.upsert({ where: { key: DEMO_KEY }, create: { key: DEMO_KEY, value: marker }, update: { value: marker } });
        await this.audit.write({ userId: user.id, action: 'IMPORT', entity: 'econ_demo', entityId: 'demo', after: { budgets: budgetIds.length, months }, comment: `Загружены демо-данные экономики: центров затрат ${budgetIds.length}, месяцев ${months.length}`, ip }, tx);
        return { budgets: budgetIds.length, months: months.length, skipped: plans.length - todo.length, budgetIds };
      },
      { timeout: 120_000 },
    );
    const deviations = await this.demoDeviations(user, result.budgetIds, ip);
    return { budgets: result.budgets, months: result.months, skipped: result.skipped, deviations };
  }

  /**
   * Разборы отклонений по демо-центрам затрат за последний демо-месяц: первые найденные — «в работе», «просрочено»,
   * «решено» и закупка сверх потребности. Ответственный — куратор направления, иначе первый из допустимых.
   * Удаляются вместе с центрами затрат.
   */
  private async demoDeviations(user: AuthUser, budgetIds: number[], ip: string | null) {
    const month = MONTHS[MONTHS.length - 1];
    const { items } = await this.deviations.detect(month, null);
    const own = items.filter((x) => budgetIds.includes(x.budgetId) && x.recordId == null);
    const plan = [
      ...own.filter((x) => x.kind === 'STOCK').slice(0, 1).map((x) => ({ x, cause: 'stock', decision: 'stop_purchase', status: 'IN_WORK' as const, due: '2026-11-20', result: null })),
      ...own.filter((x) => x.kind === 'OVERRUN' && x.status === 'critical').slice(0, 3).map((x, i) => ({
        x,
        cause: ['price', 'volume', 'productivity'][i],
        decision: ['supplier', 'claim', 'compensate'][i],
        status: (['OPEN', 'IN_WORK', 'RESOLVED'] as const)[i],
        due: ['2026-10-20', '2026-11-30', '2026-10-25'][i],
        result: i === 2 ? 'Перераспределён график бригад, простои устранены; перерасход компенсирован экономией по технике' : null,
      })),
    ];
    let n = 0;
    for (const p of plan) {
      const b = await this.prisma.econBudget.findUniqueOrThrow({ where: { id: p.x.budgetId }, select: { directionId: true } });
      const candidates = (await this.deviations.responsibleCandidates([b.directionId]))[String(b.directionId)] ?? [];
      const curator = await this.prisma.directionMember.findFirst({ where: { directionId: b.directionId, role: 'CURATOR', userId: { in: candidates.map((c) => c.id) } }, select: { userId: true } });
      const responsibleId = curator?.userId ?? candidates[0]?.id;
      if (!responsibleId) continue;
      const { id } = await this.deviations.create(user, { budgetId: p.x.budgetId, articleId: p.x.articleId, kind: p.x.kind, month, cause: p.cause as never, causeText: null, decision: p.decision as never, decisionText: null, responsibleId, dueDate: p.due }, ip);
      if (p.status !== 'OPEN') await this.deviations.update(user, id, { version: 1, status: p.status, result: p.result }, ip);
      n++;
    }
    return n;
  }

  /**
   * ДДС за 2026 год (с НДС): выплаты — факт расходов ПЭО с НДС (75% в месяце, 25% в следующем), план — близко к расходам,
   * на ноябрь–декабрь — средний темп; поступления — с задержками оплаты заказчиком; общие по компании — общие расходы и НДС.
   * Остаток на начало года подобран так, чтобы в факте разрыва не было, а в прогнозе он появлялся (для наглядности).
   * Таблицы создаются только там, где их ещё нет.
   */
  private async demoCash(tx: Prisma.TransactionClient, budgetIds: number[], vat: number): Promise<number[]> {
    const YEAR = 2026;
    const ym = econYearMonths(YEAR);
    const k = 1 + vat / 100;
    const arts = new Map((await tx.econCashArticle.findMany()).map((a) => [a.code, a]));
    if (!arts.size || !budgetIds.length) return [];
    const factMonths = new Set(MONTHS);
    const lastFact = MONTHS[MONTHS.length - 1];
    const future = ym.filter((m) => m > lastFact);
    const OUT = ['fot', 'materials', 'machinery', 'subcontract', 'waste'] as const;
    /** доля плановых поступлений, реально полученная в месяце (задержки оплаты заказчиком) */
    const PAY_IN: Record<string, number> = { '2026-04': 0.7, '2026-05': 0.9, '2026-06': 1, '2026-07': 1.05, '2026-08': 0.55, '2026-09': 0.85, '2026-10': 1.3 };
    const costs = await tx.econFact.findMany({
      where: { row: { month: { in: ym }, budgetId: { in: budgetIds } } },
      select: { amount: true, article: { select: { code: true } }, row: { select: { month: true, budget: { select: { directionId: true } } } } },
    });
    const company = await tx.econCompanyFact.findMany({ where: { month: { in: ym } }, select: { month: true, amount: true, article: { select: { code: true } } } });
    const dirs = await tx.direction.findMany({ where: { id: { in: [...new Set(costs.map((c) => c.row.budget.directionId))] } }, select: { id: true, code: true } });
    type Cell = { plan: number | null; fact: number | null };
    const sheets = new Map<string, { directionId: number | null; cells: Map<string, Cell> }>();
    const put = (scope: string, directionId: number | null, month: string, code: string, v: Cell) => {
      const sh = sheets.get(scope) ?? { directionId, cells: new Map<string, Cell>() };
      sheets.set(scope, sh);
      sh.cells.set(`${month}|${code}`, { plan: v.plan == null ? null : r2(v.plan), fact: v.fact == null ? null : r2(v.fact) });
    };
    const avg = (list: number[]) => (list.length ? list.reduce((a, x) => a + x, 0) / list.length : 0);
    for (const d of dirs) {
      const scope = econCashScope(d.id);
      const cost = (m: string | undefined, code: string) =>
        m ? costs.filter((c) => c.row.budget.directionId === d.id && c.row.month === m && c.article.code === code).reduce((a, c) => a + Number(c.amount), 0) * k : 0;
      const outPlan = new Map<string, number>();
      for (const [ci, code] of OUT.entries()) {
        const recent = MONTHS.slice(-3).map((m) => cost(m, code));
        for (const [i, m] of ym.entries()) {
          let cell: Cell | null = null;
          if (factMonths.has(m)) cell = { plan: cost(m, code) * (1 + 0.06 * jitter(d.id * 17 + i * 5 + ci)), fact: 0.75 * cost(m, code) + 0.25 * cost(ym[i - 1], code) };
          else if (m > lastFact) cell = { plan: avg(recent) * 1.05, fact: null };
          if (!cell || (!cell.plan && !cell.fact)) continue;
          put(scope, d.id, m, code, cell);
          outPlan.set(m, (outPlan.get(m) ?? 0) + (cell.plan ?? 0));
        }
      }
      const inCode = ECON_CASH_INFLOW_BY_DIRECTION[d.code] ?? 'in_commercial';
      for (const m of ym) {
        const plan = (outPlan.get(m) ?? 0) * 1.2;
        if (plan) put(scope, d.id, m, inCode, { plan, fact: factMonths.has(m) ? plan * (PAY_IN[m] ?? 1) : null });
      }
    }
    // общие по компании: общепроизводственные и административные расходы, НДС к уплате
    const totals = (m: string, kind: 'plan' | 'fact', dir: 'in' | 'out') => {
      let sum = 0;
      for (const sh of sheets.values())
        for (const [key, c] of sh.cells) {
          const [month, code] = key.split('|');
          if (month === m && (dir === 'in') === code.startsWith('in_')) sum += c[kind] ?? 0;
        }
      return sum;
    };
    for (const code of ['overhead', 'admin']) {
      const amount = (m: string) => company.filter((c) => c.month === m && c.article.code === code).reduce((a, c) => a + Number(c.amount), 0) * k;
      const recent = MONTHS.slice(-3).map(amount);
      for (const [i, m] of ym.entries()) {
        const v = amount(m);
        if (factMonths.has(m) && v) put(ECON_CASH_COMPANY, null, m, code, { plan: v * (1 + 0.04 * jitter(i + code.length)), fact: v });
        else if (m > lastFact) put(ECON_CASH_COMPANY, null, m, code, { plan: avg(recent), fact: null });
      }
    }
    for (const m of ym) {
      const vatOf = (kind: 'plan' | 'fact') => Math.max(0, (totals(m, kind, 'in') - totals(m, kind, 'out')) * (vat / (100 + vat)) * 0.8);
      const plan = vatOf('plan');
      if (plan || factMonths.has(m)) put(ECON_CASH_COMPANY, null, m, 'vat', { plan, fact: factMonths.has(m) ? vatOf('fact') : null });
    }
    // остаток на начало года: в факте не ниже 80 млн; если прогноз не уходит в минус — предоплата материалов в ноябре
    const net = (m: string, kind: 'plan' | 'fact') => totals(m, kind, 'in') - totals(m, kind, 'out');
    let cum = 0;
    let minFact = 0;
    for (const m of ym.filter((x) => x <= lastFact)) {
      cum += net(m, 'fact');
      minFact = Math.min(minFact, cum);
    }
    const opening = r2(80_000_000 - minFact);
    let bal = opening + cum;
    let minFuture = Infinity;
    for (const m of future) {
      bal += net(m, 'plan');
      minFuture = Math.min(minFuture, bal);
    }
    if (future.length && minFuture >= 0) {
      const biggest = [...sheets.entries()].filter(([sc]) => sc !== ECON_CASH_COMPANY).sort((a, b) => b[1].cells.size - a[1].cells.size)[0];
      if (biggest) {
        const key = `${future[0]}|materials`;
        const cur = biggest[1].cells.get(key) ?? { plan: 0, fact: null };
        biggest[1].cells.set(key, { plan: r2((cur.plan ?? 0) + minFuture + 120_000_000), fact: null });
      }
    }
    const ids: number[] = [];
    for (const [scope, sh] of sheets) {
      if (await tx.econCashSheet.findUnique({ where: { scope_year: { scope, year: YEAR } } })) continue;
      const sheet = await tx.econCashSheet.create({ data: { scope, directionId: sh.directionId, year: YEAR, opening: scope === ECON_CASH_COMPANY ? new Prisma.Decimal(opening) : null } });
      ids.push(sheet.id);
      await tx.econCashEntry.createMany({
        data: [...sh.cells].map(([key, c]) => {
          const [month, code] = key.split('|');
          return { sheetId: sheet.id, month, articleId: arts.get(code)!.id, plan: c.plan == null ? null : new Prisma.Decimal(c.plan), fact: c.fact == null ? null : new Prisma.Decimal(c.fact) };
        }),
      });
    }
    return ids;
  }

  /** Удаляет только созданное демо-загрузкой: центры затрат (с лимитами и фактом), ДДС и общие расходы демо-месяцев. */
  async clear(user: AuthUser, ip: string | null) {
    await this.assertAdmin(user);
    const m = await this.marker();
    if (!m) return { budgets: 0 };
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.econBudget.deleteMany({ where: { id: { in: m.budgetIds } } });
      if (m.cashSheetIds?.length) await tx.econCashSheet.deleteMany({ where: { id: { in: m.cashSheetIds } } });
      await tx.econCompanyFact.deleteMany({ where: { month: { in: m.companyMonths } } });
      for (const month of m.months) {
        const left = await tx.econBudgetMonth.count({ where: { month } });
        const company = await tx.econCompanyFact.count({ where: { month } });
        if (!left && !company) await tx.econMonth.deleteMany({ where: { month } });
      }
      await tx.appSetting.delete({ where: { key: DEMO_KEY } });
      await this.audit.write({ userId: user.id, action: 'DELETE', entity: 'econ_demo', entityId: 'demo', before: m, comment: `Удалены демо-данные экономики: центров затрат ${removed.count}`, ip }, tx);
      return { budgets: removed.count };
    });
  }

  async hasDemo() {
    return !!(await this.marker());
  }
}
