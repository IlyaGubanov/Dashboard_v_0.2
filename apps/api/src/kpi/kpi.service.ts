import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DirectionKpi, DynamicsPoint, Overview, PeopleView, PeriodItem, SiteCard, SiteKpiRow, TrackersView, WorkGrid } from '@mvs/shared';
import { buildSiteCard } from './site-card';
import { peopleView, trackersView, workGrid } from './views';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../common/request';
import { directionKpi, dynamics, hasFactAt, mainProgram, calcSite, toRow, type DirectionResult } from './engine';
import { objectReportPeriods, reportPrograms } from './report-programs';
import { loadDirection, loadPeriods } from './loader';
import { isoDate, parseDate, type KPeriod } from './model';
import { cardNoFinance, kpiNoFinance, pointNoFinance, rowNoFinance } from './finance';

/** Сколько живёт рассчитанный срез. Изменения данных сбрасывают кэш направления сразу (invalidate). */
const CACHE_MS = 60_000;

@Injectable()
export class KpiService {
  private cache = new Map<string, { at: number; value: Promise<DirectionResult> }>();
  private history = new Map<string, { at: number; value: ReturnType<KpiService['prepare']> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** Сбросить рассчитанные показатели направления (вызывать после любой записи данных). */
  invalidate(directionId: number) {
    for (const k of this.cache.keys()) if (k.startsWith(`${directionId}|`)) this.cache.delete(k);
    for (const k of this.history.keys()) if (k.startsWith(`${directionId}|`)) this.history.delete(k);
  }

  async overview(user: AuthUser): Promise<Overview> {
    this.access.assertSection(user, 'overview');
    const dirs = await this.prisma.direction.findMany({
      // РЭБ имеет собственные показатели; технику нельзя считать строительными объектами и готовностью работ.
      where: { isActive: true, code: { not: 'reb' }, ...(user.globalRole === 'USER' ? { members: { some: { userId: user.id } } } : {}) },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      include: { members: { where: { role: 'CURATOR' }, include: { user: { select: { id: true, fullName: true } } } } },
    });
    const thresholds = await this.thresholds();
    const directions = await Promise.all(
      dirs.map(async (d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        shortName: d.shortName,
        icon: d.icon,
        color: d.color,
        isReadonly: d.isReadonly,
        curators: d.members.map((m) => m.user),
        kpi: this.forUser(user, (await this.result(d.id, undefined, thresholds)).kpi),
      })),
    );
    return { thresholds, directions };
  }

  async kpi(user: AuthUser, code: string, date?: string): Promise<DirectionKpi> {
    const id = await this.directionId(user, code);
    return this.forUser(user, (await this.result(id, date, await this.thresholds())).kpi);
  }

  /** Показатели с учётом ограничений сотрудника: без денег и без списка замечаний, если они ему скрыты. */
  private forUser(user: AuthUser, k: DirectionKpi): DirectionKpi {
    const r = this.access.has(user, 'finance') ? k : kpiNoFinance(k);
    return this.access.canSee(user, 'remarks') ? r : { ...r, kpis:r.kpis.filter(m=>m.key!=='remarksTotal'), remarks: undefined, reportPrograms: r.reportPrograms?.map(p => ({ ...p, aggregate: p.aggregate ? { ...p.aggregate, violations: [] } : p.aggregate, rows: p.rows.map(s => ({ ...s, remarksCount: undefined })) })) };
  }

  async sites(user: AuthUser, code: string, date?: string): Promise<SiteKpiRow[]> {
    const id = await this.directionId(user, code);
    const rows = (await this.result(id, date, await this.thresholds())).rows;
    return this.access.has(user, 'finance') ? rows : rows.map(rowNoFinance);
  }

  async periods(user: AuthUser, code: string): Promise<PeriodItem[]> {
    const id = await this.directionId(user, code);
    return (await loadPeriods(this.prisma, id))
      .reverse()
      .map((p) => ({ id: p.id, date: isoDate(p.date), program: p.program, label: p.label, status: p.status }));
  }

  /**
   * Объекты направления на последний срез (как в реестре): стоимость, КС-2 и оплата с НДС, готовность 0…1.
   * Используется «Экономикой». Права проверяет вызывающий.
   */
  async siteMoney(directionId: number): Promise<Map<number, { portfolio: number | null; closed: number | null; paid: number | null; fact: number | null }>> {
    const rows = (await this.result(directionId, undefined, await this.thresholds())).rows;
    return new Map(rows.map((r) => [r.id, { ...r.money, fact: r.fact == null ? null : Math.min(1, Math.max(0, r.fact)) }]));
  }

  private async directionId(user: AuthUser, code: string) {
    const d = await this.prisma.direction.findUnique({ where: { code }, select: { id: true } });
    if (!d) throw new NotFoundException('Направление не найдено');
    await this.access.assertViewDirection(user, d.id);
    return d.id;
  }

  private async thresholds() {
    const s = await this.prisma.appSetting.findUnique({ where: { key: 'overview.thresholds' } });
    const v = (s?.value ?? {}) as { warn?: number; crit?: number };
    return { warn: v.warn ?? -2, crit: v.crit ?? -10 };
  }

