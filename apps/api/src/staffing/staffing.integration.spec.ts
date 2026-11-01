import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { StaffingService } from './staffing.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';

const db = process.env.DATABASE_URL ? new PrismaClient() : null;
describe.skipIf(!db)('сохранение штатной численности в БД', () => {
  let service: StaffingService;
  let actor: any;
  const month = '2098-11';
  const data = { month, asOf: `${month}-01`, note: 'Проверка', rows: [{ id: 'test', department: 'Проверка штатной численности', category: 'ОП' as const, planned: 10.5, actual: 8, note: '', function: '', isArchived: false }] };
  beforeAll(async () => {
    const u = await db!.user.create({ data: { fullName: 'Тест штатной численности', canLogin: false } });
    actor = { id: u.id, globalRole: 'ADMIN', hiddenSections: [], deniedFeatures: [] };
    service = new StaffingService(db as any, new AuditService(db as any), new AccessService(db as any));
  });
  afterAll(async () => {
    if (actor) {
      await db!.staffingPeriod.deleteMany({ where: { month } });
      await db!.staffingMovementDay.deleteMany({ where: { date: `${month}-02` } });
      await db!.staffingPayroll.deleteMany({ where: { year: 2098 } });
      await db!.auditLog.deleteMany({ where: { userId: actor.id } });
      await db!.user.delete({ where: { id: actor.id } });
    }
    await db?.$disconnect();
  });
  it('создаёт, сохраняет дробный штат, предотвращает повторный месяц и устаревшую запись', async () => {
    const p = await service.create(actor, data, null);
    expect(p.rows[0].planned).toBe(10.5);
    await expect(service.create(actor, data, null)).rejects.toMatchObject({ status: 409 });
    const next = await service.save(actor, month, { version: p.version, data: { ...data, rows: [{ ...data.rows[0], actual: 9 }] } }, null);
    expect(next.version).toBe(2);
    expect(next.rows[0].actual).toBe(9);
    await expect(service.save(actor, month, { version: 1, data }, null)).rejects.toMatchObject({ status: 409 });
    const audit = await service.journal(actor);
    expect(audit.some(r => r.entityId === month && r.action === 'UPDATE')).toBe(true);
  });
  it('архивирует и восстанавливает срез без удаления истории', async () => {
    const p = await service.save(actor, month, { version: 2, data, isArchived: true }, null);
    expect(p.isArchived).toBe(true);
    const restored = await service.save(actor, month, { version: 3, data, isArchived: false }, null);
    expect(restored.isArchived).toBe(false);
  });
  it('хранит должности подразделения, пишет в журнал что изменилось и переименовывает группу со связями', async () => {
    const current = (await service.view(actor)).periods.find(p => p.month === month)!;
    const position = { id: 'pos', group: 'любая', rowId: 'test', title: 'Маляр', planned: 5, actual: 4, isArchived: false };
    const saved = await service.save(actor, month, { version: current.version, data: { ...data, positions: [position] } }, null);
    expect(saved.positions![0]).toMatchObject({ group: 'АУП', rowId: 'test' });
    const journal = await service.journal(actor);
    expect(journal.find(r => r.entityId === month)!.comment).toContain('должности: добавлено 1');
    await expect(service.renameGroup({ ...actor, globalRole: 'MANAGEMENT' }, { from: 'АУП', to: 'Икс', month }, null)).rejects.toMatchObject({ status: 403 });
    await expect(service.renameGroup(actor, { from: 'Нет такой группы', to: 'Икс', month }, null)).rejects.toMatchObject({ status: 404 });
    expect(await service.renameGroup(actor, { from: 'АУП', to: 'Проверочная группа', month }, null)).toEqual({ periods: 1, days: 0 });
    const renamed = (await service.view(actor)).periods.find(p => p.month === month)!;
    expect(renamed.version).toBe(saved.version + 1);
    expect(renamed.rows[0].group).toBe('Проверочная группа');
    expect(renamed.positions![0].group).toBe('Проверочная группа');
    // без указания среза меняются и дни приёма/увольнения; объединяемые группы складываются
    await service.saveMovementDay(actor, `${month}-02`, { data: { date: `${month}-02`, note: '', rows: [{ group: 'Проверочная группа', hired: 1, dismissed: 2 }, { group: 'Проверочная группа 2', hired: 3, dismissed: 4 }] } }, null);
    expect(await service.renameGroup(actor, { from: 'Проверочная группа', to: 'Проверочная группа 2' }, null)).toEqual({ periods: 1, days: 1 });
    const view = await service.view(actor);
    expect(view.movements.find(d => d.date === `${month}-02`)!.rows).toEqual([{ group: 'Проверочная группа 2', hired: 4, dismissed: 6 }]);
    const merged = view.periods.find(p => p.month === month)!;
    expect(merged.rows[0].group).toBe('Проверочная группа 2');
    await service.save(actor, month, { version: merged.version, data }, null);
  });
  it('проверяет доступ на сервере и исключает ФОТ при отключённых финансах', async () => {
    await expect(service.view({ ...actor, globalRole: 'USER' })).rejects.toMatchObject({ status: 403 });
    await expect(service.create({ ...actor, globalRole: 'MANAGEMENT' }, data, null)).rejects.toMatchObject({ status: 403 });
    await service.createPayroll(actor, { year: 2098, label: 'Тест', rows: [{ id: 'test', department: 'Тест', category: 'ОП', amount: 5 }] }, null);
    const view = await service.view({ ...actor, globalRole: 'MANAGEMENT', deniedFeatures: ['finance'] });
    expect(view.payroll).toEqual([]);
    await expect(service.createPayroll({ ...actor, deniedFeatures: ['finance'] }, { year: 2099, label: 'Тест', rows: [] }, null)).rejects.toMatchObject({ status: 403 });
  });
});
