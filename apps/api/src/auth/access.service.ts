import { ForbiddenException, Injectable } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';
import { APP_SECTION_LABELS, FEATURE_LABELS, type AppSection, type Feature } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/request';
import { canUseVideo } from '../video/video-domain';

/**
 * Правила доступа к данным направлений.
 *   ADMIN       — всё;
 *   MANAGEMENT  — просмотр всего;
 *   CURATOR     — всё в своём направлении (объекты, справочники, закрытие периодов);
 *   EDITOR      — ввод факта: по всему направлению (scope ALL), по выбранным лотам/разделам (SECTIONS)
 *                 или только по назначенным объектам (SITES, site_assignment ENTRY/CURATOR);
 *   VIEWER      — просмотр направления.
 * Поверх ролей — ограничения из карточки сотрудника: скрытые разделы и отключённые возможности
 * (финансы, создание замечаний, выгрузка, журнал). Они только сужают права и не действуют на администратора.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Video grants are positive per-site grants, independent of production-entry scope. */
  async videoSiteIds(user: AuthUser, action: 'view' | 'manage'): Promise<number[]> {
    if (user.globalRole === 'ADMIN') return (await this.prisma.site.findMany({ where: { isArchived: false }, select: { id: true } })).map(s => s.id);
    if (!this.has(user, 'videoView') || (action === 'manage' && !this.has(user, 'videoManage'))) return [];
    const [grants, memberships] = await Promise.all([
      this.prisma.videoGrant.findMany({ where: { userId: user.id, site: { isArchived: false } }, include: { site: { select: { directionId: true } } } }),
      this.prisma.directionMember.findMany({ where: { userId: user.id }, select: { directionId: true, role: true } }),
    ]);
    const roles = new Map(memberships.map(m => [m.directionId, m.role]));
    return grants.filter(g => canUseVideo(user.globalRole, roles.get(g.site.directionId) ?? null, true, g.canManage, action)).map(g => g.siteId);
  }

  async assertVideo(user: AuthUser, siteId: number, action: 'view' | 'manage') {
    if (!(await this.videoSiteIds(user, action)).includes(siteId)) throw new ForbiddenException('Нет доступа к видеонаблюдению этого объекта');
  }

  /** Кадровые данные: руководство читает, назначенные отдельно ответственные редактируют. */
  async staffingPermissions(user: AuthUser) {
    if (user.globalRole === 'ADMIN') return { canView: true, canEdit: true, canManageEditors: true };
    if (!this.canSee(user, 'staffing')) return { canView: false, canEdit: false, canManageEditors: false };
    const [editor, curator] = await Promise.all([
      this.prisma.staffingEditor.findUnique({ where: { userId: user.id } }),
      this.prisma.directionMember.findFirst({ where: { userId: user.id, role: 'CURATOR', direction: { isActive: true } }, select: { id: true } }),
    ]);
    return { canView: user.globalRole === 'MANAGEMENT' || !!editor || !!curator, canEdit: !!editor, canManageEditors: !!curator };
  }

  async assertStaffing(user: AuthUser, edit = false) {
    const p = await this.staffingPermissions(user);
    if (edit ? !p.canEdit : !p.canView) throw new ForbiddenException('Нет доступа к штатной численности');
    return p;
  }

  async membership(user: AuthUser, directionId: number) {
    return this.prisma.directionMember.findUnique({
      where: { directionId_userId: { directionId, userId: user.id } },
    });
  }

  async canViewDirection(user: AuthUser, directionId: number): Promise<boolean> {
    if (user.globalRole !== 'USER') return true;
    return !!(await this.membership(user, directionId));
  }

  async roleIn(user: AuthUser, directionId: number): Promise<MemberRole | 'ADMIN' | null> {
    if (user.globalRole === 'ADMIN') return 'ADMIN';
    return (await this.membership(user, directionId))?.role ?? null;
  }

  /** Править настройки и справочники направления: администратор или куратор. */
  async canManageDirection(user: AuthUser, directionId: number): Promise<boolean> {
    const r = await this.roleIn(user, directionId);
    return r === 'ADMIN' || r === 'CURATOR';
  }

  /** Вносить данные по объекту. */
  async canEditSite(user: AuthUser, siteId: number): Promise<boolean> {
    if (user.globalRole === 'ADMIN') return true;
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { directionId: true, sectionId: true } });
    if (!site) return false;
    const m = await this.membership(user, site.directionId);
    if (!m) return false;
    if (m.role === 'CURATOR') return true;
    if (m.role !== 'EDITOR') return false;
    if (m.scope === 'ALL') return true;
    if (m.scope === 'SECTIONS') {
      if (site.sectionId == null) return false;
      const s = await this.prisma.directionMemberSection.findUnique({
        where: { memberId_sectionId: { memberId: m.id, sectionId: site.sectionId } },
      });
      return !!s;
    }
    const a = await this.prisma.siteAssignment.findFirst({
      where: { siteId, userId: user.id, role: { in: ['ENTRY', 'CURATOR'] } },
      select: { id: true },
    });
    return !!a;
  }

  /**
   * На какие объекты направления пользователь может вносить данные (без учёта статуса отчётной точки).
   * all = true — на все объекты.
   */
  async editableSites(user: AuthUser, directionId: number): Promise<{ role: MemberRole | 'ADMIN' | null; all: boolean; ids: Set<number> }> {
    if (user.globalRole === 'ADMIN') return { role: 'ADMIN', all: true, ids: new Set() };
    const m = await this.prisma.directionMember.findUnique({
      where: { directionId_userId: { directionId, userId: user.id } },
      include: { sections: true },
    });
    if (!m || m.role === 'VIEWER') return { role: m?.role ?? null, all: false, ids: new Set() };
    if (m.role === 'CURATOR' || m.scope === 'ALL') return { role: m.role, all: true, ids: new Set() };
    if (m.scope === 'SECTIONS') {
      const sites = await this.prisma.site.findMany({
        where: { directionId, sectionId: { in: m.sections.map((s) => s.sectionId) } },
        select: { id: true },
      });
      return { role: m.role, all: false, ids: new Set(sites.map((s) => s.id)) };
    }
    const a = await this.prisma.siteAssignment.findMany({
      where: { userId: user.id, role: { in: ['ENTRY', 'CURATOR'] }, site: { directionId } },
      select: { siteId: true },
    });
    return { role: m.role, all: false, ids: new Set(a.map((x) => x.siteId)) };
  }

  /** Раздел не скрыт у сотрудника. */
  canSee(user: AuthUser, section: AppSection): boolean {
    return !user.hiddenSections.includes(section);
  }

  /** Возможность не отключена у сотрудника. */
  has(user: AuthUser, feature: Feature): boolean {
    return !user.deniedFeatures.includes(feature);
  }

  assertSection(user: AuthUser, section: AppSection) {
    if (!this.canSee(user, section)) throw new ForbiddenException(`Раздел «${APP_SECTION_LABELS[section]}» вам недоступен`);
  }

  assertFeature(user: AuthUser, feature: Feature) {
    if (!this.has(user, feature)) throw new ForbiddenException(`Возможность «${FEATURE_LABELS[feature].label}» вам отключена`);
  }

  async assertViewDirection(user: AuthUser, directionId: number) {
    if (!(await this.canViewDirection(user, directionId))) throw new ForbiddenException('Нет доступа к направлению');
  }

  async assertManageDirection(user: AuthUser, directionId: number) {
    if (!(await this.canManageDirection(user, directionId))) throw new ForbiddenException('Нужны права куратора направления');
  }

  async assertEditSite(user: AuthUser, siteId: number) {
    if (!(await this.canEditSite(user, siteId))) throw new ForbiddenException('Нет прав на ввод данных по объекту');
  }
}
