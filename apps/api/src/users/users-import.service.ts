/**
 * Загрузка пользователей списком. Сначала проверка (dryRun) — показывает по каждой строке, что будет сделано,
 * затем загрузка тех же строк: строки с ошибками пропускаются, остальные применяются.
 *
 * Правила:
 *   - человек определяется логином, а если логин не указан — по ФИО (повторная загрузка того же списка не создаёт дублей;
 *     если людей с таким ФИО несколько — нужно указать логин);
 *     несколько строк одного человека — его роли в нескольких направлениях;
 *   - логин не указан, а вход нужен — составляется из ФИО (petrova.an), при совпадении добавляется цифра;
 *   - новым учётным записям выдаётся временный пароль, при первом входе система попросит сменить его;
 *   - у существующих пароль и ФИО не меняются, должность и контакты — если указаны; роли в указанных направлениях
 *     заменяются, в остальных — сохраняются.
 */
import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { GlobalRole, MemberRole } from '@prisma/client';
import { GLOBAL_ROLE_LABELS, MEMBER_ROLE_LABELS, type UserImportResult, type UserImportRow } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/auth.service';
import type { AuthUser } from '../common/request';

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const translit = (s: string) => [...s.toLowerCase()].map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : '')).join('');
/** «Петрова Анна Николаевна» → petrova.an */
export function loginFromName(fullName: string) {
  const [last = '', ...rest] = fullName.trim().split(/\s+/);
  const initials = rest.map((p) => translit(p)[0] ?? '').join('');
  return [translit(last), initials].filter(Boolean).join('.').slice(0, 60) || 'user';
}
/** Временный пароль: 12 знаков, буквы и цифры, без похожих (0/O, 1/l/I). */
function tempPassword() {
  const L = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789', A = L + D;
  const p = [L[randomInt(L.length)], D[randomInt(D.length)], ...Array.from({ length: 10 }, () => A[randomInt(A.length)])];
  for (let i = p.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.join('');
}

const norm = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
const low = (s: string | undefined) => norm(s).toLowerCase().replace(/ё/g, 'е');

function parseGlobal(v: string): GlobalRole | null | undefined {
  const s = low(v);
  if (!s) return undefined;
  if (s === 'admin' || s.startsWith('админ')) return 'ADMIN';
  if (s === 'management' || s.startsWith('руковод')) return 'MANAGEMENT';
  if (s === 'user' || s.startsWith('сотруд') || s.startsWith('пользов')) return 'USER';
  return null;
}
function parseRole(v: string): MemberRole | null | undefined {
  const s = low(v);
  if (!s) return undefined;
  if (s === 'curator' || s.startsWith('кур')) return 'CURATOR';
  if (s === 'editor' || s.startsWith('отв') || s.includes('ввод') || s.startsWith('редакт')) return 'EDITOR';
  if (s === 'viewer' || s.startsWith('просм') || s.startsWith('чтен')) return 'VIEWER';
  return null;
}
function parseYes(v: string): boolean | null | undefined {
  const s = low(v);
  if (!s) return undefined;
  if (['да', 'yes', 'true', '1', '+', 'есть'].includes(s)) return true;
  if (['нет', 'no', 'false', '0', '-', '—'].includes(s)) return false;
  return null;
}

interface Membership {
  directionId: number;
  directionName: string;
  role: MemberRole;
  sectionIds: number[];
  sectionNames: string[];
}
interface Person {
  key: string;
  lines: number[];
  fullName: string;
  login: string | null;
  loginGiven: boolean;
  position: string | null;
  email: string | null;
  phone: string | null;
  globalRole: GlobalRole | undefined;
  canLogin: boolean;
  memberships: Membership[];
  errors: string[];
  notes: string[];
  existingId: number | null;
}

@Injectable()
export class UsersImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(actor: AuthUser, rows: Record<string, string>[], dryRun: boolean, ip: string | null): Promise<UserImportResult> {
    const dirs = await this.prisma.direction.findMany({ include: { sections: true } });
    const findDir = (v: string) => {
      const s = low(v);
      return dirs.find((d) => low(d.code) === s || low(d.shortName) === s || low(d.name) === s);
    };
    const users = await this.prisma.user.findMany({ select: { id: true, login: true, fullName: true, canLogin: true } });
    const byLogin = new Map(users.filter((u) => u.login).map((u) => [u.login!.toLowerCase(), u]));
    const byName = new Map<string, typeof users>();
    for (const u of users) byName.set(low(u.fullName), [...(byName.get(low(u.fullName)) ?? []), u]);

    // 1. строки → люди
    const people = new Map<string, Person>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const fullName = norm(r.fullName);
      const loginRaw = norm(r.login).toLowerCase();
      const can = parseYes(r.canLogin ?? '');
      const key = loginRaw ? `l:${loginRaw}` : `n:${low(fullName)}`;
      let p = people.get(key);
      if (!p) {
        p = {
          key, lines: [], fullName, login: loginRaw || null, loginGiven: !!loginRaw,
          position: norm(r.position) || null, email: norm(r.email) || null, phone: norm(r.phone) || null,
          globalRole: undefined, canLogin: can ?? true, memberships: [], errors: [], notes: [], existingId: null,
        };
        people.set(key, p);
      }
      p.lines.push(line);
      const err = (m: string) => p.errors.push(`строка ${line}: ${m}`);
      if (fullName.length < 2) err('не указано ФИО');
      if (can === null) err(`«Вход»: ожидается «да» или «нет», а не «${r.canLogin}»`);
      if (loginRaw && !/^[a-z0-9._-]{3,64}$/.test(loginRaw)) err(`логин «${loginRaw}»: латиница, цифры, точка, дефис, от 3 символов`);
      if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) err(`e-mail «${p.email}» указан неверно`);
      const g = parseGlobal(r.globalRole ?? '');
      if (g === null) err(`роль в системе «${r.globalRole}»: ${Object.values(GLOBAL_ROLE_LABELS).join(' / ')}`);
      else if (g) p.globalRole = g;

      // роль в направлении
      const dirText = norm(r.direction);
      if (!dirText) {
        if (norm(r.role) || norm(r.sections)) err('указана роль или лоты, но не указано направление');
        return;
      }
      const d = findDir(dirText);
      if (!d) return err(`направление «${dirText}» не найдено (код или краткое название: ${dirs.map((x) => x.shortName).join(', ')})`);
      let role = parseRole(r.role ?? '');
      if (role === null) return err(`роль «${r.role}»: ${Object.values(MEMBER_ROLE_LABELS).join(' / ')}`);
      if (!role) {
        role = 'VIEWER';
        p.notes.push(`${d.shortName}: роль не указана — просмотр`);
      }
      const names = norm(r.sections).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      const sectionIds: number[] = [];
      for (const n of names) {
        const s = d.sections.find((x) => !x.isArchived && (low(x.name) === low(n) || low(x.code) === low(n)));
        if (!s) err(`лот «${n}» не найден в направлении ${d.shortName}`);
        else sectionIds.push(s.id);
      }
      if (sectionIds.length && role !== 'EDITOR') p.notes.push(`${d.shortName}: лоты учитываются только у ответственного за ввод`);
      if (p.memberships.some((m) => m.directionId === d.id)) return err(`направление ${d.shortName} у этого человека уже указано выше`);
      p.memberships.push({ directionId: d.id, directionName: d.shortName, role, sectionIds: role === 'EDITOR' ? sectionIds : [], sectionNames: role === 'EDITOR' ? names : [] });
    });

    // 2. существующие учётные записи и логины для новых
    const taken = new Set(byLogin.keys());
    for (const p of people.values()) {
      if (p.login && byLogin.has(p.login)) {
        p.existingId = byLogin.get(p.login)!.id;
      } else if (!p.login && (byName.get(low(p.fullName))?.length ?? 0) > 1) {
        p.errors.push(`в системе несколько человек «${p.fullName}» — укажите логин`);
      } else if (!p.login && byName.has(low(p.fullName))) {
        const u = byName.get(low(p.fullName))![0];
        p.existingId = u.id;
        p.login = u.login;
        p.notes.push(`уже есть в системе${u.login ? ` (логин ${u.login})` : ''}`);
      } else if (p.canLogin && !p.login) {
        const base = loginFromName(p.fullName);
        let l = base;
        for (let k = 2; taken.has(l); k++) l = `${base}${k}`;
        p.login = l;
        p.notes.push(`логин составлен из ФИО: ${l}`);
      }
      if (p.login && !p.existingId) {
        if (taken.has(p.login)) p.errors.push(`логин ${p.login} уже занят`);
        taken.add(p.login);
      }
      if (!p.canLogin && p.loginGiven && !p.existingId) p.notes.push('вход выключен — логин не используется');
    }

    // 3. применение
    const out: UserImportRow[] = [];
    let created = 0, updated = 0;
    for (const p of people.values()) {
      const roles = p.memberships.map((m) => `${m.directionName}: ${MEMBER_ROLE_LABELS[m.role].toLowerCase()}${m.sectionNames.length ? ` (${m.sectionNames.join(', ')})` : ''}`);
      const row: UserImportRow = {
        line: p.lines[0],
        fullName: p.fullName,
        login: p.canLogin || p.existingId ? p.login : null,
        status: p.errors.length ? 'error' : p.existingId ? 'update' : 'create',
        messages: [...p.errors, ...p.notes],
        roles,
      };
      if (!p.errors.length && !dryRun) {
        const password = !p.existingId && p.canLogin ? tempPassword() : undefined;
        await this.apply(actor, p, password, ip);
        if (password) row.password = password;
        if (p.existingId) updated++;
        else created++;
      }
      out.push(row);
    }
    if (!dryRun && (created || updated)) {
      await this.audit.write({ userId: actor.id, action: 'IMPORT', entity: 'user', comment: `загрузка пользователей списком: новых ${created}, обновлено ${updated}`, ip });
    }
    return {
      dryRun,
      rows: out.sort((a, b) => a.line - b.line),
      created: dryRun ? out.filter((r) => r.status === 'create').length : created,
      updated: dryRun ? out.filter((r) => r.status === 'update').length : updated,
      errors: out.filter((r) => r.status === 'error').length,
    };
  }

  private async apply(actor: AuthUser, p: Person, password: string | undefined, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      let id = p.existingId;
      if (id) {
        await tx.user.update({
          where: { id },
          // ФИО существующего не меняем (переименование — в карточке пользователя), остальное — если указано
          data: {
            ...(p.position ? { position: p.position } : {}),
            ...(p.email ? { email: p.email } : {}),
            ...(p.phone ? { phone: p.phone } : {}),
            ...(p.globalRole ? { globalRole: p.globalRole } : {}),
          },
        });
      } else {
        const u = await tx.user.create({
          data: {
            fullName: p.fullName,
            position: p.position,
            email: p.email,
            phone: p.phone,
            globalRole: p.globalRole ?? 'USER',
            canLogin: p.canLogin,
            login: p.canLogin ? p.login : null,
            passwordHash: password ? await hashPassword(password) : null,
            mustChangePassword: true,
          },
        });
        id = u.id;
      }
      for (const m of p.memberships) {
        await tx.directionMember.deleteMany({ where: { userId: id, directionId: m.directionId } });
        await tx.directionMember.create({
          data: {
            userId: id,
            directionId: m.directionId,
            role: m.role,
            scope: m.sectionIds.length ? 'SECTIONS' : 'ALL',
            sections: { create: m.sectionIds.map((sectionId) => ({ sectionId })) },
          },
        });
      }
      await this.audit.write(
        {
          userId: actor.id, action: p.existingId ? 'UPDATE' : 'CREATE', entity: 'user', entityId: id, ip,
          comment: `${p.existingId ? 'обновлён' : 'создан'} при загрузке списком`,
          after: { fullName: p.fullName, login: p.login, roles: p.memberships.map((m) => `${m.directionName}: ${m.role}`) },
        },
        tx,
      );
    });
  }
}
