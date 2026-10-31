import { Injectable, NotFoundException } from '@nestjs/common';
import type { DirectionSummary, OverviewTileConfig } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../common/request';

@Injectable()
export class DirectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** Направления, доступные пользователю, с кураторами и числом объектов. */
  async list(user: AuthUser): Promise<DirectionSummary[]> {
    const rows = await this.prisma.direction.findMany({
      where: {
        isActive: true,
        ...(user.globalRole === 'USER' ? { members: { some: { userId: user.id } } } : {}),
      },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { sites: { where: { isArchived: false } } } },
        sections: { where: { isArchived: false }, orderBy: { sort: 'asc' }, select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, fullName: true } } } },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      shortName: d.shortName,
      icon: d.icon,
      color: d.color,
      periodKind: d.periodKind,
      isReadonly: d.isReadonly,
      siteUnit: d.siteUnit,
      sitesCount: d._count.sites,
      overviewTiles: ((d.settings as { overviewTiles?: OverviewTileConfig[] } | null)?.overviewTiles ?? []) as OverviewTileConfig[],
      sections: d.sections,
      curators: d.members.filter((m) => m.role === 'CURATOR').map((m) => m.user),
      myRole: d.members.find((m) => m.userId === user.id)?.role ?? null,
    }));
  }

  /** Полная конфигурация направления: настройки, разделы, виды работ, статусы, доп. поля, трекеры. */
  async config(user: AuthUser, code: string) {
    const d = await this.prisma.direction.findUnique({
      where: { code },
      include: {
        sections: { where: { isArchived: false }, orderBy: { sort: 'asc' } },
        workGroups: { orderBy: { sort: 'asc' } },
        workTypes: { where: { isArchived: false }, orderBy: { sort: 'asc' } },
        statusDefs: { orderBy: { sort: 'asc' } },
        fieldDefs: { where: { isArchived: false }, orderBy: { sort: 'asc' } },
        trackers: {
          where: { isActive: true },
          orderBy: { sort: 'asc' },
          include: {
            stages: { orderBy: { sort: 'asc' } },
            items: { where: { isArchived: false }, orderBy: { sort: 'asc' } },
          },
        },
        members: {
          include: { user: { select: { id: true, fullName: true, position: true, phone: true, email: true } } },
        },
      },
    });
    if (!d) throw new NotFoundException('Направление не найдено');
    await this.access.assertViewDirection(user, d.id);
    return d;
  }
}
