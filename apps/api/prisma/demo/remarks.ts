/**
 * Демо-замечания для наглядности (в исходном дашборде замечаний с жизненным циклом не было).
 * Генерируются детерминированно: на одних и тех же данных — одинаковый результат.
 * Даты отсчитываются от последней отчётной точки направления.
 */
import type { RemarkSeverity, RemarkStatus } from '@prisma/client';
import type { Tx } from './lib';

const TEXTS: Record<string, string[]> = {
  'Качество работ': [
    'Трещины в штукатурке фасада, требуется расшивка и повторное оштукатуривание',
    'Не выдержан уклон кровли у водосточной воронки — застаивается вода',
    'Сварные швы трубопровода не зачищены, нет протокола контроля',
    'Отслоение окрасочного слоя в лестничной клетке',
    'Не заделаны технологические отверстия в перекрытии',
    'Зазоры в примыканиях оконных блоков, монтажный шов не защищён',
  ],
  'Охрана труда и ТБ': [
    'Работы на высоте ведутся без страховочных поясов',
    'Не огорожен открытый котлован у тротуара',
    'На объекте нет журнала инструктажа',
  ],
  Документация: [
    'Нет исполнительной схемы на скрытые работы',
    'Не предоставлены сертификаты на утеплитель',
    'Акт освидетельствования скрытых работ без подписи технадзора',
  ],
  'Уборка и складирование': ['Строительный мусор складируется на газоне у подъезда', 'Не организована мойка колёс на выезде с площадки'],
  Сроки: ['Работы по позиции не начаты, срок начала прошёл', 'Материалы не завезены, работы стоят'],
};
const CATS = Object.keys(TEXTS);
const SEV: RemarkSeverity[] = ['LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'CRITICAL'];
const DAY = 86_400_000;

/** Простой генератор псевдослучайных чисел с зерном. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function importRemarks(db: Tx, directionId: number, count = 36) {
  const rnd = rng(directionId * 7919);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const last = await db.reportingPeriod.findFirst({ where: { directionId }, orderBy: { date: 'desc' } });
  const sites = await db.site.findMany({
    where: { directionId, isArchived: false },
    select: { id: true, workItems: { select: { id: true }, take: 20 }, assignments: { select: { userId: true, role: true } } },
  });
  if (!last || !sites.length) return 0;
  const curators = (await db.directionMember.findMany({ where: { directionId, role: 'CURATOR' }, select: { userId: true } })).map((m) => m.userId);
  const asOf = last.date.getTime() + 2 * DAY;

  let n = 0;
  for (let i = 0; i < count; i++) {
    const site = pick(sites);
    const cat = pick(CATS);
    const doers = site.assignments.filter((a) => a.role === 'RESPONSIBLE' || a.role === 'FOREMAN' || a.role === 'ENTRY').map((a) => a.userId);
    const people = doers.length ? doers : site.assignments.map((a) => a.userId);
    const author = curators.length ? pick(curators) : (site.assignments.find((a) => a.role === 'CURATOR')?.userId ?? null);
    const assignee = people.length ? pick(people) : null;
    const created = asOf - Math.floor(3 + rnd() * 50) * DAY - Math.floor(rnd() * 8) * 3600_000;
    const due = created + Math.floor(5 + rnd() * 20) * DAY;
    // чем старше замечание, тем вероятнее оно закрыто
    const age = (asOf - created) / DAY;
    const r = rnd();
    const status: RemarkStatus =
      age > 30 ? (r < 0.65 ? 'VERIFIED' : r < 0.75 ? 'REJECTED' : r < 0.85 ? 'RESOLVED' : 'IN_PROGRESS') : r < 0.35 ? 'OPEN' : r < 0.6 ? 'IN_PROGRESS' : r < 0.8 ? 'RESOLVED' : 'VERIFIED';
    const t1 = created + Math.floor(1 + rnd() * 3) * DAY;
    const t2 = Math.min(asOf - DAY, t1 + Math.floor(2 + rnd() * 10) * DAY);
    const t3 = Math.min(asOf - 3600_000, t2 + Math.floor(1 + rnd() * 4) * DAY);
    const closed = status === 'VERIFIED' || status === 'REJECTED';
    n++;
    await db.remark.create({
      data: {
        directionId,
        num: n,
        siteId: site.id,
        workItemId: site.workItems.length && rnd() < 0.5 ? pick(site.workItems).id : null,
        text: pick(TEXTS[cat]),
        category: cat,
        severity: pick(SEV),
        status,
        dueDate: new Date(new Date(due).toISOString().slice(0, 10) + 'T00:00:00Z'),
        authorId: author,
        assigneeId: assignee,
        resolvedById: closed ? author : null,
        resolvedAt: closed ? new Date(t3) : null,
        isExample: true,
        createdAt: new Date(created),
        events: {
          create: [
            { kind: 'CREATE', toStatus: 'OPEN', authorId: author, createdAt: new Date(created) },
            ...(status !== 'OPEN' && status !== 'REJECTED' ? [{ kind: 'STATUS', fromStatus: 'OPEN' as const, toStatus: 'IN_PROGRESS' as const, authorId: assignee, createdAt: new Date(t1) }] : []),
            ...(status === 'RESOLVED' || status === 'VERIFIED'
              ? [{ kind: 'STATUS', fromStatus: 'IN_PROGRESS' as const, toStatus: 'RESOLVED' as const, text: 'Устранено, прошу проверить', authorId: assignee, createdAt: new Date(t2) }]
              : []),
            ...(status === 'VERIFIED' ? [{ kind: 'STATUS', fromStatus: 'RESOLVED' as const, toStatus: 'VERIFIED' as const, text: 'Проверено на месте, принято', authorId: author, createdAt: new Date(t3) }] : []),
            ...(status === 'REJECTED' ? [{ kind: 'STATUS', fromStatus: 'OPEN' as const, toStatus: 'REJECTED' as const, text: 'Выставлено ошибочно: работы по другому договору', authorId: author, createdAt: new Date(t3) }] : []),
          ],
        },
      },
    });
  }
  return n;
}
