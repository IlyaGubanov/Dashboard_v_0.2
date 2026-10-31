import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ECON_CASH_COMPANY,
  econCashScope,
  econLimitValue,
  econMonthEnd,
  econNet,
  econYearMonths,
  type EconCashHints,
  type EconCashSave,
  type EconCashSheet,
  type EconCashView,
} from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';
import { econCoveredSites } from './coverage';
import { EconomicsService } from './economics.service';

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const dec = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v));
const add = (rec: Record<string, number>, key: string | number, v: number) => (rec[key] = r2((rec[key] ?? 0) + v));

type SheetRecord = Prisma.EconCashSheetGetPayload<{ include: { entries: true } }>;

/** Движение денежных средств (часть 3 таблицы ПЭО): план и факт по месяцам, с НДС. */
@Injectable()
export class EconomicsCashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
    private readonly econ: EconomicsService,
  ) {}

  /** Доступные таблицы: направления пользователя; «общие по компании» — только тем, кто видит все направления. */
  private async scopes(user: AuthUser, edit = false) {
    const p = await this.access.assertEconomics(user, edit);
    const dirs = await this.prisma.direction.findMany({
      where: { isActive: true, ...(p.directionIds ? { id: { in: p.directionIds } } : {}) },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, shortName: true },
    });
    const list = [...dirs.map((d) => ({ scope: econCashScope(d.id), directionId: d.id as number | null, code: d.code, title: d.shortName }))];
    if (!p.directionIds) list.push({ scope: ECON_CASH_COMPANY, directionId: null, code: '', title: 'Общие по компании' });
    return list;
  }

  async view(user: AuthUser, year: number): Promise<EconCashView> {
    const scopes = await this.scopes(user);
    const months = econYearMonths(year);
    const [articles, sheets, statuses] = await Promise.all([
      this.prisma.econCashArticle.findMany({ orderBy: [{ kind: 'asc' }, { sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.econCashSheet.findMany({ where: { year, scope: { in: scopes.map((s) => s.scope) } }, include: { entries: true } }),
      this.prisma.econMonth.findMany({ where: { month: { in: months } } }),
    ]);
    const users = await this.userNames(sheets.map((s) => s.updatedById));
    return {
      year,
      articles: articles.map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind, sort: a.sort, isArchived: a.isArchived })),
      scopes: scopes.map(({ scope, directionId, title }) => ({ scope, directionId, title })),
      sheets: scopes.map((s) => sheetView(sheets.find((x) => x.scope === s.scope), s.scope, s.directionId, year, users)),
      monthStatus: Object.fromEntries(statuses.map((m) => [m.month, m.status])),
      hints: await this.hints(scopes, year, articles),
    };
  }

  private async userNames(ids: (number | null)[]) {
    const list = [...new Set(ids.filter((v): v is number => v != null))];
    const users = list.length ? await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  /**
   * Подсказки для ввода и анализа: оплата заказчика из дашборда по месяцам, факт расходов ПЭО с НДС,
   * лимиты центров затрат с НДС, дебиторская задолженность (КС-2 − оплачено).
   */
  private async hints(scopes: { scope: string; directionId: number | null }[], year: number, articles: { id: number; code: string; kind: string }[]): Promise<Record<string, EconCashHints>> {
    const vat = (await this.econ.settings()).vatRate;
    const k = 1 + vat / 100;
    const cashByCode = new Map(articles.filter((a) => a.kind === 'OUT').map((a) => [a.code, a.id]));
    const months = econYearMonths(year);
    const today = new Date().toISOString().slice(0, 10);
    const out: Record<string, EconCashHints> = {};
    const dirIds = scopes.map((s) => s.directionId).filter((x): x is number => x != null);
    const costCodes = new Map((await this.prisma.econArticle.findMany({ select: { id: true, code: true } })).map((a) => [a.id, a.code]));
    const [facts, company, budgets, sites] = await Promise.all([
      this.prisma.econFact.findMany({
        where: { row: { month: { in: months }, budget: { directionId: { in: dirIds } } } },
        select: { amount: true, article: { select: { code: true } }, row: { select: { month: true, budget: { select: { directionId: true, vatExempt: true } } } } },
      }),
      this.prisma.econCompanyFact.findMany({ where: { month: { in: months } }, select: { month: true, amount: true, article: { select: { code: true } } } }),
      this.prisma.econBudget.findMany({ where: { directionId: { in: dirIds }, isArchived: false }, include: { limits: true } }),
      this.prisma.site.findMany({ where: { directionId: { in: dirIds }, isArchived: false }, select: { id: true, directionId: true, sectionId: true } }),
    ]);
    for (const s of scopes) {
      const h: EconCashHints = { paid: {}, costs: {}, limits: {}, receivable: null };
      out[s.scope] = h;
      if (s.directionId == null) {
        for (const c of company) {
          const id = cashByCode.get(c.article.code);
          if (id) add((h.costs[c.month] ??= {}), id, Number(c.amount) * k);
        }
        continue;
      }
      for (const f of facts.filter((x) => x.row.budget.directionId === s.directionId)) {
        const id = cashByCode.get(f.article.code);
        if (id) add((h.costs[f.row.month] ??= {}), id, Number(f.amount) * (f.row.budget.vatExempt ? 1 : k));
      }
      // оплата заказчика: разница нарастающих итогов «оплачено» по всем объектам направления на концы месяцев
      const paidAt = async (date: string | undefined) => {
        const money = await this.kpi.siteMoney(s.directionId!, date);
        const v = [...money.values()].map((x) => x.paid).filter((x): x is number => x != null);
        return v.length ? v.reduce((a, x) => a + x, 0) : null;
      };
      const ends = [`${year - 1}-12`, ...months].map((m) => econMonthEnd(m)).filter((d) => d < today || d.slice(0, 7) === today.slice(0, 7));
      let prev: number | null = null;
      for (const [i, end] of ends.entries()) {
        const cur = await paidAt(end >= today ? undefined : end);
        if (i > 0 && cur != null && prev != null && cur - prev > 0) h.paid[end.slice(0, 7)] = r2(cur - prev);
        prev = cur;
      }
      const latest = await this.kpi.siteMoney(s.directionId);
      const pairs = [...latest.values()].filter((x) => x.closed != null && x.paid != null);
      h.receivable = pairs.length ? r2(pairs.reduce((a, x) => a + x.closed! - x.paid!, 0)) : null;
      // лимиты центров затрат направления (с НДС) — база для плана выплат
      const own = budgets.filter((b) => b.directionId === s.directionId);
      const dirSites = sites.filter((x) => x.directionId === s.directionId);
      for (const b of own) {
        const covered = econCoveredSites(b, own, dirSites);
        const gross = covered.map((x) => latest.get(x.id)?.portfolio).filter((x): x is number => x != null);
        const costBase = b.costNet != null ? Number(b.costNet) : econNet(gross.length ? gross.reduce((a, x) => a + x, 0) : null, vat, b.vatExempt);
        for (const l of b.limits) {
          const code = costCodes.get(l.articleId);
          const id = code ? cashByCode.get(code) : undefined;
          const v = econLimitValue({ method: l.method, sharePct: num(l.sharePct), amount: num(l.amount) }, costBase);
          if (id && v != null) add(h.limits, id, v * (b.vatExempt ? 1 : k));
        }
      }
    }
    return out;
  }

  async save(user: AuthUser, year: number, scope: string, input: EconCashSave, ip: string | null) {
    const scopes = await this.scopes(user, true);
    const s = scopes.find((x) => x.scope === scope);
    if (!s) throw new NotFoundException('Таблица ДДС не найдена или недоступна');
    const months = new Set(econYearMonths(year));
    const bad = input.entries.find((e) => !months.has(e.month));
    if (bad) throw new BadRequestException(`Месяц ${bad.month} не относится к ${year} году`);
    const articleIds = new Set((await this.prisma.econCashArticle.findMany({ select: { id: true } })).map((a) => a.id));
    const unknown = input.entries.find((e) => !articleIds.has(e.articleId));
    if (unknown) throw new BadRequestException(`Статья ДДС №${unknown.articleId} не найдена`);
    const closed = new Map((await this.prisma.econMonth.findMany({ where: { month: { in: [...months] }, status: { not: 'OPEN' } } })).map((m) => [m.month, m.status]));

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.econCashSheet.findUnique({ where: { scope_year: { scope, year } }, include: { entries: true } });
      // закрытый месяц не правится: значения за него должны совпасть с сохранёнными
      const key = (m: string, a: number) => `${m}:${a}`;
      const old = new Map((before?.entries ?? []).map((e) => [key(e.month, e.articleId), { plan: num(e.plan), fact: num(e.fact) }]));
      const next = new Map(input.entries.filter((e) => e.plan != null || e.fact != null).map((e) => [key(e.month, e.articleId), { plan: e.plan, fact: e.fact }]));
      for (const k of new Set([...old.keys(), ...next.keys()])) {
        const month = k.slice(0, 7);
        if (!closed.has(month)) continue;
        const a = old.get(k), b = next.get(k);
        if ((a?.plan ?? null) !== (b?.plan ?? null) || (a?.fact ?? null) !== (b?.fact ?? null))
          throw new ForbiddenException(`Месяц ${month} ${closed.get(month) === 'LOCKED' ? 'заблокирован администратором' : 'закрыт'} — его план и факт ДДС не меняются`);
      }
      const opening = scope === ECON_CASH_COMPANY ? dec(input.opening ?? null) : null;
      let sheet: { id: number };
      if (input.version === 0) {
        if (before) throw new ConflictException('Таблицу ДДС уже создал другой пользователь. Обновите страницу и повторите правку.');
        sheet = await tx.econCashSheet.create({ data: { scope, directionId: s.directionId, year, opening, updatedById: user.id } });
      } else {
        const changed = await tx.econCashSheet.updateMany({ where: { scope, year, version: input.version }, data: { opening, updatedById: user.id, version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('Таблицу ДДС изменил другой пользователь. Обновите страницу и повторите правку.');
        sheet = before!;
        await tx.econCashEntry.deleteMany({ where: { sheetId: sheet.id } });
      }
      const rows = input.entries.filter((e) => e.plan != null || e.fact != null);
      if (rows.length) await tx.econCashEntry.createMany({ data: rows.map((e) => ({ sheetId: sheet.id, month: e.month, articleId: e.articleId, plan: dec(e.plan), fact: dec(e.fact) })) });
      const after = await tx.econCashSheet.findUniqueOrThrow({ where: { id: sheet.id }, include: { entries: true } });
      await this.audit.write(
        { userId: user.id, action: before ? 'UPDATE' : 'CREATE', entity: 'econ_cash', entityId: `${scope}:${year}`, directionId: s.directionId, before: before ? summary(before) : null, after: summary(after), comment: input.comment || `ДДС ${s.title}, ${year}`, ip },
        tx,
      );
      return { version: after.version };
    });
  }
}

function sheetView(r: SheetRecord | undefined, scope: string, directionId: number | null, year: number, users: Map<number, string>): EconCashSheet {
  return {
    scope,
    directionId,
    year,
    opening: num(r?.opening),
    version: r?.version ?? 0,
    updatedAt: r?.updatedAt.toISOString() ?? null,
    updatedBy: r?.updatedById ? (users.get(r.updatedById) ?? null) : null,
    entries: (r?.entries ?? []).map((e) => ({ month: e.month, articleId: e.articleId, plan: num(e.plan), fact: num(e.fact) })),
  };
}

/** Для журнала: остаток и значения «месяц:статья → план/факт». */
function summary(r: SheetRecord) {
  return { opening: num(r.opening), entries: Object.fromEntries(r.entries.map((e) => [`${e.month}:${e.articleId}`, [num(e.plan), num(e.fact)]])) };
}
