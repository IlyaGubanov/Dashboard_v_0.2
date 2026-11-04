/**
 * Демо-парк РЭБ: 250 единиц техники, включая малую механизацию, распределение по объектам и техника по видам в отчётах.
 * Данные ответственных и РЭБ намеренно расходятся на части объектов — на них видна сверка.
 *
 * Запускается из import.ts. Демо-записи узнаются по служебному пакету импорта и удаляются только они;
 * техника, внесённая вручную, не затрагивается. Показатели сводки не меняются: итоги отчётов остаются прежними.
 */
import { createHash } from 'node:crypto';
import { MACHINERY_KINDS } from '@mvs/shared';
import { People, type Tx, chunked, day } from './lib';

const BATCH = 'demo-fleet';
const CLEARED = 'fleet';

/** Сколько единиц каждого вида; всего 250. */
const PARK: Record<string, number> = {
  Экскаватор: 22, 'Экскаватор-погрузчик': 18, 'Мини-экскаватор': 10, Бульдозер: 6, 'Фронтальный погрузчик': 8,
  Автокран: 8, Автовышка: 5, Манипулятор: 9, 'Телескопический погрузчик': 4,
  Самосвал: 28, 'Бортовой грузовик': 10, 'Тягач с тралом': 3, Микроавтобус: 7,
  Каток: 7, Автогрейдер: 2, Асфальтоукладчик: 2, 'Поливомоечная машина': 3,
  Илосос: 6, 'Каналопромывочная машина': 5, 'ГНБ-установка': 3, Автобетоносмеситель: 6, Автобетононасос: 2,
  Виброплита: 14, Вибротрамбовка: 10, Мотопомпа: 12, 'Дизель-генератор': 14, Компрессор: 6, Бетономешалка: 8, 'Отбойный молоток': 8, 'Глубинный вибратор': 4,
};
const BRANDS: Record<string, string[]> = {
  Экскаватор: ['Hitachi ZX200', 'Komatsu PC220', 'Hyundai R220'], 'Экскаватор-погрузчик': ['JCB 3CX', 'Volvo BL71', 'Terex TLB'], 'Мини-экскаватор': ['Bobcat E35', 'Kubota U35'], Бульдозер: ['ЧЕТРА Т11', 'Shantui SD16'], 'Фронтальный погрузчик': ['SDLG L956', 'Amkodor 333'],
  Автокран: ['Галичанин КС-55713', 'Клинцы КС-55713'], Автовышка: ['ВИПО-28', 'Socage 28'], Манипулятор: ['КамАЗ-65115 Fassi', 'Isuzu Giga'], 'Телескопический погрузчик': ['JCB 535', 'Manitou MT1440'],
  Самосвал: ['КамАЗ-6520', 'Shacman SX3258', 'Howo ZZ3327'], 'Бортовой грузовик': ['ГАЗон Next', 'КамАЗ-43118'], 'Тягач с тралом': ['Volvo FH', 'КамАЗ-65116'], Микроавтобус: ['ГАЗель NEXT', 'Ford Transit'],
  Каток: ['Bomag BW 120', 'Hamm HD 12'], Автогрейдер: ['ДЗ-98', 'XCMG GR165'], Асфальтоукладчик: ['Vogele 1800', 'Dynapac F1800'], 'Поливомоечная машина': ['КО-713', 'МКДУ-13'],
  Илосос: ['КО-510', 'КО-530'], 'Каналопромывочная машина': ['КО-564', 'MTS DS'], 'ГНБ-установка': ['Vermeer D20x22', 'XCMG XZ200'], Автобетоносмеситель: ['КамАЗ 581453', 'Shacman 58146'], Автобетононасос: ['Putzmeister M36', 'Zoomlion 38X'],
  Виброплита: ['Wacker WP1550', 'Mikasa MVC-F60'], Вибротрамбовка: ['Wacker BS60', 'Mikasa MTX-60'], Мотопомпа: ['Honda WB30', 'Koshin SEH-50'], 'Дизель-генератор': ['FUBAG DS 11000', 'SDMO 6000', 'Вепрь АДП 10'], Компрессор: ['Atlas Copco XAS 88', 'ЗИФ ПВ-5'], Бетономешалка: ['Лебедянь СБР-500', 'Zitrek Limex'], 'Отбойный молоток': ['Makita HM1213', 'Bosch GSH 11'], 'Глубинный вибратор': ['Wacker IE 45', 'Энкор ИВ-65'],
};
/** С чего обычно начинают набор техники на объекте — порядок важнее случайного выбора: так списки выглядят правдоподобно. */
const PROFILES: Record<string, string[]> = {
  schools: ['Автокран', 'Манипулятор', 'Самосвал', 'Экскаватор-погрузчик', 'Автовышка', 'Дизель-генератор', 'Бетономешалка', 'Компрессор', 'Бортовой грузовик', 'Отбойный молоток'],
  networks: ['Экскаватор', 'Самосвал', 'Экскаватор-погрузчик', 'Мотопомпа', 'Виброплита', 'Дизель-генератор', 'Манипулятор', 'Илосос', 'Вибротрамбовка', 'Каналопромывочная машина', 'ГНБ-установка', 'Автокран', 'Каток', 'Мини-экскаватор', 'Бульдозер', 'Фронтальный погрузчик', 'Автобетоносмеситель', 'Бортовой грузовик', 'Компрессор', 'Тягач с тралом'],
  mkd: ['Автовышка', 'Манипулятор', 'Самосвал', 'Бетономешалка', 'Дизель-генератор'],
};
const RESPONSIBLE = ['Орлов И. С.', 'Белова Н. П.', 'Титов А. Г.', 'Зайцева О. В.'];
const LETTERS = 'АВЕКМНОРСТУХ';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const categoryOf = (kind: string) => MACHINERY_KINDS.find((c) => (c.kinds as readonly string[]).includes(kind))!.category;
const isSmall = (kind: string) => categoryOf(kind) === 'Малая механизация';
/** Предсказуемая «случайность»: при перезагрузке демо получается тот же парк. */
function random(seed: number) {
  let v = seed;
  return (n: number) => {
    v = (v * 1664525 + 1013904223) >>> 0;
    return v % n;
  };
}

