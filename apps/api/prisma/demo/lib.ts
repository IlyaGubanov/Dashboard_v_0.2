/** Общие помощники импорта демо-данных. */
import { Prisma, PrismaClient, type OrganizationKind, type AssignmentRole } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;

/** 'YYYY-MM-DD' → дата для колонки DATE (полночь UTC, чтобы не уехал день). */
export function day(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return new Date(`${s.slice(0, 10)}T00:00:00Z`);
}

/** 'YYYY-MM-DDTHH:MM' (время Москвы) → момент времени. */
export function moment(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s.length <= 16 ? `${s}:00+03:00` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** JSON-атрибуты: выкидываем пустые значения, пустой объект → NULL. */
export function attrs(o: Record<string, unknown>): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const clean = Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)),
  );
  return Object.keys(clean).length ? (clean as Prisma.InputJsonValue) : Prisma.DbNull;
}

/** Дописать ключи в direction.settings, не затирая остальные (наборы показателей, подписи). */
export async function mergeSettings(db: Tx, directionId: number, patch: Record<string, unknown>) {
  const d = await db.direction.findUniqueOrThrow({ where: { id: directionId }, select: { settings: true } });
  const cur = (d.settings ?? {}) as Record<string, unknown>;
  await db.direction.update({ where: { id: directionId }, data: { settings: { ...cur, ...patch } as Prisma.InputJsonValue } });
}

export async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

/** Сотрудник из демо-данных: пользователь без входа. Один человек — одна запись на все направления. */
export class People {
  private cache = new Map<string, number>();
  constructor(private readonly db: Tx) {}

  async get(fullName: string | null | undefined, extra: { position?: string | null; phone?: string | null; email?: string | null } = {}) {
    const name = text(fullName);
    if (!name) return null;
    const hit = this.cache.get(name);
    if (hit) return hit;
    const found = await this.db.user.findFirst({ where: { fullName: name, isExample: true }, select: { id: true } });
    const id =
      found?.id ??
      (
        await this.db.user.create({
          data: {
            fullName: name,
            position: text(extra.position),
            phone: text(extra.phone),
            email: text(extra.email),
            canLogin: false,
            mustChangePassword: true,
            isExample: true,
          },
        })
      ).id;
    this.cache.set(name, id);
    return id;
  }
}

/** Справочник организаций направления. */
export class Orgs {
  private cache = new Map<string, number>();
  constructor(
    private readonly db: Tx,
    private readonly directionId: number,
  ) {}

  async get(name: string | null | undefined, kind: OrganizationKind, isExample = false) {
    const n = text(name);
    if (!n) return null;
    const key = `${kind}|${n}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const o = await this.db.organization.upsert({
      where: { directionId_name_kind: { directionId: this.directionId, name: n, kind } },
      create: { directionId: this.directionId, name: n, kind, isExample },
      update: {},
    });
    this.cache.set(key, o.id);
    return o.id;
  }
}

export async function assign(db: Tx, siteId: number, userId: number | null, role: AssignmentRole) {
  if (!userId) return;
  await db.siteAssignment.upsert({
    where: { siteId_userId_role: { siteId, userId, role } },
    create: { siteId, userId, role },
    update: {},
  });
}

export async function member(
  db: Tx,
  directionId: number,
  userId: number | null,
  role: 'CURATOR' | 'EDITOR' | 'VIEWER',
  scope: 'ALL' | 'SECTIONS' | 'SITES' = 'ALL',
) {
  if (!userId) return;
  await db.directionMember.upsert({
    where: { directionId_userId: { directionId, userId } },
    create: { directionId, userId, role, scope },
    update: {},
  });
}

/** Удаляет всё содержимое направления (объекты, периоды, справочники, трекеры), кроме самих настроек и статусов. */
export async function wipeDirection(db: Tx, directionId: number) {
  await db.kpiSnapshot.deleteMany({ where: { directionId } });
  // центры затрат «Экономики» ссылаются на объекты и лоты (удаление ограничено) — удаляются вместе с направлением
  await db.econBudget.deleteMany({ where: { directionId } });
  await db.site.deleteMany({ where: { directionId } }); // каскадом: позиции, факт, отчёты, замечания, трекеры объекта
  await db.reportingPeriod.deleteMany({ where: { directionId } });
  await db.tracker.deleteMany({ where: { directionId } });
  await db.workType.deleteMany({ where: { directionId } });
  await db.workGroup.deleteMany({ where: { directionId } });
  await db.section.deleteMany({ where: { directionId } });
  await db.fieldDef.deleteMany({ where: { directionId } });
  await db.organization.deleteMany({ where: { directionId } });
  await db.directionMember.deleteMany({ where: { directionId, user: { isExample: true } } });
}

/** Удаляет демо-сотрудников, которые больше нигде не упоминаются. */
export async function cleanupExampleUsers(db: Tx) {
  const users = await db.user.findMany({
    where: { isExample: true, canLogin: false },
    select: {
      id: true,
      _count: { select: { memberships: true, siteAssignments: true, responsibleItems: true, enteredProgress: true, enteredReports: true } },
    },
  });
  const orphan = users.filter((u) => Object.values(u._count).every((n) => n === 0)).map((u) => u.id);
  if (orphan.length) await db.user.deleteMany({ where: { id: { in: orphan } } });
  return orphan.length;
}
