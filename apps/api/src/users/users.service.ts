import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseRestrictions, type DepartmentData, type DepartmentItem, type MembershipData, type UserCreateData, type UserListItem, type UserUpdateData } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/auth.service';
import type { AuthUser } from '../common/request';

const withMemberships = {
  memberships: { where:{direction:{code:{not:'reb'}}}, include: { direction: { select: { name: true } }, sections: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof withMemberships }>;

const toItem = (u: UserRow): UserListItem => ({
  id: u.id,
  login: u.login,
  fullName: u.fullName,
  position: u.position,
  department: u.department,
  email: u.email,
  phone: u.phone,
  globalRole: u.globalRole,
  canLogin: u.canLogin,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
  ...parseRestrictions(u.hiddenSections, u.deniedFeatures),
  memberships: u.memberships.map((m) => ({
    directionId: m.directionId,
    directionName: m.direction.name,
    role: m.role,
    scope: m.scope,
    sectionIds: m.sections.map((s) => s.sectionId),
  })),
});

// в журнал не пишем хэш пароля
const safe = ({ passwordHash: _p, ...rest }: Record<string, unknown>) => rest;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<UserListItem[]> {
    const rows = await this.prisma.user.findMany({ include: withMemberships, orderBy: { fullName: 'asc' } });
    return rows.map(toItem);
  }

  async create(actor: AuthUser, input: UserCreateData, ip: string | null) {
    await this.checkDepartment(input.departmentId);
    try {
      const u = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            fullName: input.fullName,
            position: input.position ?? null,
            departmentId: input.departmentId ?? null,
            email: input.email || null,
            phone: input.phone ?? null,
            globalRole: input.globalRole ?? 'USER',
            hiddenSections: input.hiddenSections,
            deniedFeatures: input.deniedFeatures,
            canLogin: input.canLogin,
            login: input.canLogin ? input.login : null,
            passwordHash: input.canLogin && input.password ? await hashPassword(input.password) : null,
            mustChangePassword: true,
          },
          include: withMemberships,
        });
        await this.audit.write(
          { userId: actor.id, action: 'CREATE', entity: 'user', entityId: created.id, after: safe(created), ip },
          tx,
        );
        return created;
      });
      return toItem(u);
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async update(actor: AuthUser, id: number, input: UserUpdateData, ip: string | null) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Пользователь не найден');
    // себя администратор не блокирует и не понижает — иначе можно остаться без администратора
    if (id === actor.id && (input.isActive === false || (input.globalRole && input.globalRole !== 'ADMIN'))) {
      throw new BadRequestException({ message: 'Нельзя заблокировать себя или снять с себя роль администратора', fields: { globalRole: 'Нельзя изменить свою роль' } });
    }
    if (input.departmentId !== before.departmentId) await this.checkDepartment(input.departmentId);
    const u = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...input,
          email: input.email === undefined ? undefined : input.email || null,
        },
        include: withMemberships,
      });
      if (input.isActive === false) {
        await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.write(
        { userId: actor.id, action: 'UPDATE', entity: 'user', entityId: id, before: safe(before), after: safe(updated), ip },
        tx,
      );
      return updated;
    });
    return toItem(u);
  }

  /** Новый пароль от администратора: пользователь обязан сменить его при входе, все сессии закрываются. */
  async resetPassword(actor: AuthUser, id: number, password: string, login: string | undefined, ip: string | null) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Пользователь не найден');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            passwordHash: await hashPassword(password),
            mustChangePassword: true,
            canLogin: true,
            failedLogins: 0,
            lockedUntil: null,
            ...(login ? { login } : {}),
          },
        });
        await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await this.audit.write(
          { userId: actor.id, action: 'PASSWORD_CHANGE', entity: 'user', entityId: id, comment: 'сброс администратором', ip },
          tx,
        );
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
    return { ok: true };
  }

  /** Снять блокировку входа после неудачных попыток. */
  async unlock(actor: AuthUser, id: number, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
      await this.audit.write({ userId: actor.id, action: 'UPDATE', entity: 'user', entityId: id, comment: 'снята блокировка входа', ip }, tx);
    });
    return { ok: true };
  }

  /**
   * Полностью заменяет роли пользователя в направлениях.
   * Ответственному за ввод можно ограничить объекты лотами/разделами (scope = SECTIONS).
   */
  async setMemberships(actor: AuthUser, id: number, items: MembershipData[], ip: string | null) {
    if (new Set(items.map((m) => m.directionId)).size !== items.length) {
      throw new BadRequestException('Направление указано дважды');
    }
    // лоты должны принадлежать своему направлению
    const sectionIds = items.flatMap((m) => m.sectionIds);
    if (sectionIds.length) {
      const found = await this.prisma.section.findMany({ where: { id: { in: sectionIds } }, select: { id: true, directionId: true } });
      const dirOf = new Map(found.map((s) => [s.id, s.directionId]));
      const bad = items.some((m) => m.sectionIds.some((sid) => dirOf.get(sid) !== m.directionId));
      if (bad) throw new BadRequestException({ message: 'Лот не относится к направлению', fields: { sectionIds: 'Неверный лот' } });
    }

    const before = await this.prisma.directionMember.findMany({ where: { userId: id }, include: { sections: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.directionMember.deleteMany({ where: { userId: id } });
      for (const m of items) {
        await tx.directionMember.create({
          data: {
            userId: id,
            directionId: m.directionId,
            role: m.role,
            scope: m.scope,
            sections: { create: m.sectionIds.map((sectionId) => ({ sectionId })) },
          },
        });
      }
      await this.audit.write(
        { userId: actor.id, action: 'UPDATE', entity: 'direction_member', entityId: id, before, after: items, ip },
        tx,
      );
    });
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id }, include: withMemberships });
    return toItem(u);
  }

  // ---------------------------------------------------------------- подразделения

  async departments(): Promise<DepartmentItem[]> {
    const rows = await this.prisma.department.findMany({ include: { _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
    return rows.map((d) => ({ id: d.id, name: d.name, isArchived: d.isArchived, users: d._count.users }));
  }

  async createDepartment(actor: AuthUser, input: DepartmentData, ip: string | null): Promise<DepartmentItem> {
    try {
      const d = await this.prisma.$transaction(async (tx) => {
        const created = await tx.department.create({ data: { name: input.name } });
        await this.audit.write({ userId: actor.id, action: 'CREATE', entity: 'department', entityId: created.id, after: created, ip }, tx);
        return created;
      });
      return { id: d.id, name: d.name, isArchived: d.isArchived, users: 0 };
    } catch (e) {
      throw this.mapDepartmentUnique(e);
    }
  }

  /** Переименовать или убрать в архив (сотрудники остаются в подразделении, новым его не выбрать). */
  async updateDepartment(actor: AuthUser, id: number, input: Partial<DepartmentData>, ip: string | null): Promise<DepartmentItem> {
    const before = await this.prisma.department.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Подразделение не найдено');
    try {
      const d = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.department.update({
          where: { id },
          data: { name: input.name, isArchived: input.isArchived },
          include: { _count: { select: { users: true } } },
        });
        await this.audit.write({ userId: actor.id, action: 'UPDATE', entity: 'department', entityId: id, before, after: { ...updated, _count: undefined }, ip }, tx);
        return updated;
      });
      return { id: d.id, name: d.name, isArchived: d.isArchived, users: d._count.users };
    } catch (e) {
      throw this.mapDepartmentUnique(e);
    }
  }

  /** Выбрать можно только действующее подразделение. */
  private async checkDepartment(id: number | null | undefined) {
    if (id == null) return;
    const d = await this.prisma.department.findUnique({ where: { id } });
    if (!d || d.isArchived) throw new BadRequestException({ message: 'Подразделение не найдено или в архиве', fields: { departmentId: 'Выберите подразделение из списка' } });
  }

  private mapDepartmentUnique(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException({ message: 'Такое подразделение уже есть', fields: { name: 'Уже есть в справочнике' } });
    }
    return e;
  }

  private mapUnique(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException({ message: 'Такой логин уже занят', fields: { login: 'Логин занят' } });
    }
    return e;
  }
}
