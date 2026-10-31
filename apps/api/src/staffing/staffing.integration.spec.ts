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
  it('проверяет доступ на сервере и исключает ФОТ при отключённых финансах', async () => {
    await expect(service.view({ ...actor, globalRole: 'USER' })).rejects.toMatchObject({ status: 403 });
    await expect(service.create({ ...actor, globalRole: 'MANAGEMENT' }, data, null)).rejects.toMatchObject({ status: 403 });
    await service.createPayroll(actor, { year: 2098, label: 'Тест', rows: [{ id: 'test', department: 'Тест', category: 'ОП', amount: 5 }] }, null);
    const view = await service.view({ ...actor, globalRole: 'MANAGEMENT', deniedFeatures: ['finance'] });
    expect(view.payroll).toEqual([]);
    await expect(service.createPayroll({ ...actor, deniedFeatures: ['finance'] }, { year: 2099, label: 'Тест', rows: [] }, null)).rejects.toMatchObject({ status: 403 });
  });
});
