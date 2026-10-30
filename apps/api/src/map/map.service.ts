import { Injectable } from '@nestjs/common';
import type { ObjectsMap } from '@mvs/shared';
import type { AuthUser } from '../common/request';
import { PrismaService } from '../prisma/prisma.service';
import { KpiService } from '../kpi/kpi.service';

@Injectable()
export class ObjectsMapService {
  constructor(private readonly prisma: PrismaService, private readonly kpi: KpiService) {}
  async list(user: AuthUser): Promise<ObjectsMap> {
    // Тот же доступ к активным направлениям, что у меню и производственной сводки.
    const directions = await this.prisma.direction.findMany({
      where: { isActive: true, ...(user.globalRole === 'USER' ? { members: { some: { userId: user.id } } } : {}) },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, shortName: true, color: true,
        workTypes: { where: { isArchived: false }, orderBy: [{ sort: 'asc' }, { id: 'asc' }], select: { id: true, name: true } } },
    });
    if (!directions.length) return { directions: [], sites: [], workTypes: [] };
    const sites = await this.prisma.site.findMany({
      where: { directionId: { in: directions.map((d) => d.id) }, isArchived: false },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      select: { id: true, directionId: true, name: true, lat: true, lon: true, section: { select: { id: true, name: true } },
        workItems: { where: { isArchived: false, workType: { isArchived: false } }, select: { workTypeId: true, workType: { select: { directionId: true } } } },
        // Не подменяем ответственного куратором, вводящим данные или прорабом.
        // Поля пользователя уже доступны в SiteCard после проверки просмотра направления.
        assignments: { where: { role: 'RESPONSIBLE' }, orderBy: { userId: 'asc' },
          select: { user: { select: { id: true, fullName: true, position: true, phone: true } } } },
      },
    });
    // Используем действующий расчёт ресурсов и его кеш, не загружаем полные карточки объектов.
    // Ограничиваем параллельность при появлении большого числа направлений.
    const resources = new Map<number, Map<number, { people: number | null; tech: number | null }>>();
    for (let i = 0; i < directions.length; i += 4) {
      await Promise.all(directions.slice(i, i + 4).map(async (d) => {
        resources.set(d.id, new Map((await this.kpi.sites(user, d.code)).map((s) => [s.id, { people: s.people, tech: s.tech }])));
      }));
    }
    const byId = new Map(directions.map((d) => [d.id, d]));
    return {
      directions: directions.map((d) => ({ id: d.id, code: d.code, name: d.shortName, color: d.color })),
      workTypes: directions.flatMap((d) => d.workTypes.map((w) => ({ ...w, directionCode: d.code }))),
      sites: sites.map((s) => ({ id: s.id, directionCode: byId.get(s.directionId)!.code, name: s.name, section: s.section,
        lat: s.lat == null ? null : Number(s.lat), lon: s.lon == null ? null : Number(s.lon),
        people: resources.get(s.directionId)?.get(s.id)?.people ?? null, tech: resources.get(s.directionId)?.get(s.id)?.tech ?? null,
        workTypeIds: [...new Set(s.workItems.filter((w) => w.workType.directionId === s.directionId).map((w) => w.workTypeId))],
        responsibles: s.assignments.map((a) => a.user),
      })),
    };
  }
}
