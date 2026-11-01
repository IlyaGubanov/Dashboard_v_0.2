import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  econDeviation,
  econDeviationActive,
  econLimitValue,
  econPlanCost,
  econStatus,
  econStockStatus,
  parseRestrictions,
  type EconDeviationCreate,
  type EconDeviationItem,
  type EconDeviationRecord,
  type EconDeviationsView,
  type EconDeviationUpdate,
  type EconStockRow,
  type MyTask,
} from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';
import { EconomicsService } from './economics.service';
import { computeResults } from './results';

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const dec = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v));
const today = () => new Date().toISOString().slice(0, 10);

type Record_ = Prisma.EconDeviationGetPayload<{ include: { responsible: { select: { id: true; fullName: true } } } }>;

/**
 * Разбор отклонений (часть 4 таблицы ПЭО): на конец месяца находятся перерасходы прямых статей к плану на выполненный объём
 * (пороги −2% / −10%) и закупка материалов сверх потребности (больше чем в 1,5 раза). По каждому ПЭО заводит разбор:
 * причина, решение, ответственный и срок; ответственный видит его в «Моих задачах».
 */
@Injectable()
export class EconomicsDeviationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
    private readonly econ: EconomicsService,
  ) {}

  /** Отклонения и закупки на конец месяца по центрам затрат доступных направлений. */
  async detect(month: string, directionIds: number[] | null) {
    const vat = (await this.econ.settings()).vatRate;
    const dirFilter = directionIds ? { id: { in: directionIds } } : {};
    const [res, budgets, articles, rows, records] = await Promise.all([
      computeResults(this.prisma, this.kpi, month, vat),
      this.prisma.econBudget.findMany({ where: { isArchived: false, direction: { isActive: true, ...dirFilter } }, include: { limits: true } }),
      this.prisma.econArticle.findMany({ where: { kind: 'DIRECT' } }),
      this.prisma.econBudgetMonth.findMany({ where: { month: { lte: month }, budget: { isArchived: false, direction: { isActive: true, ...dirFilter } } }, include: { facts: true } }),
      this.prisma.econDeviation.findMany({ where: { budget: { direction: { isActive: true, ...dirFilter } } }, select: { id: true, budgetId: true, articleId: true, kind: true, status: true, month: true } }),
    ]);
    const materials = articles.find((a) => a.code === 'materials');
    const items: EconDeviationItem[] = [];
    const stock: EconStockRow[] = [];
    const recordFor = (budgetId: number, articleId: number, kind: 'OVERRUN' | 'STOCK') =>
      records.find((x) => x.budgetId === budgetId && x.articleId === articleId && x.kind === kind && (econDeviationActive(x.status) || x.month === month))?.id ?? null;
    for (const b of budgets) {
      const own = rows.filter((r) => r.budgetId === b.id);
      if (!own.length) continue;
      const r = res.results.get(b.id);
      const progress = r?.progress ?? null;
      const costBase = r?.costBase ?? null;
      const fact = (articleId: number) => own.reduce((a, row) => a + row.facts.filter((f) => f.articleId === articleId).reduce((s, f) => s + Number(f.amount), 0), 0);
      const limitOf = (articleId: number) => {
        const l = b.limits.find((x) => x.articleId === articleId);
        return l ? econLimitValue({ method: l.method, sharePct: num(l.sharePct), amount: num(l.amount) }, costBase) : null;
      };
      for (const a of articles) {
        const plan = econPlanCost(limitOf(a.id), progress);
        const f = r2(fact(a.id));
        if (plan == null || !f) continue;
        const d = econDeviation(plan, f);
        const status = econStatus(d.pct);
        if (status === 'warning' || status === 'critical') items.push({ budgetId: b.id, articleId: a.id, kind: 'OVERRUN', plan, fact: f, amount: d.amount, pct: d.pct, status, recordId: recordFor(b.id, a.id, 'OVERRUN') });
      }
      // закупка материалов к потребности на выполненный объём
      const purchased = r2(own.reduce((a, row) => a + Number(row.materialsPurchased ?? 0), 0));
      if (materials && own.some((row) => row.materialsPurchased != null)) {
        const need = econPlanCost(limitOf(materials.id), progress);
        const ratio = need ? purchased / need : null;
        const status = econStockStatus(ratio);
        stock.push({ budgetId: b.id, purchased, need, consumed: r2(fact(materials.id)), surplus: need == null ? null : r2(purchased - need), ratio, status });
        if (status === 'critical' && need)
          items.push({ budgetId: b.id, articleId: materials.id, kind: 'STOCK', plan: need, fact: purchased, amount: r2(need - purchased), pct: (need - purchased) / need, status, recordId: recordFor(b.id, materials.id, 'STOCK') });
      }
    }
    items.sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
    return { items, stock };
  }

  /** Кого можно назначить ответственным: администраторы, руководство, ответственные ПЭО и кураторы направления — у кого раздел не скрыт и финансы видны. */
  async responsibleCandidates(directionIds: number[]) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        canLogin: true,
        OR: [{ globalRole: { in: ['ADMIN', 'MANAGEMENT'] } }, { econEditor: { isNot: null } }, { memberships: { some: { role: 'CURATOR', directionId: { in: directionIds } } } }],
      },
      select: { id: true, fullName: true, globalRole: true, hiddenSections: true, deniedFeatures: true, econEditor: true, memberships: { where: { role: 'CURATOR' }, select: { directionId: true } } },
      orderBy: { fullName: 'asc' },
    });
    const allowed = users.filter((u) => {
      if (u.globalRole === 'ADMIN') return true;
      const r = parseRestrictions(u.hiddenSections, u.deniedFeatures);
      return !r.hiddenSections.includes('economics') && !r.deniedFeatures.includes('finance');
    });
    return Object.fromEntries(
      directionIds.map((d) => [
        String(d),
        allowed.filter((u) => u.globalRole !== 'USER' || u.econEditor || u.memberships.some((m) => m.directionId === d)).map((u) => ({ id: u.id, fullName: u.fullName })),
      ]),
    );
  }

  async view(user: AuthUser, month: string): Promise<EconDeviationsView> {
    const p = await this.access.assertEconomics(user);
    const dirs = await this.prisma.direction.findMany({ where: { isActive: true, ...(p.directionIds ? { id: { in: p.directionIds } } : {}) }, select: { id: true } });
    const ids = dirs.map((d) => d.id);
    const [found, records, candidates] = await Promise.all([
      this.detect(month, p.directionIds),
      this.prisma.econDeviation.findMany({ where: { budget: { directionId: { in: ids } } }, include: { responsible: { select: { id: true, fullName: true } } }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { id: 'desc' }] }),
      this.responsibleCandidates(ids),
    ]);
    const authors = await this.userNames(records.map((r) => r.createdById));
    return { month, ...found, records: records.map((r) => recordView(r, authors)), candidates, canEdit: p.canEdit, userId: user.id };
  }

  private async userNames(ids: (number | null)[]) {
    const list = [...new Set(ids.filter((v): v is number => v != null))];
    const users = list.length ? await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private async budgetInScope(user: AuthUser, budgetId: number, edit: boolean) {
    const p = await this.access.assertEconomics(user, edit);
    const b = await this.prisma.econBudget.findUnique({ where: { id: budgetId }, include: { direction: { select: { isActive: true } } } });
    if (!b || !b.direction.isActive || (p.directionIds && !p.directionIds.includes(b.directionId))) throw new NotFoundException('Центр затрат не найден');
    return { b, p };
  }

  private async assertResponsible(directionId: number, responsibleId: number) {
    const list = (await this.responsibleCandidates([directionId]))[String(directionId)] ?? [];
    if (!list.some((u) => u.id === responsibleId))
      throw new BadRequestException({ message: 'Ответственным можно назначить руководство, ответственных ПЭО или куратора направления', fields: { responsibleId: 'Выберите из списка' } });
  }

  async create(user: AuthUser, input: EconDeviationCreate, ip: string | null) {
    const { b } = await this.budgetInScope(user, input.budgetId, true);
    await this.assertResponsible(b.directionId, input.responsibleId);
    const article = await this.prisma.econArticle.findUnique({ where: { id: input.articleId } });
    if (!article || article.kind !== 'DIRECT') throw new BadRequestException('Разбор заводится по прямой статье расходов');
    if (input.kind === 'STOCK' && article.code !== 'materials') throw new BadRequestException('Закупка сверх потребности — только по статье «Материалы»');
    // цифры отклонения — из расчёта на этот месяц (не с клиента)
    const found = (await this.detect(input.month, [b.directionId])).items.find((x) => x.budgetId === b.id && x.articleId === input.articleId && x.kind === input.kind);
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.econDeviation.findFirst({ where: { budgetId: b.id, articleId: input.articleId, kind: input.kind, status: { in: ['OPEN', 'IN_WORK'] } } });
      if (active) throw new ConflictException('По этому отклонению уже есть незакрытый разбор. Обновите страницу.');
      const r = await tx.econDeviation.create({
        data: {
          budgetId: b.id,
          articleId: input.articleId,
          kind: input.kind,
          month: input.month,
          plan: dec(found?.plan),
          fact: dec(found?.fact),
          amount: dec(found?.amount),
          pct: found?.pct == null ? null : new Prisma.Decimal(Math.round(found.pct * 10000) / 10000),
          cause: input.cause,
          causeText: input.causeText?.trim() || null,
          decision: input.decision,
          decisionText: input.decisionText?.trim() || null,
          responsibleId: input.responsibleId,
          dueDate: new Date(`${input.dueDate}T00:00:00Z`),
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'econ_deviation', entityId: r.id, directionId: b.directionId, siteId: b.siteId, after: plain(r), comment: `Разбор отклонения за ${input.month}`, ip }, tx);
      return { id: r.id };
    });
  }

  /** ПЭО меняет всё; ответственный — только статус и итог. */
  async update(user: AuthUser, id: number, input: EconDeviationUpdate, ip: string | null) {
    const p = await this.access.assertEconomics(user);
    const before = await this.prisma.econDeviation.findUnique({ where: { id }, include: { budget: { select: { directionId: true, siteId: true, direction: { select: { isActive: true } } } } } });
    if (!before || !before.budget.direction.isActive || (p.directionIds && !p.directionIds.includes(before.budget.directionId))) throw new NotFoundException('Разбор не найден');
    const responsible = before.responsibleId === user.id;
    if (!p.canEdit && !responsible) throw new ForbiddenException('Менять разбор могут ответственные ПЭО и назначенный ответственный');
    const full = p.canEdit;
    if (!full && (input.cause || input.decision || input.responsibleId || input.dueDate || input.causeText !== undefined || input.decisionText !== undefined))
      throw new ForbiddenException('Ответственный меняет только статус и итог');
    if (full && input.responsibleId && input.responsibleId !== before.responsibleId) await this.assertResponsible(before.budget.directionId, input.responsibleId);
    const closing = input.status === 'RESOLVED' || input.status === 'DISMISSED';
    if (input.status === 'DISMISSED' && !full) throw new ForbiddenException('Снять разбор могут ответственные ПЭО');
    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.EconDeviationUpdateManyMutationInput = {
        status: input.status,
        result: input.result?.trim() || null,
        closedAt: closing ? (before.closedAt ?? new Date()) : null,
        updatedById: user.id,
        version: { increment: 1 },
        ...(full
          ? {
              ...(input.cause ? { cause: input.cause } : {}),
              ...(input.causeText !== undefined ? { causeText: input.causeText?.trim() || null } : {}),
              ...(input.decision ? { decision: input.decision } : {}),
              ...(input.decisionText !== undefined ? { decisionText: input.decisionText?.trim() || null } : {}),
              ...(input.dueDate ? { dueDate: new Date(`${input.dueDate}T00:00:00Z`) } : {}),
            }
          : {}),
      };
      const changed = await tx.econDeviation.updateMany({ where: { id, version: input.version }, data });
      if (!changed.count) throw new ConflictException('Разбор изменил другой пользователь. Обновите страницу и повторите правку.');
      if (full && input.responsibleId) await tx.econDeviation.update({ where: { id }, data: { responsibleId: input.responsibleId } });
      const after = await tx.econDeviation.findUniqueOrThrow({ where: { id } });
      await this.audit.write(
        { userId: user.id, action: 'UPDATE', entity: 'econ_deviation', entityId: id, directionId: before.budget.directionId, siteId: before.budget.siteId, before: plain(before), after: plain(after), comment: `Разбор: ${input.status}`, ip },
        tx,
      );
      return { id, version: after.version };
    });
  }

  /**
   * Задачи для «Моих задач»: ответственному — его незакрытые разборы (просроченные — красным);
   * ответственным ПЭО — найденные отклонения без разбора за последний месяц с фактом.
   */
  async tasks(user: AuthUser): Promise<MyTask[]> {
    const p = await this.access.economicsPermissions(user);
    if (!p.canView) return [];
    const out: MyTask[] = [];
    const mine = await this.prisma.econDeviation.findMany({ where: { responsibleId: user.id, status: { in: ['OPEN', 'IN_WORK'] } }, select: { dueDate: true } });
    if (mine.length) {
      const overdue = mine.filter((r) => r.dueDate && r.dueDate.toISOString().slice(0, 10) < today()).length;
      out.push({
        key: 'econ:mine',
        kind: 'econDeviation',
        direction: { code: 'economics', shortName: 'Экономика' },
        title: `Отклонения на вас: ${mine.length}`,
        detail: overdue ? `просрочено: ${overdue}` : 'выполнить решение и отметить итог',
        count: mine.length,
        level: overdue ? 'critical' : 'warning',
        tab: 'economics',
      });
    }
    if (p.canEdit && user.globalRole !== 'ADMIN') {
      const last = await this.prisma.econBudgetMonth.findFirst({ orderBy: { month: 'desc' }, select: { month: true } });
      if (last) {
        const n = (await this.detect(last.month, p.directionIds)).items.filter((x) => x.recordId == null).length;
        if (n)
          out.push({
            key: 'econ:review',
            kind: 'econReview',
            direction: { code: 'economics', shortName: 'Экономика' },
            title: `Разобрать отклонения: ${n}`,
            detail: `перерасход выше порога на ${last.month.split('-').reverse().join('.')} — причина, решение, ответственный`,
            count: n,
            level: 'warning',
            tab: 'economics',
          });
      }
    }
    return out;
  }
}

function recordView(r: Record_, authors: Map<number, string>): EconDeviationRecord {
  const due = r.dueDate?.toISOString().slice(0, 10) ?? null;
  return {
    id: r.id,
    budgetId: r.budgetId,
    articleId: r.articleId,
    kind: r.kind,
    month: r.month,
    plan: num(r.plan),
    fact: num(r.fact),
    amount: num(r.amount),
    pct: num(r.pct),
    cause: r.cause,
    causeText: r.causeText,
    decision: r.decision,
    decisionText: r.decisionText,
    responsible: r.responsible,
    dueDate: due,
    status: r.status,
    result: r.result,
    version: r.version,
    createdBy: r.createdById ? (authors.get(r.createdById) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
    overdue: econDeviationActive(r.status) && !!due && due < today(),
  };
}

const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Prisma.Decimal ? Number(x) : x)));
