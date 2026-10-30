import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { compare, hash, hashSync } from 'bcryptjs';
import { parseRestrictions, type AccessRestrictions, type Me } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/request';

export const SESSION_COOKIE = 'mvs_sid';
const BCRYPT_COST = 12;
const TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600_000;
/** не чаще раза в 5 минут продлеваем сессию, чтобы не писать в БД на каждый запрос */
const TOUCH_EVERY_MS = 5 * 60_000;
// хэш-заглушка: сравнение идёт и для несуществующего логина, чтобы время ответа не выдавало логины
const DUMMY_HASH = hashSync(randomBytes(16).toString('hex'), BCRYPT_COST);

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;

export const hashPassword = (password: string) => hash(password, BCRYPT_COST);
/** Ограничения из карточки сотрудника; администратору не применяются. */
export const restrictionsOf = (u: { globalRole: string; hiddenSections: unknown; deniedFeatures: unknown }): AccessRestrictions =>
  u.globalRole === 'ADMIN' ? { hiddenSections: [], deniedFeatures: [] } : parseRestrictions(u.hiddenSections, u.deniedFeatures);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const lockedMessage = (until: Date) =>
  `Слишком много неудачных попыток. Вход заблокирован до ${until.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })} (МСК) или до разблокировки администратором`;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async login(login: string, password: string, ip: string | null, userAgent: string | null) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    const now = new Date();

    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.audit.write({ userId: user.id, action: 'LOGIN_FAILED', entity: 'user', entityId: user.id, comment: 'вход заблокирован', ip });
      throw new UnauthorizedException({ message: lockedMessage(user.lockedUntil), code: 'ACCOUNT_LOCKED' });
    }

    const ok = await compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.canLogin || !user.isActive) {
      let lockedUntil: Date | null = null;
      if (user && user.canLogin) {
        // пятая неудачная попытка подряд блокирует вход на 15 минут
        const failed = user.failedLogins + 1;
        lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MS) : null;
        await this.prisma.user.update({
          where: { id: user.id },
          data: lockedUntil ? { failedLogins: 0, lockedUntil } : { failedLogins: failed },
        });
      }
      await this.audit.write({
        userId: user?.id,
        action: 'LOGIN_FAILED',
        entity: 'user',
        entityId: user?.id,
        comment: `логин «${login.slice(0, 64)}»${lockedUntil ? '; вход заблокирован на 15 минут' : ''}`,
        ip,
      });
      if (lockedUntil) throw new UnauthorizedException({ message: lockedMessage(lockedUntil), code: 'ACCOUNT_LOCKED' });
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.userSession.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + TTL_MS),
          ip,
          userAgent: userAgent?.slice(0, 400) ?? null,
        },
      }),
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now, failedLogins: 0, lockedUntil: null } }),
    ]);
    await this.audit.write({ userId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id, ip });
    return { token, expiresAt: new Date(now.getTime() + TTL_MS) };
  }

  async resolveSession(token: string): Promise<AuthUser | null> {
    const s = await this.prisma.userSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    const now = Date.now();
    if (!s || s.revokedAt || s.expiresAt.getTime() <= now) return null;
    const u = s.user;
    if (!u.isActive || !u.canLogin || !u.login) return null;

    if (now - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.userSession.update({
        where: { id: s.id },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(now + TTL_MS) },
      });
    }
    return {
      id: u.id,
      login: u.login,
      fullName: u.fullName,
      globalRole: u.globalRole,
      mustChangePassword: u.mustChangePassword,
      sessionId: s.id,
      ...restrictionsOf(u),
    };
  }

  async logout(user: AuthUser, ip: string | null) {
    await this.prisma.userSession.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
    await this.audit.write({ userId: user.id, action: 'LOGOUT', entity: 'user', entityId: user.id, ip });
  }

  async me(userId: number): Promise<Me> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { direction: { select: { code: true } }, sections: true } } },
    });
    return {
      id: u.id,
      login: u.login!,
      fullName: u.fullName,
      position: u.position,
      globalRole: u.globalRole,
      mustChangePassword: u.mustChangePassword,
      ...restrictionsOf(u),
      directions: u.memberships.map((m) => ({
        directionId: m.directionId,
        code: m.direction.code,
        role: m.role,
        scope: m.scope,
        sectionIds: m.sections.map((s) => s.sectionId),
      })),
    };
  }

  async changePassword(user: AuthUser, current: string, next: string, ip: string | null) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.passwordHash || !(await compare(current, u.passwordHash))) {
      throw new BadRequestException({ message: 'Текущий пароль неверный', fields: { currentPassword: 'Неверный пароль' } });
    }
    if (current === next) {
      throw new BadRequestException({ message: 'Новый пароль совпадает со старым', fields: { newPassword: 'Совпадает со старым' } });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(next), mustChangePassword: false },
      });
      // остальные сессии пользователя закрываем
      await tx.userSession.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } },
        data: { revokedAt: new Date() },
      });
      await this.audit.write({ userId: user.id, action: 'PASSWORD_CHANGE', entity: 'user', entityId: user.id, ip }, tx);
    });
  }
}