/** Удаляет только демо-записи парка. Нужно до удаления объектов: назначения ссылаются на них. */
export async function clearDemoFleet(db: Tx) {
  const batches = await db.fleetImportBatch.findMany({ where: { fileName: BATCH }, select: { id: true } });
  const ids = batches.map((b) => b.id);
  if (!ids.length) return 0;
  await db.fleetAllocation.deleteMany({ where: { assignment: { importBatchId: { in: ids } } } });
  await db.fleetAssignment.deleteMany({ where: { importBatchId: { in: ids } } });
  await db.fleetDowntime.deleteMany({ where: { importBatchId: { in: ids } } });
  const { count } = await db.fleetVehicle.deleteMany({ where: { importBatchId: { in: ids } } });
  await db.fleetImportBatch.deleteMany({ where: { id: { in: ids } } });
  // разбивка из демо; внесённая вручную живёт в отчётах с источником MANUAL
  await db.siteMachinery.deleteMany({ where: { report: { source: { not: 'MANUAL' } } } });
  return count;
}

export async function hasDemoFleet(db: Tx) {
  return (await db.fleetImportBatch.count({ where: { fileName: BATCH } })) > 0;
}
export const FLEET_CLEARED_KEY = CLEARED;

export async function importFleetDemo(db: Tx): Promise<Record<string, number>> {
  const registry = await db.fleetRegistry.findUnique({ where: { code: 'reb' } });
  if (!registry) throw new Error('Реестр РЭБ не найден — сначала выполните npm run db:seed');
  const author = await db.user.findFirst({ where: { globalRole: 'ADMIN' }, orderBy: { id: 'asc' }, select: { id: true } });
  if (!author) throw new Error('Нет администратора — сначала выполните npm run db:seed');
  const people = new People(db);
  const dispatcher = (await people.get('Кузнецов А. В.', { position: 'Диспетчер РЭБ' }))!;
  const mechanic = (await people.get('Мельник Р. Д.', { position: 'Главный механик РЭБ' }))!;
  const responsible = await Promise.all(RESPONSIBLE.map((n) => people.get(n, { position: 'Ответственный за ввод данных' })));
  const batch = await db.fleetImportBatch.create({ data: { directionId: registry.id, createdById: author.id, fileName: BATCH, fileHash: sha(BATCH), kind: 'vehicles', mapping: {}, importedRows: 0, skippedRows: 0 } });

  // 1. Парк
  const rnd = random(20261105);
  const vehicles: { id?: number; kind: string; n: number }[] = [];
  let n = 0;
  const rows = Object.entries(PARK).flatMap(([kind, count]) =>
    Array.from({ length: count }, () => {
      n++;
      const small = isSmall(kind);
      const brand = BRANDS[kind][rnd(BRANDS[kind].length)];
      const rented = rnd(100) < 22;
      const [b, ...m] = brand.split(' ');
      vehicles.push({ kind, n });
      return {
        directionId: registry.id,
        importBatchId: batch.id,
        sourceKey: sha(`${BATCH}:vehicle:${n}`),
        createdById: mechanic,
        updatedById: mechanic,
        inventoryNumber: `РЭБ-${String(n).padStart(4, '0')}`,
        plate: small ? null : `${LETTERS[rnd(12)]}${100 + rnd(899)}${LETTERS[rnd(12)]}${LETTERS[rnd(12)]} ${[77, 97, 99, 177, 197, 777][rnd(6)]}`,
        name: `${kind} ${brand}`,
        kind,
        category: categoryOf(kind),
        brand: b,
        model: m.join(' ') || null,
        ownership: rented ? 'RENTED' : 'OWN',
        rentStart: rented ? day('2026-03-01') : null,
        rentEnd: rented ? day('2027-03-01') : null,
        technicalState: 'OK',
        usageState: 'RESERVE',
      };
    }),
  );
  await chunked(rows, 100, (part) => db.fleetVehicle.createMany({ data: part }));
  const saved = await db.fleetVehicle.findMany({ where: { importBatchId: batch.id }, select: { id: true, inventoryNumber: true, kind: true } });
  const byInventory = new Map(saved.map((v) => [v.inventoryNumber, v.id]));
  for (const v of vehicles) v.id = byInventory.get(`РЭБ-${String(v.n).padStart(4, '0')}`);

  // 2. Неисправная и ремонтируемая техника — на объекты не выходит
  const free = new Map<string, number[]>();
  const stops: number[] = [];
  for (const v of vehicles) {
    if (rnd(100) < 6) stops.push(v.id!);
    else free.set(v.kind, [...(free.get(v.kind) ?? []), v.id!]);
  }
  await chunked(stops, 100, (ids) => db.fleetVehicle.updateMany({ where: { id: { in: ids } }, data: { technicalState: 'REPAIR', usageState: 'UNNEEDED' } }));
  await chunked(stops, 100, (ids) =>
    db.fleetDowntime.createMany({
      data: ids.map((vehicleId, i) => ({ directionId: registry.id, importBatchId: batch.id, sourceKey: sha(`${BATCH}:downtime:${vehicleId}`), createdById: mechanic, updatedById: mechanic, vehicleId, reason: 'REPAIR', startDate: day('2026-10-05')!, expectedReturn: day(i % 2 ? '2026-11-20' : '2026-12-10'), employeeId: mechanic, comment: 'Плановый ремонт' })),
    }),
  );
  const take = (kind: string) => free.get(kind)?.shift() ?? null;

  /** Берёт n свободных машин, начиная с типичных для объекта видов; когда их нет — любой свободный вид. */
  const pick = (profile: string[], count: number, start: number) => {
    const out: { kind: string; id: number }[] = [];
    for (let i = 0; out.length < count && i < count * 40; i++) {
      const kind = profile[(start + i) % profile.length];
      const id = take(kind);
      if (id) out.push({ kind, id });
    }
    while (out.length < count) {
      const kind = [...free.entries()].find(([, ids]) => ids.length)?.[0];
      if (!kind) break;
      out.push({ kind, id: take(kind)! });
    }
    return out;
  };
  const anyFree = (except: string) => [...free.entries()].find(([k, ids]) => k !== except && ids.length)?.[0] ?? null;

  // 3. Распределение и разбивка отчётов по объектам
  const assignments: { vehicleId: number; targetDirectionId: number; siteId: number; start: string }[] = [];
  const lines: { reportId: number; kind: string; qty: number }[] = [];
  const stats = { match: 0, diff: 0, kinds: 0, onlyReport: 0, onlyFleet: 0 };
  const dirs = await db.direction.findMany({ where: { code: { in: ['schools', 'networks', 'mkd'] }, isActive: true }, select: { id: true, code: true } });
  dirs.sort((a, b) => ['schools', 'networks', 'mkd'].indexOf(a.code) - ['schools', 'networks', 'mkd'].indexOf(b.code));
  for (const dir of dirs) {
    const last = await db.reportingPeriod.findFirst({ where: { directionId: dir.id, reports: { some: { OR: [{ machines: { gt: 0 } }, { machinesBlocked: { gt: 0 } }] } } }, orderBy: { date: 'desc' }, select: { id: true, date: true } })
      ?? (await db.reportingPeriod.findFirst({ where: { directionId: dir.id }, orderBy: { date: 'desc' }, select: { id: true, date: true } }));
    if (!last) continue;
    const start = '2026-09-01';
    const reports = await db.siteReport.findMany({ where: { periodId: last.id, source: { not: 'MANUAL' }, site: { isArchived: false } }, orderBy: { siteId: 'asc' }, select: { id: true, siteId: true, machines: true, machinesBlocked: true } });
    const profile = PROFILES[dir.code];
    let index = 0;
    for (const r of reports) {
      const tech = (r.machines ?? 0) + (r.machinesBlocked ?? 0);
      if (!tech) continue;
      const i = index++;
      const got = pick(profile, tech, i);
      if (got.length < tech) continue;
      // разбивка ответственного — всегда на полный итог отчёта
      const counts = new Map<string, number>();
      for (const v of got) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
      for (const [kind, qty] of counts) lines.push({ reportId: r.id, kind, qty });
      await db.siteReport.update({ where: { id: r.id }, data: { enteredById: responsible[i % responsible.length], updatedById: responsible[i % responsible.length] } });
      // сценарий на объект: примерно половина сходится, остальные показывают разные случаи
      const scenario = dir.code === 'schools' ? ['diff+', 'match', 'kinds', 'diff-'][i % 4] : ['match', 'match', 'diff-', 'match', 'kinds', 'diff+', 'match', 'onlyReport', 'match', 'diff-'][i % 10];
      let toFleet = got;
      if (scenario === 'onlyReport') {
        toFleet = [];
        stats.onlyReport++;
      } else if (scenario === 'diff-' && got.length > 1) {
        toFleet = got.slice(0, Math.max(1, got.length - (got.length > 4 ? 2 : 1)));
        stats.diff++;
      } else if (scenario === 'diff+') {
        toFleet = [...got, ...pick(profile, 1 + (i % 2), i + 3)];
        stats.diff++;
      } else if (scenario === 'kinds') {
        const other = anyFree(got[0].kind);
        const id = other ? take(other) : null;
        toFleet = other && id ? [{ kind: other, id }, ...got.slice(1)] : got;
        stats[other && id ? 'kinds' : 'match']++;
      } else stats.match++;
      for (const v of toFleet) assignments.push({ vehicleId: v.id, targetDirectionId: dir.id, siteId: r.siteId, start });
    }
    // МКД: ответственные технику не вносят — на нескольких объектах она есть только в РЭБ
    if (dir.code === 'mkd') {
      const sites = await db.site.findMany({ where: { directionId: dir.id, isArchived: false }, orderBy: { id: 'asc' }, take: 8, select: { id: true } });
      sites.forEach((s, i) => {
        const got = pick(profile, 1 + (i % 3), i);
        for (const v of got) assignments.push({ vehicleId: v.id, targetDirectionId: dir.id, siteId: s.id, start });
        if (got.length) stats.onlyFleet++;
      });
    }
  }
  await chunked(lines, 200, (part) => db.siteMachinery.createMany({ data: part, skipDuplicates: true }));
  await chunked(assignments, 200, (part) =>
    db.fleetAssignment.createMany({
      data: part.map((a, i) => ({ directionId: registry.id, importBatchId: batch.id, sourceKey: sha(`${BATCH}:assignment:${a.vehicleId}`), createdById: i % 3 ? dispatcher : mechanic, updatedById: i % 3 ? dispatcher : mechanic, vehicleId: a.vehicleId, targetDirectionId: a.targetDirectionId, siteId: a.siteId, startDate: day(a.start)! })),
    }),
  );
  // задействованная техника — ACTIVE; часть остального парка — не распределена, а не в резерве
  await chunked(assignments.map((a) => a.vehicleId), 200, (ids) => db.fleetVehicle.updateMany({ where: { id: { in: ids } }, data: { usageState: 'ACTIVE' } }));
  const idle = vehicles.filter((v) => v.n % 3 === 0).map((v) => v.id!);
  await chunked(idle, 200, (ids) => db.fleetVehicle.updateMany({ where: { id: { in: ids }, usageState: 'RESERVE' }, data: { usageState: 'UNASSIGNED' } }));
  await db.fleetImportBatch.update({ where: { id: batch.id }, data: { importedRows: rows.length } });
  await db.auditLog.create({ data: { action: 'IMPORT', entity: 'fleet_registry', entityId: String(registry.id), comment: `Загружен демо-парк РЭБ: техники ${rows.length}, назначений ${assignments.length}` } });
  return { vehicles: rows.length, repair: stops.length, assignments: assignments.length, ...stats };
}
