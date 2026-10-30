import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';
import { ObjectsMapService } from './map.service';

// Запись тестовых фикстур разрешена только в явно указанную локальную тестовую БД.
const url = process.env.MAP_TEST_DATABASE_URL;
const db = url ? new PrismaService({ datasourceUrl: url }) : null;
const admin: AuthUser = { id: -1, login: 'map-test', fullName: 'Map test', globalRole: 'ADMIN', mustChangePassword: false, sessionId: -1 };
describe.skipIf(!url)('единая карта: интеграция с БД и область доступа', () => {
  const suffix = Date.now().toString(36);
  let ids: number[] = [], users: number[] = [], siteId: number, sectionId: number, workId: number;
  let service: ObjectsMapService, kpi: KpiService;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !/(_qa|_test)$/.test(target.pathname)) throw new Error('Нужна локальная БД с суффиксом _qa или _test');
    for (const [i, active] of [true, true, false].entries()) {
      const d = await db!.direction.create({ data: { code: `map_${suffix}_${i}`, name: `Map test ${i}`, shortName: `Map ${i}`, isActive: active,
        color: i === 0 ? '#123456' : null, periodKind: 'DAY', progressMethod: 'SIMPLE_AVERAGE', planMethod: 'NONE' } });
      ids.push(d.id);
    }
    for (const name of ['Ответственный 1', 'Ответственный 2', 'Куратор', 'Наблюдатель']) {
      const u = await db!.user.create({ data: { fullName: `${name} ${suffix}`, position: name === 'Ответственный 1' ? 'Инженер' : null, phone: name === 'Ответственный 1' ? '+79990000001' : null } });
      users.push(u.id);
    }
    const section = await db!.section.create({ data: { directionId: ids[0], code: 'lot', name: 'Лот' } }); sectionId = section.id;
    const work = await db!.workType.create({ data: { directionId: ids[0], code: 'work', name: 'Работа' } }); workId = work.id;
    const s = await db!.site.create({ data: { directionId: ids[0], code: 'new', name: 'Без отчётных точек', sectionId, lat: 55.75, lon: 37.62,
      workItems: { create: [{ code: 'w1', workTypeId: workId }, { code: 'w2', workTypeId: workId }] },
      assignments: { create: [{ role: 'RESPONSIBLE', userId: users[0] }, { role: 'RESPONSIBLE', userId: users[1] }, { role: 'CURATOR', userId: users[2] }, { role: 'ENTRY', userId: users[2] }] } } });
    siteId = s.id;
    await db!.site.create({ data: { directionId: ids[0], code: 'archived', name: 'Архив', isArchived: true } });
    await db!.site.create({ data: { directionId: ids[1], code: 'private', name: 'Чужой объект' } });
    await db!.site.create({ data: { directionId: ids[2], code: 'inactive', name: 'Выключенное направление' } });
    await db!.directionMember.create({ data: { directionId: ids[0], userId: users[3], role: 'VIEWER' } });
    kpi = new KpiService(db!, new AccessService(db!)); service = new ObjectsMapService(db!, kpi);
  });
  afterAll(async () => {
    if (!db) return;
    if (ids.length) await db.direction.deleteMany({ where: { id: { in: ids } } });
    if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });
  it('новое направление без периодов сохраняет объект, связи работ и неизвестные ресурсы', async () => {
    const data = await service.list(admin); const s = data.sites.find((s) => s.id === siteId)!;
    expect(s).toMatchObject({ name: 'Без отчётных точек', people: null, tech: null, section: { id: sectionId }, workTypeIds: [workId] });
    expect(data.sites.some((s) => s.name === 'Архив')).toBe(false);
    expect(data.directions.find((d) => d.id === ids[0])?.color).toBe('#123456');
    expect(data.directions.some((d) => d.id === ids[2])).toBe(false);
  });
  it('возвращает только ответственных объекта со всеми доступными контактами', async () => {
    const s = (await service.list(admin)).sites.find((s) => s.id === siteId)!;
    expect(s?.responsibles.map((r) => r.id)).toEqual(users.slice(0, 2));
    expect(s.responsibles[0]).toMatchObject({ position: 'Инженер', phone: '+79990000001' });
    expect(s.responsibles[1]).toMatchObject({ position: null, phone: null });
  });
  it.each(['VIEWER', 'EDITOR', 'CURATOR'] as const)('ограничивает карту членством направления для %s', async (role) => {
    await db!.directionMember.update({ where: { directionId_userId: { directionId: ids[0], userId: users[3] } }, data: { role } });
    const data = await service.list({ ...admin, id: users[3], globalRole: 'USER' });
    expect(data.directions.map((d) => d.id)).toEqual([ids[0]]);
    expect(data.sites.map((s) => s.id)).toEqual([siteId]);
    expect(data.workTypes.map((w) => w.id)).toEqual([workId]);
  });
  it('пользователь без назначений получает пустую выборку, руководство видит активные направления', async () => {
    expect(await service.list({ ...admin, id: users[0], globalRole: 'USER' })).toEqual({ directions: [], sites: [], workTypes: [] });
    const data = await service.list({ ...admin, globalRole: 'MANAGEMENT' });
    expect(data.directions.filter((d) => ids.includes(d.id)).map((d) => d.id)).toEqual(ids.slice(0, 2));
  });
  it('ресурсы совпадают с исходными KPI, а изменение цвета не скрывается кешем', async () => {
    const period = await db!.reportingPeriod.create({ data: { directionId: ids[0], date: new Date('2026-01-15T00:00:00Z') } });
    await db!.siteReport.create({ data: { siteId, periodId: period.id, workers: 7, machines: 0 } });
    kpi.invalidate(ids[0]);
    const data = await service.list(admin);
    expect(data.sites.find((s) => s.id === siteId)).toMatchObject({ people: 7, tech: 0 });
    for (const d of data.directions) {
      const rows = await kpi.sites(admin, d.code);
      for (const s of rows) expect(data.sites.find((m) => m.id === s.id && m.directionCode === d.code)).toMatchObject({ people: s.people, tech: s.tech });
    }
    await db!.direction.update({ where: { id: ids[0] }, data: { color: '#654321' } });
    expect((await service.list(admin)).directions.find((d) => d.id === ids[0])?.color).toBe('#654321');
  });
});
