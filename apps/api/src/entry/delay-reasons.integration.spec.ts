import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { delayReasonSettingsSchema } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { KpiService } from '../kpi/kpi.service';
import { DirectionsAdminService } from '../admin/directions-admin.service';
import { ManageService } from '../manage/manage.service';
import { DelayReasonsService } from './delay-reasons.service';
import { EntryService } from './entry.service';
import type { AuthUser } from '../common/request';

const url = process.env.DELAY_TEST_DATABASE_URL;
describe.skipIf(!url)('причины отставания: реальная MySQL', () => {
  const db = new PrismaService({ datasourceUrl: url });
  const access = new AccessService(db), audit = new AuditService(db), kpi = new KpiService(db, access);
  const reasons = new DelayReasonsService(db, access, audit), entry = new EntryService(db, audit, access, kpi, reasons);
  const constructor = new DirectionsAdminService(db, audit, kpi);
  let directionId: number, itemId: number, siteId: number, typeId: number, periodId: number, nextId: number;
  let admin: AuthUser, viewer: AuthUser, other: AuthUser;
  const code = `delay_qa_${Date.now().toString(36)}`;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Только локальная тестовая БД');
    const users = await Promise.all(['Администратор', 'Иванов Иван Иванович', 'Петров Пётр Петрович'].map(fullName => db.user.create({ data: { fullName } })));
    [admin, viewer, other] = users.map((u, i) => ({ id: u.id, login: 'qa', fullName: u.fullName, globalRole: i === 0 ? 'ADMIN' : 'USER', sessionId: -1, mustChangePassword: false, hiddenSections: [], deniedFeatures: [] } as AuthUser));
    const d = await db.direction.create({ data: { code, name: 'Проверка причин', shortName: 'Тест', periodKind: 'DAY', progressMethod: 'SIMPLE_AVERAGE', planMethod: 'LINEAR_ITEM_DATES', isReadonly: true,
      members: { create: [{ userId: viewer.id, role: 'VIEWER' }, { userId: other.id, role: 'EDITOR', scope: 'ALL' }] } } }); directionId = d.id;
    typeId = (await db.workType.create({ data: { directionId, code: 'roof', name: 'Кровля' } })).id;
    const site = await db.site.create({ data: { directionId, code: 'a', name: 'Школа', assignments: { create: { userId: viewer.id, role: 'RESPONSIBLE' } },
      workItems: { create: { workTypeId: typeId, code: 'roof', planStart: new Date('2026-01-01'), planEnd: new Date('2026-01-02'), planQty: 100 } } }, include: { workItems: true } });
    siteId = site.id; itemId = site.workItems[0].id;
    periodId = (await db.reportingPeriod.create({ data: { directionId, date: new Date('2026-01-03') } })).id;
    nextId = (await db.reportingPeriod.create({ data: { directionId, date: new Date('2026-01-04') } })).id;
    await db.progressEntry.create({ data: { workItemId: itemId, periodId, factQty: 20, source: 'IMPORT' } });
  });
  beforeEach(async () => {
    await db.auditLog.deleteMany({ where: { directionId } });
    await db.delayReason.deleteMany({ where: { period: { directionId } } });
    await db.reportingPeriod.updateMany({ where: { directionId }, data: { status: 'OPEN' } });
    await db.workType.update({ where: { id: typeId }, data: { isArchived: false } });
    await db.direction.update({ where: { id: directionId }, data: { settings: {} } });
  });
  afterAll(async () => {
    if (directionId) await db.direction.delete({ where: { id: directionId } });
    if (admin) await db.user.deleteMany({ where: { id: { in: [admin.id, viewer.id, other.id] } } });
    await db.$disconnect();
  });
  it('показывает ФИО ответственного объекта и даёт ему отдельный ввод при readonly', async () => {
    const row = (await reasons.sheet(viewer, code, { periodId })).rows[0];
    expect(row).toMatchObject({ workItemId: itemId, responsibles: [{ id: viewer.id, fullName: viewer.fullName }], canEdit: true, delayed: true });
    await reasons.save(viewer, code, periodId, itemId, { text: 'Нет материалов', version: 0 }, null);
    expect(await db.progressEntry.findUniqueOrThrow({ where: { workItemId_periodId: { workItemId: itemId, periodId } } })).toMatchObject({ source: 'IMPORT', version: 1 });
  });
  it('не позволяет неназначенному редактору и чужому направлению изменять причину', async () => {
    await reasons.configure(admin, code, delayReasonSettingsSchema.parse({ defaultResponsibleIds: [viewer.id] }), null);
    await expect(reasons.save(other, code, periodId, itemId, { text: 'Подмена', version: 0 }, null)).rejects.toThrow('Заполнение доступно');
    await expect(reasons.configure(viewer, code, delayReasonSettingsSchema.parse({}), null)).rejects.toThrow('администратору');
    await expect(reasons.sheet(viewer, 'schools', { periodId })).rejects.toThrow();
  });
  it('сохраняет историю, переносит причину по датам и защищает версию', async () => {
    await reasons.save(admin, code, periodId, itemId, { text: 'Нет материалов', version: 0 }, null);
    expect((await reasons.sheet(admin, code, { periodId: nextId })).rows[0]).toMatchObject({ text: 'Нет материалов', version: 0, from: '2026-01-03' });
    await reasons.save(admin, code, nextId, itemId, { text: 'Ожидаем доставку', version: 0 }, null);
    expect((await reasons.sheet(admin, code, { date: '2026-01-03' })).rows[0].text).toBe('Нет материалов');
    await expect(reasons.save(admin, code, nextId, itemId, { text: 'Затереть', version: 0 }, null)).rejects.toThrow('уже изменена');
    expect(await db.auditLog.count({ where: { directionId, entity: 'delay_reason' } })).toBe(2);
  });
  it('две одновременные правки не теряют данные', async () => {
    const results = await Promise.allSettled(['Один', 'Два'].map(text => reasons.save(admin, code, periodId, itemId, { text, version: 0 }, null)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.delayReason.count({ where: { workItemId: itemId, periodId } })).toBe(1);
  });
  it('проверяет обязательность при сохранении и закрытии точки', async () => {
    await reasons.configure(admin, code, delayReasonSettingsSchema.parse({ requireWhenDelayed: true }), null);
    await expect(reasons.save(admin, code, periodId, itemId, { text: '', version: 0 }, null)).rejects.toThrow('Укажите причину');
    await expect(entry.setPeriodStatus(admin, code, periodId, 'CLOSED', undefined, null)).rejects.toThrow('Заполните причины');
    await reasons.save(admin, code, periodId, itemId, { text: 'Причина указана', version: 0 }, null);
    await entry.setPeriodStatus(admin, code, periodId, 'CLOSED', undefined, null);
    expect((await reasons.sheet(viewer, code, { periodId })).rows[0].canEdit).toBe(false);
    await expect(reasons.save(viewer, code, periodId, itemId, { text: 'Поздняя правка', version: 1 }, null)).rejects.toThrow();
  });
  it('архивированный вид работ не блокирует последующее сохранение настроек', async () => {
    const settings = delayReasonSettingsSchema.parse({ workTypes: [{ workTypeId: typeId, responsibleIds: [viewer.id] }] });
    await reasons.configure(admin, code, settings, null);
    await db.workType.update({ where: { id: typeId }, data: { isArchived: true } });
    const options = await reasons.admin(admin, code);
    expect(options.workTypes.some(w => w.id === typeId)).toBe(true);
    await expect(reasons.configure(admin, code, { ...options.settings, allowCuratorEdit: false }, null)).resolves.toEqual({ ok: true });
  });
  it('сохранение другой настройки направления не стирает назначения, изменённые после чтения', async () => {
    const original = (constructor as any).byCode.bind(constructor);
    const hook = vi.spyOn(constructor as any, 'byCode').mockImplementation(async (...args: unknown[]) => {
      const d = await original(...args);
      await reasons.configure(admin, code, delayReasonSettingsSchema.parse({ defaultResponsibleIds: [viewer.id] }), null);
      return d;
    });
    try { await constructor.saveTiles(admin, code, [], null); } finally { hook.mockRestore(); }
    expect((await reasons.admin(admin, code)).settings.defaultResponsibleIds).toEqual([viewer.id]);
  });
  it('архивирование работы без факта сохраняет уже заполненную причину', async () => {
    const extra = await db.workItem.create({ data: { siteId, workTypeId: typeId, code: 'no-progress' } });
    await reasons.save(admin, code, periodId, extra.id, { text: 'Доступ на объект ограничен', version: 0 }, null);
    const manage = new ManageService(db, audit, access, kpi);
    await manage.archiveItem(admin, code, extra.id, true, null);
    expect(await db.workItem.findUnique({ where: { id: extra.id } })).toMatchObject({ isArchived: true });
    expect(await db.delayReason.count({ where: { workItemId: extra.id } })).toBe(1);
    await manage.archiveItem(admin, code, extra.id, false, null);
    expect((await reasons.sheet(admin, code, { periodId })).rows.find(r => r.workItemId === extra.id)?.text).toBe('Доступ на объект ограничен');
    await db.workItem.delete({ where: { id: extra.id } });
  });
  it('исторический REPORT выбирает те же объекты, что лист ввода, без переноса между программами', async () => {
    const section = await db.section.create({ data: { directionId, code: 'b', name: 'Программа Б' } });
    await db.site.update({ where: { id: siteId }, data: { sectionId: section.id } });
    await db.direction.update({ where: { id: directionId }, data: { periodKind: 'REPORT', settings: { delayReasons: delayReasonSettingsSchema.parse({ requireWhenDelayed: true }) } } });
    await db.reportingPeriod.update({ where: { id: periodId }, data: { program: 'a' } });
    await db.reportingPeriod.update({ where: { id: nextId }, data: { program: 'b', date: new Date('2026-01-02') } });
    await db.siteReport.create({ data: { siteId, periodId, source: 'IMPORT' } });
    expect((await entry.sheet(admin, code, periodId)).sites.some(s => s.id === siteId)).toBe(true);
    expect((await reasons.sheet(admin, code, { periodId })).rows.some(r => r.workItemId === itemId)).toBe(true);
    await expect(entry.setPeriodStatus(admin, code, periodId, 'CLOSED', undefined, null)).rejects.toThrow('Заполните причины');
    await reasons.save(admin, code, periodId, itemId, { text: 'Историческая причина программы А', version: 0 }, null);
    expect((await reasons.sheet(admin, code, { periodId })).rows[0].text).toBe('Историческая причина программы А');
    expect((await reasons.sheet(admin, code)).rows[0]).toMatchObject({ program: 'b', text: '' });
  });
  it('очистка демо-данных сохраняет направление, где вручную заполнена только причина', async () => {
    const real = await db.direction.findUniqueOrThrow({ where: { code: 'schools' } });
    const previous = await db.appSetting.findUnique({ where: { key: 'demo.cleared' } });
    const fixture = await db.direction.create({ data: { code: `qa_reason_${Date.now().toString(36)}`, name: 'Защита причины', shortName: 'Тест', periodKind: 'DAY', progressMethod: 'SIMPLE_AVERAGE', planMethod: 'NONE' } });
    const type = await db.workType.create({ data: { directionId: fixture.id, code: 'work', name: 'Работа' } });
    const site = await db.site.create({ data: { directionId: fixture.id, code: 'site', name: 'Объект', workItems: { create: { code: 'work', workTypeId: type.id } } }, include: { workItems: true } });
    const period = await db.reportingPeriod.create({ data: { directionId: fixture.id, date: new Date('2026-01-01') } });
    const reason = await db.delayReason.create({ data: { workItemId: site.workItems[0].id, periodId: period.id, text: 'Внесено ответственным' } });
    try {
      await db.direction.update({ where: { id: real.id }, data: { code: `qa_saved_${Date.now().toString(36)}` } });
      await db.direction.update({ where: { id: fixture.id }, data: { code: 'schools' } });
      const root = resolve(process.cwd(), '../..');
      execFileSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'apps/api/prisma/demo/import.ts'), '--clear', '--only=schools'], { env: { ...process.env, DATABASE_URL: url! }, timeout: 30000 });
      expect(await db.delayReason.findUnique({ where: { id: reason.id } })).not.toBeNull();
    } finally {
      await db.direction.delete({ where: { id: fixture.id } });
      await db.direction.update({ where: { id: real.id }, data: { code: 'schools' } });
      if (previous) await db.appSetting.upsert({ where: { key: 'demo.cleared' }, create: { key: 'demo.cleared', value: previous.value ?? Prisma.JsonNull }, update: { value: previous.value ?? Prisma.JsonNull } });
      else await db.appSetting.deleteMany({ where: { key: 'demo.cleared' } });
    }
  });
});
