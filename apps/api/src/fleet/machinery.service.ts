import { Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { MACHINERY_STATUS, type MachineryRow, type MachineryStatus, type MachineryView } from '@mvs/shared';
import { CurrentUser } from '../auth/decorators';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../common/request';
import { KpiService } from '../kpi/kpi.service';
import { PrismaService } from '../prisma/prisma.service';
import { countByKind, reconcile } from './machinery-domain';

const day = (d: Date) => d.toISOString().slice(0, 10);
const emptySummary = () => Object.fromEntries(Object.keys(MACHINERY_STATUS).map((k) => [k, 0])) as Record<MachineryStatus, number>;

/** Сверка техники: ответственный за объект (отчёт) против распределения РЭБ на дату среза направления. */
@Injectable()
export class MachineryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
  ) {}

  /** Сверка одного направления на дату; доступ к направлению проверяет kpi.sites. */
  async direction(user: AuthUser, code: string, date?: string): Promise<MachineryView> {
    const registry = await this.prisma.fleetRegistry.findUnique({ where: { code: 'reb' }, select: { id: true } });
    const rights = await this.access.machineryAccess(user, registry?.id ?? null);
    const [sites, kpi, dir] = await Promise.all([
      this.kpi.sites(user, code, date),
      this.kpi.kpi(user, code, date),
      this.prisma.direction.findUnique({ where: { code }, select: { id: true, shortName: true } }),
    ]);
    if (!dir) throw new NotFoundException('Направление не найдено');
    const asOf = kpi.asOf;
    const at = new Date(`${asOf ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const siteIds = sites.map((s) => s.id);
    const period = kpi.periodId ? await this.prisma.reportingPeriod.findUnique({ where: { id: kpi.periodId }, select: { program: true } }) : null;

    const [reports, assignments, withoutSite] = await Promise.all([
      this.prisma.siteReport.findMany({
        where: { siteId: { in: siteIds }, period: { date: { lte: at }, ...(period ? { program: period.program } : {}) } },
        orderBy: { period: { date: 'desc' } },
        include: {
          period: { select: { date: true } },
          machinery: { orderBy: { kind: 'asc' } },
          enteredBy: { select: { fullName: true } },
          updatedBy: { select: { fullName: true } },
        },
      }),
      rights.counts
        ? this.prisma.fleetAssignment.findMany({
            where: {
              isArchived: false,
              targetDirectionId: dir.id,
              siteId: { in: siteIds },
              startDate: { lte: at },
              OR: [{ endDate: null }, { endDate: { gt: at } }],
              vehicle: { isArchived: false },
            },
            include: { vehicle: true, updatedBy: { select: { fullName: true } }, createdBy: { select: { fullName: true } } },
          })
        : Promise.resolve([]),
      rights.counts
        ? this.prisma.fleetAssignment.count({
            where: { isArchived: false, targetDirectionId: dir.id, siteId: null, startDate: { lte: at }, OR: [{ endDate: null }, { endDate: { gt: at } }], vehicle: { isArchived: false } },
          })
        : Promise.resolve(0),
    ]);

    const lastReport = new Map<number, (typeof reports)[number]>();
    for (const r of reports) if (!lastReport.has(r.siteId)) lastReport.set(r.siteId, r);

    const summary = emptySummary();
    const rows: MachineryRow[] = sites.map((s) => {
      const report = lastReport.get(s.id);
      const own = assignments.filter((a) => a.siteId === s.id);
      const byKind = report?.machinery.length ? report.machinery.map((l) => ({ kind: l.kind, qty: l.qty })) : null;
      const fleetByKind = countByKind(own.map((a) => a.vehicle.kind));
      const { status, kinds } = reconcile(s.tech, byKind, fleetByKind);
      if (rights.counts) summary[status]++;
      const latest = own.reduce<Date | null>((m, a) => (!m || a.updatedAt > m ? a.updatedAt : m), null);
      return {
        siteId: s.id,
        siteName: s.shortName,
        direction: { code, shortName: dir.shortName },
        status: rights.counts ? status : null,
        reported: {
          total: s.tech,
          byKind,
          by: rights.names ? (report?.updatedBy?.fullName ?? report?.enteredBy?.fullName ?? null) : null,
          at: report ? report.updatedAt.toISOString() : null,
          from: report ? day(report.period.date) : null,
        },
        fleet: rights.counts
          ? {
              total: own.length,
              byKind: fleetByKind,
              by: rights.names ? [...new Set(own.map((a) => a.updatedBy?.fullName ?? a.createdBy?.fullName).filter((n): n is string => !!n))] : [],
              at: latest ? latest.toISOString() : null,
              vehicles: rights.vehicles
                ? own
                    .map(({ vehicle: v }) => ({ id: v.id, name: v.name, kind: v.kind, category: v.category, plate: v.plate, inventoryNumber: v.inventoryNumber, technicalState: v.technicalState, ownership: v.ownership }))
                    .sort((a, b) => a.kind.localeCompare(b.kind, 'ru') || a.name.localeCompare(b.name, 'ru'))
                : null,
            }
          : null,
        kinds: rights.counts ? kinds : [],
      };
    });
    return { asOf, rows, summary, fleetWithoutSite: withoutSite };
  }

  /** Сверка по всем доступным направлениям — раздел РЭБ; объекты без данных с обеих сторон не показываются. */
  async all(user: AuthUser): Promise<MachineryView> {
    this.access.assertSection(user, 'fleet');
    const registry = await this.prisma.fleetRegistry.findUnique({ where: { code: 'reb' }, select: { id: true } });
    if (!registry) throw new NotFoundException('Раздел РЭБ не настроен');
    await this.access.assertViewFleet(user, registry.id);
    const dirs = await this.prisma.direction.findMany({
      where: { isActive: true, code: { not: 'reb' }, ...(user.globalRole === 'USER' ? { members: { some: { userId: user.id } } } : {}) },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: { code: true },
    });
    const views = await Promise.all(dirs.map((d) => this.direction(user, d.code)));
    const summary = emptySummary();
    for (const v of views) for (const k of Object.keys(summary) as MachineryStatus[]) summary[k] += v.summary[k];
    return {
      asOf: null,
      rows: views.flatMap((v) => v.rows).filter((r) => r.status !== 'none'),
      summary,
      fleetWithoutSite: views.reduce((a, v) => a + v.fleetWithoutSite, 0),
    };
  }
}

@Controller()
export class MachineryController {
  constructor(private readonly machinery: MachineryService) {}

  /** Техника направления по объектам: кто что внёс и где не сходится. */
  @Get('directions/:code/machinery')
  direction(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query('date') date?: string): Promise<MachineryView> {
    return this.machinery.direction(user, code, date);
  }

  /** Сверка по всем направлениям (объявлена раньше маршрута fleet/:kind). */
  @Get(['fleet/reconciliation', 'directions/reb/fleet/reconciliation'])
  all(@CurrentUser() user: AuthUser): Promise<MachineryView> {
    return this.machinery.all(user);
  }
}