  private result(directionId: number, date: string | undefined, thr: { warn: number; crit: number }) {
    const key = `${directionId}|${date ?? 'last'}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = this.compute(directionId, date, thr);
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => this.cache.delete(key));
    return value;
  }

  /**
   * Данные направления до даты среза. Для недель и дней нужен весь факт до даты (берётся последняя запись);
   * для отчётов — только нужные листы, а с history = true — все листы основной программы (для динамики).
   */
  private async prepare(directionId: number, date: string | undefined, history: boolean) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Дата в формате ГГГГ-ММ-ДД');
    const periods = await loadPeriods(this.prisma, directionId);
    const until = date ? parseDate(date) : Infinity;
    const meta = await this.prisma.direction.findUniqueOrThrow({ where: { id: directionId }, select: { periodKind: true, settings: true } });
    const settings = (meta.settings ?? {}) as { programs?: Record<string, string> };
    const program = mainProgram({ periodKind: meta.periodKind, settings } as Parameters<typeof mainProgram>[0]);
    const own = periods.filter((p) => p.program === program && p.date <= until);
    const period = own.at(-1) ?? null;
    const prev = own.at(-2) ?? null;
    const needed =
      meta.periodKind === 'REPORT' && !history
        ? [period, prev, ...this.otherProgramLatest(periods, program, until)].filter((p): p is KPeriod => !!p).map((p) => p.id)
        : (meta.periodKind === 'REPORT' ? periods.filter(p => p.date <= until) : own).map((p) => p.id);
    const dir = await loadDirection(this.prisma, directionId, periods, needed);
    return { dir, own, period, prev, periods, program, until, kind: meta.periodKind, settings };
  }

  /** Полные данные направления (вся история до даты) — для динамики и карточек объектов. */
  private full(directionId: number, date: string | undefined) {
    const key = `${directionId}|full|${date ?? 'last'}`;
    const hit = this.history.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = this.prepare(directionId, date, true);
    this.history.set(key, { at: Date.now(), value });
    value.catch(() => this.history.delete(key));
    return value;
  }

  async dynamics(user: AuthUser, code: string, date?: string): Promise<DynamicsPoint[]> {
    this.access.assertSection(user, 'dynamics');
    const id = await this.directionId(user, code);
    const f = await this.full(id, date);
    const points = dynamics(f.dir, f.own);
    return this.access.has(user, 'finance') ? points : points.map(pointNoFinance);
  }

  async grid(user: AuthUser, code: string, date?: string): Promise<WorkGrid> {
    // одни данные на две вкладки: «Матрица» и «График работ»
    if (!this.access.canSee(user, 'matrix')) this.access.assertSection(user, 'schedule');
    const id = await this.directionId(user, code);
    const f = await this.full(id, date);
    return workGrid(this.prisma, f.dir, f.period);
  }

  async trackers(user: AuthUser, code: string): Promise<TrackersView> {
    this.access.assertSection(user, 'trackers');
    return trackersView(this.prisma, await this.directionId(user, code));
  }

  async people(user: AuthUser, code: string): Promise<PeopleView> {
    this.access.assertSection(user, 'people');
    const id = await this.directionId(user, code);
    return peopleView(this.prisma, id, (await this.full(id, undefined)).own);
  }

  async siteCard(user: AuthUser, code: string, siteId: number, date?: string): Promise<SiteCard> {
    const id = await this.directionId(user, code);
    const f = await this.full(id, date);
    const ks = f.dir.sites.find((s) => s.id === siteId);
    if (!ks) throw new NotFoundException('Объект не найден');
    const own = f.kind === 'REPORT' ? objectReportPeriods(f.dir, ks, f.until) : f.own;
    const card = await buildSiteCard(this.prisma, f.dir, ks, own.at(-1) ?? null, own);
    card.canEdit = !f.dir.isReadonly && (await this.access.canEditSite(user, siteId));
    card.canManage = await this.access.canManageDirection(user, id);
    return this.access.has(user, 'finance') ? card : cardNoFinance(card);
  }

  /** Срез на отчётную точку (последнюю не позже date) + предыдущая точка для динамики. */
  private async compute(directionId: number, date: string | undefined, thr: { warn: number; crit: number }): Promise<DirectionResult> {
    const { dir, period, prev, periods, program, until, kind: periodKind, settings } = await this.prepare(directionId, date, false);
    const meta = { periodKind };

    const res = directionKpi(dir, period, thr);
    if (prev && hasFactAt(dir, prev)) {
      const p = directionKpi(dir, prev, thr).kpi;
      res.kpi.prev = { asOf: p.asOf!, fact: p.fact, plan: p.plan };
    }
    if (meta.periodKind === 'REPORT') {
      res.kpi.reportPrograms = reportPrograms(dir, until);
      res.rows = dir.sites.map(s => { const p = objectReportPeriods(dir, s, until).at(-1); return p ? toRow(calcSite(dir, s, p, p.date)) : res.rows.find(r => r.id === s.id); }).filter((r): r is SiteKpiRow => !!r);
      const names = settings.programs ?? {};
      res.kpi.extra = this.otherProgramLatest(periods, program, until).map((p) => ({
        label: names[p.program] ?? p.program,
        sites: dir.sites.filter((s) => s.reports.some((r) => r.periodId === p.id)).length,
        asOf: isoDate(p.date),
      }));
    }
    return res;
  }

  private otherProgramLatest(periods: KPeriod[], program: string, until: number) {
    const last = new Map<string, KPeriod>();
    for (const p of periods) if (p.program !== program && p.date <= until) last.set(p.program, p);
    return [...last.values()];
  }
}
