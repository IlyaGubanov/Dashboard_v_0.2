/** Сквозная проверка локального API. Создаёт временные учётки и удаляет их командой cleanup. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { StaffingService } = require('../apps/api/dist/staffing/staffing.service');
const { AccessService } = require('../apps/api/dist/auth/access.service');
const { AuditService } = require('../apps/api/dist/audit/audit.service');
const db = new PrismaClient();
const statePath = path.join(__dirname, '../apps/api/data/staffing-qa-state.json');
const password = 'StaffingTest2026qa42';
const month = '2097-12';
async function login(login) {
  const response = await fetch('http://127.0.0.1:3000/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return async (route, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:3000/api${route}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let value; try { value = await r.json(); } catch { value = null; }
    return { status: r.status, value };
  };
}
async function cleanup() {
  if (!fs.existsSync(statePath)) return;
  const { ids } = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  await db.staffingPeriod.deleteMany({ where: { month: { in: [month, '2097-11'] } } });
  await db.staffingPayroll.deleteMany({ where: { year: 2097 } });
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  fs.unlinkSync(statePath);
  console.log('Временные учётные записи и тестовые срезы удалены.');
}
async function main() {
  if (process.argv[2] === 'cleanup') return cleanup();
  await cleanup();
  const owner = await db.user.findFirstOrThrow({ where: { globalRole: 'ADMIN', isActive: true } });
  const s = new StaffingService(db, new AuditService(db), new AccessService(db));
  const imported = await s.importSource({ id: owner.id, globalRole: 'ADMIN', hiddenSections: [], deniedFeatures: [] }, null);
  console.log('Первичное заполнение, добавлено записей:', imported.added);
  assert.equal((await s.importSource({ id: owner.id, globalRole: 'ADMIN', hiddenSections: [], deniedFeatures: [] }, null)).added, 0);
  const users = [];
  for (const [suffix, globalRole] of [['admin', 'ADMIN'], ['management', 'MANAGEMENT'], ['editor', 'USER']]) {
    users.push(await db.user.create({ data: { login: `staffing-qa-${suffix}`, fullName: `Проверка штатной численности (${suffix})`, globalRole, canLogin: true, mustChangePassword: false, passwordHash: await hash(password, 10) } }));
  }
  fs.writeFileSync(statePath, JSON.stringify({ ids: users.map(u => u.id) }));
  const admin = await login(users[0].login);
  const management = await login(users[1].login);
  const editor = await login(users[2].login);
  const view = await admin('/staffing'); assert.equal(view.status, 200);
  assert.equal(view.value.periods.length >= 4, true);
  const july = view.value.periods.find(p => p.month === '2026-07');
  assert.equal(july.rows.length, 41);
  assert.equal(july.rows.reduce((s, r) => s + (r.planned ?? 0), 0), 4547);
  assert.equal(july.rows.reduce((s, r) => s + (r.actual ?? 0), 0), 4539);
  assert.equal(july.rows.filter(r => r.actual === null).length, 11);
  assert.equal((await editor('/staffing')).status, 403);
  assert.equal((await management('/staffing')).status, 200);
  const roster = (await admin('/staffing/editors')).value;
  assert.equal((await admin('/staffing/editors', 'PUT', { userIds: [...roster.userIds, users[2].id] })).status, 200);
  assert.equal((await editor('/staffing')).status, 200);
  assert.equal((await editor('/staffing/editors', 'PUT', { userIds: [] })).status, 403);
  const data = { month, asOf: `${month}-01`, note: 'Тест API', rows: [{ ...july.rows[0], id: 'qa', planned: 1.5, actual: 1, function: 'Я'.repeat(10_000) }, { ...july.rows[1], function: 'Я'.repeat(10_000) }, { ...july.rows[2], function: 'Я'.repeat(10_000) }, { ...july.rows[3], function: 'Я'.repeat(10_000) }, { ...july.rows[4], function: 'Я'.repeat(10_000) }, { ...july.rows[5], function: 'Я'.repeat(10_000) }] };
  assert.equal((await management('/staffing/periods', 'POST', data)).status, 403);
  const created = await editor('/staffing/periods', 'POST', data); assert.equal(created.status, 201);
  assert.equal((await editor('/staffing/periods', 'POST', { ...data, rows: [{ ...data.rows[0], actual: 0.5 }] })).status, 400);
  const updated = await editor(`/staffing/periods/${month}`, 'PUT', { version: 1, data }); assert.equal(updated.status, 200);
  assert.equal((await editor(`/staffing/periods/${month}`, 'PUT', { version: 1, data })).status, 409);
  assert.equal((await editor(`/staffing/periods/${month}`, 'PUT', { version: 2, data, isArchived: true })).value.isArchived, true);
  assert.equal((await editor(`/staffing/periods/${month}`, 'PUT', { version: 3, data, isArchived: false })).value.isArchived, false);
  const annual = { year: 2097, label: 'Тестовый год', rows: [{ id: 'qa', department: 'Тестовый отдел', category: 'ВП', amount: 1.5 }] };
  assert.equal((await editor('/staffing/payroll', 'POST', annual)).status, 201);
  assert.equal((await editor('/staffing/payroll/2097', 'PUT', { version: 1, data: { ...annual, rows: [{ ...annual.rows[0], amount: 2.5 }] } })).value.rows[0].amount, 2.5);
  assert.equal((await editor('/staffing/payroll/2097', 'PUT', { version: 1, data: annual })).status, 409);
  await db.staffingPayroll.delete({ where: { year: 2097 } });
  await db.user.update({ where: { id: users[2].id }, data: { deniedFeatures: ['finance', 'audit'] } });
  const restricted = await editor('/staffing'); assert.deepEqual(restricted.value.payroll, []); assert.equal(restricted.value.canFinance, false);
  assert.equal((await editor('/staffing/journal')).status, 403);
  assert.equal((await editor('/staffing/payroll', 'POST', { year: 2097, label: 'Тест', rows: [] })).status, 403);
  await db.user.update({ where: { id: users[2].id }, data: { deniedFeatures: [], hiddenSections: ['staffing'] } });
  assert.equal((await editor('/staffing')).status, 403);
  await db.user.update({ where: { id: users[2].id }, data: { hiddenSections: [] } });
  const direction = await db.direction.findFirstOrThrow({ where: { isActive: true } });
  await db.directionMember.create({ data: { userId: users[2].id, directionId: direction.id, role: 'CURATOR' } });
  await db.staffingEditor.delete({ where: { userId: users[2].id } });
  assert.deepEqual((await editor('/staffing/access')).value, { canView: true, canEdit: false, canManageEditors: true });
  assert.equal((await editor('/staffing/editors')).status, 200);
  assert.equal((await editor('/staffing/editors', 'PUT', { userIds: [...roster.userIds, users[2].id] })).status, 200);
  assert.equal((await editor('/staffing/access')).value.canEdit, true);
  await db.directionMember.delete({ where: { directionId_userId: { directionId: direction.id, userId: users[2].id } } });
  await db.staffingPeriod.deleteMany({ where: { month } });
  console.log('API: импорт без перезаписи; итоги41/4547/4539; роли; длинный запрос; валидация400; конфликт409; архив; ограничения финансов/журнала — проверены.');
  console.log('Временные учётки оставлены только для проверки браузером; cleanup удалит их.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
