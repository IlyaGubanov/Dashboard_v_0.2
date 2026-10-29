/**
 * Учётные записи для показа по ролям — ТОЛЬКО для локального запуска на своём компьютере.
 *
 *   npm run db:demo:users -w @mvs/api
 *
 * Пароли известны всем, кто читал документацию, поэтому скрипт отказывается работать, если база не на этом компьютере
 * (адрес не localhost / 127.0.0.1) или NODE_ENV=production. В Docker на своём компьютере (база «db», production)
 * разрешить явно: DEMO_USERS=true. На сервере с доступом извне так делать нельзя.
 *
 * Администратор создаётся сидом (ADMIN_LOGIN / ADMIN_PASSWORD); здесь ему только отключается обязательная смена пароля.
 */
import type { GlobalRole, MemberRole } from '@prisma/client';
import { hash } from 'bcryptjs';
import { prisma } from './lib';

export const DEMO_USERS = [
  { login: 'rukovod', password: 'Rukovod2026demo', fullName: 'Руководство (демо)', position: 'Заместитель генерального директора', role: 'MANAGEMENT' as GlobalRole, m: [] as { dir: string; role: MemberRole; lots?: number }[] },
  { login: 'kurator', password: 'Kurator2026demo', fullName: 'Куратор МКД и Сетей (демо)', position: 'Главный инженер проекта', role: 'USER' as GlobalRole, m: [{ dir: 'mkd', role: 'CURATOR' as MemberRole }, { dir: 'networks', role: 'CURATOR' as MemberRole }] },
  { login: 'vvod', password: 'Vvod2026demo', fullName: 'Ответственный за ввод МКД (демо)', position: 'Инженер ПТО', role: 'USER' as GlobalRole, m: [{ dir: 'mkd', role: 'EDITOR' as MemberRole, lots: 2 }] },
];

function guard() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.match(/@([^:/?]+)/)?.[1] ?? '';
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (process.env.DEMO_USERS === 'true') return; // явно разрешено (Docker на своём компьютере)
  if (process.env.NODE_ENV === 'production') throw new Error('NODE_ENV=production — демо-учётки с известными паролями не создаются (на своём компьютере в Docker: DEMO_USERS=true)');
  if (!local) throw new Error(`база на «${host || '?'}», а не на этом компьютере. Демо-учётки — только для локального показа`);
}

async function main() {
  guard();
  for (const u of DEMO_USERS) {
    const row = await prisma.user.upsert({
      where: { login: u.login },
      create: { login: u.login, canLogin: true, fullName: u.fullName, position: u.position, globalRole: u.role, passwordHash: await hash(u.password, 12), mustChangePassword: false },
      update: { passwordHash: await hash(u.password, 12), mustChangePassword: false, isActive: true, failedLogins: 0, lockedUntil: null },
    });
    await prisma.directionMember.deleteMany({ where: { userId: row.id } });
    for (const m of u.m) {
      const d = await prisma.direction.findUnique({ where: { code: m.dir }, include: { sections: { where: { isArchived: false }, orderBy: { sort: 'asc' } } } });
      if (!d) continue;
      const lots = m.lots ? d.sections.slice(0, m.lots).map((s) => s.id) : [];
      await prisma.directionMember.create({
        data: { userId: row.id, directionId: d.id, role: m.role, scope: lots.length ? 'SECTIONS' : 'ALL', sections: { create: lots.map((sectionId) => ({ sectionId })) } },
      });
    }
  }
  // ответственному — несколько незакрытых замечаний по его лотам, чтобы было что увидеть в «Моих задачах»
  const vvod = await prisma.user.findUniqueOrThrow({ where: { login: 'vvod' }, include: { memberships: { include: { sections: true } } } });
  const lotIds = vvod.memberships.flatMap((m) => m.sections.map((s) => s.sectionId));
  const open = await prisma.remark.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, site: { sectionId: { in: lotIds } } }, take: 6, select: { id: true } });
  await prisma.remark.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { assigneeId: vvod.id } });

  const admin = process.env.ADMIN_LOGIN ?? 'admin';
  await prisma.user.updateMany({ where: { login: admin }, data: { mustChangePassword: false } });

  console.log('Демо-учётки (смена пароля при входе отключена):');
  console.log(`  ${admin.padEnd(8)} — администратор (пароль из ADMIN_PASSWORD)`);
  for (const u of DEMO_USERS) console.log(`  ${u.login.padEnd(8)} ${u.password.padEnd(16)} — ${u.fullName}`);
}

main()
  .catch((e) => {
    console.error(`Демо-учётки не созданы: ${e.message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
