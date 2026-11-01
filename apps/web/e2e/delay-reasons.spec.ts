import { test, expect, type Page } from '@playwright/test';
import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import type { DelayReasonsSheet } from '@mvs/shared';

test.skip(!process.env.DELAY_TEST_DATABASE_URL, 'Нужны отдельная локальная QA-база и запущенный QA API');
const url = process.env.DELAY_TEST_DATABASE_URL;
const db = new PrismaClient({ datasourceUrl: url });
const codes = ['schools', 'mkd', 'networks', 'streets'];
const names = ['Иванов Иван Иванович', 'Петров Пётр Петрович'];
const password = 'DelayQA2026viewer';
const loginName = `delay_qa_${Date.now()}`;
let userIds: number[] = [];
let before: { id: number; settings: Prisma.JsonValue }[] = [];
let oldPeriods: { id: number; status: 'OPEN' | 'CLOSED' | 'LOCKED' }[] = [];
test.beforeAll(async () => {
  const target = new URL(url!);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Только отдельная локальная тестовая БД');
  const dirs = await db.direction.findMany({ where: { code: { in: codes } } });
  before = dirs.map(d => ({ id: d.id, settings: d.settings }));
  for (const [index, fullName] of names.entries()) {
    const u = await db.user.create({ data: { fullName, login: index === 0 ? loginName : null, canLogin: index === 0, passwordHash: index === 0 ? await hash(password, 4) : null, mustChangePassword: false,
      memberships: { create: dirs.map(d => ({ directionId: d.id, role: 'VIEWER' })) } } }); userIds.push(u.id);
  }
  for (const d of dirs) {
    await db.direction.update({ where: { id: d.id }, data: { settings: { ...((d.settings ?? {}) as Prisma.JsonObject), delayReasons: { defaultResponsibleIds: userIds, useSiteResponsibles: true, allowCuratorEdit: true, requireWhenDelayed: false, workTypes: [] } } } });
    const periods = await db.reportingPeriod.findMany({ where: { directionId: d.id }, orderBy: { date: 'desc' } });
    const latest = [...new Map(periods.map(p => p.program).filter((v, i, a) => a.indexOf(v) === i).map(program => [program, periods.find(p => p.program === program)!])).values()];
    for (const p of latest) { oldPeriods.push({ id: p.id, status: p.status }); await db.reportingPeriod.update({ where: { id: p.id }, data: { status: 'OPEN' } }); }
  }
});
test.afterAll(async () => {
  if (userIds.length) await db.delayReason.deleteMany({ where: { updatedById: { in: userIds } } });
  for (const d of before) await db.direction.update({ where: { id: d.id }, data: { settings: d.settings ?? Prisma.DbNull } });
  for (const p of oldPeriods) await db.reportingPeriod.update({ where: { id: p.id }, data: { status: p.status } });
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
async function login(page: Page, admin = false) {
  const r = await page.request.post('/api/auth/login', { data: { login: admin ? 'admin' : loginName, password: admin ? process.env.DELAY_TEST_ADMIN_PASSWORD ?? 'DelayQA2026test' : password } });
  expect(r.status()).toBe(200);
}
async function theme(page: Page, value: string) {
  if (await page.locator('html').getAttribute('data-mantine-color-scheme') !== value) await page.getByRole('button', { name: 'Сменить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', value);
}
test('четыре направления, четыре экрана, обе темы: поле и все ФИО без обрезки', async ({ page }, info) => {
  await login(page);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const code of codes) {
    await page.goto(`/d/${code}?tab=reasons`);
    const field = page.locator('.delay-reason').first();
    await expect(field).toBeVisible({ timeout: 30000 });
    for (const mode of ['light', 'dark']) {
      await theme(page, mode);
      for (const width of [375, 768, 1366, 1920]) {
        await page.setViewportSize({ width, height: width < 1000 ? 900 : 1080 });
        await expect(field.getByRole('textbox')).toBeEditable();
        for (const name of names) await expect(field).toContainText(name);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const bounds = await field.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        const styles = await field.evaluate(el => ({ border: getComputedStyle(el).borderColor, critical: getComputedStyle(el).getPropertyValue('--status-critical').trim(), description: el.querySelector('.mantine-Textarea-description')!.scrollWidth, width: el.querySelector('.mantine-Textarea-description')!.clientWidth }));
        expect(styles.border).not.toBe('rgba(0, 0, 0, 0)'); expect(styles.description).toBeLessThanOrEqual(styles.width + 1);
        await field.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`${code}-${mode}-${width}.png`), fullPage: false });
      }
    }
  }
  expect(errors).toEqual([]);
});
test('черновик переживает закрытие формы, смену раздела и перезагрузку; сохранение и конфликт версий', async ({ page }) => {
  await login(page);
  await page.goto('/d/mkd?tab=reasons');
  let field = page.locator('.delay-reason').first();
  await expect(field).toBeVisible();
  const id = Number(await field.getAttribute('data-work-item'));
  const reason = 'Поставка материалов перенесена на следующую неделю';
  await field.getByRole('textbox').fill(reason);
  const group = page.locator('.mantine-Accordion-control').first();
  await group.click(); await group.click();
  await expect(field.getByRole('textbox')).toHaveValue(reason);
  await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
  await page.getByRole('tab', { name: 'Причины отставания', exact: true }).click();
  field = page.locator(`.delay-reason[data-work-item="${id}"]`);
  await expect(field.getByRole('textbox')).toHaveValue(reason);
  page.on('dialog', d => d.accept());
  await page.reload();
  field = page.locator(`.delay-reason[data-work-item="${id}"]`);
  await expect(field.getByRole('textbox')).toHaveValue(reason);
  await field.getByRole('button', { name: 'Сохранить причину' }).click();
  await expect(field.getByRole('status')).toHaveText('Причина сохранена');
  const sheet = await (await page.request.get('/api/directions/mkd/delay-reasons')).json() as DelayReasonsSheet;
  const row = sheet.rows.find(r => r.workItemId === id)!;
  expect(row.text).toBe(reason);
  await field.getByRole('textbox').fill('Мой новый черновик');
  const result = await page.request.put(`/api/directions/mkd/delay-reasons/${row.periodId}/${id}`, { data: { text: 'Другой сотрудник уточнил причину', version: row.version } });
  expect(result.status()).toBe(200);
  await field.getByRole('button', { name: 'Сохранить причину' }).click();
  await expect(field.getByRole('alert')).toContainText('уже изменена');
  await expect(field.getByRole('textbox')).toHaveValue('Мой новый черновик');
  await field.getByRole('button', { name: 'Загрузить актуальную причину' }).click();
  await expect(field.getByRole('textbox')).toHaveValue('Другой сотрудник уточнил причину');
  await field.getByRole('textbox').fill('Черновик перед сменой ответственного');
  const dir = await db.direction.findUniqueOrThrow({ where: { code: 'mkd' } });
  const settings = (dir.settings ?? {}) as Prisma.JsonObject;
  try {
    await db.direction.update({ where: { id: dir.id }, data: { settings: { ...settings, delayReasons: { defaultResponsibleIds: [], useSiteResponsibles: false, allowCuratorEdit: false, requireWhenDelayed: false, workTypes: [] } } } });
    await page.reload();
    field = page.locator(`.delay-reason[data-work-item="${id}"]`);
    await expect(field.getByRole('textbox')).not.toBeEditable();
    await expect(field.getByRole('textbox')).toHaveValue('Другой сотрудник уточнил причину');
    await expect(field.getByRole('alert')).toContainText('Черновик перед сменой ответственного');
    await field.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(field.getByRole('alert')).toBeHidden();
  } finally { await db.direction.update({ where: { id: dir.id }, data: { settings } }); }
});
test('конструктор назначает ответственных и виден на телефоне', async ({ page }, info) => {
  await login(page, true);
  await page.goto('/admin/directions/schools');
  await page.getByRole('tab', { name: 'Причины отставания', exact: true }).click();
  const settings = page.locator('.delay-reason-settings');
  await expect(settings).toBeVisible();
  await page.getByRole('checkbox', { name: 'Разрешить куратору редактировать причины' }).uncheck();
  await page.getByRole('button', { name: 'Сохранить настройки причин' }).click();
  await expect(page.getByRole('status')).toContainText('Настройки сохранены');
  expect((await (await page.request.get('/api/admin/directions/schools/delay-reasons')).json()).settings.allowCuratorEdit).toBe(false);
  for (const width of [375, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(settings).toContainText(names[0]);
    await settings.locator('.mantine-MultiSelect-root').first().scrollIntoViewIfNeeded();
    const pills = await settings.locator('.mantine-MultiSelect-pill').evaluateAll(els => els.map(el => ({ height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width })));
    for (const pill of pills) { expect(pill.height).toBeLessThan(100); expect(pill.width).toBeGreaterThan(120); }
    await page.screenshot({ path: info.outputPath(`constructor-${width}.png`), fullPage: false });
  }
});
test('карточка, ввод, матрица и оба режима графика показывают причины и ФИО', async ({ page }, info) => {
  await login(page, true);
  await page.goto('/d/mkd?tab=entry');
  await expect(page.locator('.delay-reason').first()).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.locator('.delay-reason').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.delay-reason').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('entry-phone.png'), fullPage: false });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/d/mkd?tab=matrix');
  // по умолчанию причины скрыты и в матрице, и в карточке
  await expect(page.getByRole('switch', { name: 'Причины и ответственные' })).not.toBeChecked();
  await expect(page.locator('.matrix-status-cell').first()).toBeVisible();
  await expect(page.locator('.delay-reason-preview')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Причины и ответственные' }).check();
  await expect(page.locator('.delay-reason-preview').first()).toContainText(names[0]);
  // в другом направлении переключатель снова выключен
  await page.getByRole('link', { name: /^Школы/ }).click();
  await expect(page).toHaveURL(/\/d\/schools/);
  await page.getByRole('tab', { name: 'Матрица', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Причины и ответственные' })).not.toBeChecked();
  await page.goto('/d/mkd?tab=matrix');
  await expect(page.locator('.matrix-status-cell').first()).toBeVisible();
  // ячейка ведёт к своей работе: строка выделена и видна в карточке, поле причины показано и при выключенном переключателе
  await page.locator('.matrix-status-cell[data-risk="crit"]').last().click();
  await expect(page).toHaveURL(/work=/);
  const dialog = page.getByRole('dialog');
  const focused = dialog.locator('tr.site-work-focus');
  await expect(focused).toBeInViewport();
  await expect(focused.locator('.delay-reason')).toContainText(names[0]);
  await expect(dialog.locator('.delay-reason')).toHaveCount(1);
  await dialog.getByRole('switch', { name: 'Причины и ответственные' }).check();
  await expect.poll(() => dialog.locator('.delay-reason').count()).toBeGreaterThan(1);
  await page.screenshot({ path: info.outputPath('site-card-desktop.png'), fullPage: false });
  await page.goto('/d/mkd?tab=schedule');
  await page.getByRole('button', { name: 'Показать работы' }).first().click();
  await expect(page.locator('.delay-reason').first()).toContainText(names[0]);
  await page.getByText('По видам работ', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать работы' }).first().click();
  await expect(page.locator('.delay-reason').first()).toContainText(names[0]);
});
