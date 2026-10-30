/**
 * Подрядчики по всем направлениям: сводный список (объекты, отстающие) и добавление подрядчика сразу в несколько направлений.
 * Справочник организаций остаётся своим у каждого направления — здесь записи одной организации собираются вместе:
 * по ИНН, а без ИНН — по названию без кавычек, регистра и лишних пробелов.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { ContractorCreateData, ContractorKind, ContractorRow, ContractorsView } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';

const normName = (s: string) => s.toLowerCase().replace(/["«»'“”]/g, '').replace(/\s+/g, ' ').trim();
const keyOf = (o: { name: string; inn: string | null }) => (o.inn ? `inn:${o.inn}` : `name:${normName(o.name)}`);

@Injectable()
export class ContractorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
  ) {}

  private viewable(user: AuthUser) {
    return this.prisma.direction.findMany({
      where: { isActive: true, ...(user.globalRole === 'USER' ? { members: { some: { userId: user.id } } } : {}) },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, shortName: true, color: true },
    });
  }

  async list(user: AuthUser): Promise<ContractorsView> {
    this.access.assertSection(user, 'contractors');
    const dirs = await this.viewable(user);
    const [orgs, sites, manage] = await Promise.all([
      this.prisma.organization.findMany({
        where: { directionId: { in: dirs.map((d) => d.id) }, kind: { in: ['CONTRACTOR', 'SUBCONTRACTOR'] } },
        orderBy: { name: 'asc' },
      }),
      Promise.all(dirs.map((d) => this.kpi.sites(user, d.code))),
      Promise.all(dirs.map((d) => this.access.canManageDirection(user, d.id))),
    ]);

    const rows = new Map<string, ContractorRow>();
    const byOrg = new Map<number, ContractorRow>();
    for (const o of orgs) {
      const k = keyOf(o);
      const d = dirs.find((x) => x.id === o.directionId)!;
      let r = rows.get(k);
      if (!r) rows.set(k, (r = { key: k, name: o.name, inn: o.inn, kinds: [], directions: [], sites: [], lagging: 0, critical: 0 }));
      if (!r.kinds.includes(o.kind as ContractorKind)) r.kinds.push(o.kind as ContractorKind);
      r.directions.push({ code: d.code, shortName: d.shortName, color: d.color, orgId: o.id, sites: 0 });
      byOrg.set(o.id, r);
    }

    dirs.forEach((d, i) => {
      for (const s of sites[i]) {
        const links = [
          ...(s.contractor ? [{ id: s.contractor.id, role: 'general' as const }] : []),
          ...s.subcontractors.map((c) => ({ id: c.id, role: 'items' as const })),
        ];
        for (const l of links) {
          const r = byOrg.get(l.id);
          if (!r || r.sites.some((x) => x.directionCode === d.code && x.siteId === s.id)) continue;
          r.sites.push({ directionCode: d.code, siteId: s.id, name: s.shortName, role: l.role, fact: s.fact, plan: s.plan, lag: s.lag, risk: s.risk });
          r.directions.find((x) => x.orgId === l.id)!.sites++;
          if (s.risk === 'warn' || s.risk === 'crit') r.lagging++;
          if (s.risk === 'crit') r.critical++;
        }
      }
    });

    for (const r of rows.values()) r.sites.sort((a, b) => (a.lag ?? Infinity) - (b.lag ?? Infinity));
    return {
      rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      directions: dirs.map((d, i) => ({ code: d.code, shortName: d.shortName, color: d.color, canManage: manage[i] })),
    };
  }

  /** Добавить подрядчика в выбранные направления; где он уже есть с этой ролью — пропустить. */
  async create(user: AuthUser, body: ContractorCreateData, ip: string | null) {
    this.access.assertSection(user, 'contractors');
    const dirs = (await this.viewable(user)).filter((d) => body.directions.includes(d.code));
    if (dirs.length !== new Set(body.directions).size) throw new ForbiddenException('Нет доступа к части направлений');
    for (const d of dirs) await this.access.assertManageDirection(user, d.id);

    const key = keyOf({ name: body.name, inn: body.inn ?? null });
    const created: string[] = [];
    const skipped: string[] = [];
    for (const d of dirs) {
      const same = await this.prisma.organization.findMany({ where: { directionId: d.id, kind: body.kind } });
      if (same.some((o) => keyOf(o) === key || normName(o.name) === normName(body.name))) {
        skipped.push(d.shortName);
        continue;
      }
      const data = { name: body.name, kind: body.kind, inn: body.inn ?? null, note: body.note ?? null };
      const row = await this.prisma.organization.create({ data: { ...data, directionId: d.id } });
      this.kpi.invalidate(d.id);
      await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'organization', entityId: row.id, directionId: d.id, after: data, comment: `подрядчик «${body.name}»`, ip });
      created.push(d.shortName);
    }
    return { created, skipped };
  }
}
