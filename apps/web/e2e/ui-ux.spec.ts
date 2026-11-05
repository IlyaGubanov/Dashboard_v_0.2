import { expect, test, type BrowserContext } from '@playwright/test';

let cookies: Awaited<ReturnType<BrowserContext['cookies']>>;

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const password = process.env.UI_TEST_PASSWORD;
  if (!password) throw new Error('Укажите пароль отдельной локальной тестовой учётной записи в UI_TEST_PASSWORD');
  await page.goto('/login');
  await page.getByLabel('Логин', { exact: true }).fill(process.env.UI_TEST_LOGIN ?? 'admin');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  cookies = await context.cookies();
  await context.close();
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies(cookies);
  await page.goto('/');
});

test('экономика: мобильный переход сохраняет адрес и не расширяет страницу', async ({ page }) => {
  await page.goto('/economics');
  const section = page.getByRole('textbox', { name: 'Раздел экономики', exact: true });
  await expect(section).toBeVisible();
  await expect(page.getByText('Структура стоимости по лимитам', { exact: true })).toBeAttached();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.click();
  await page.getByRole('option', { name: 'Движение денег', exact: true }).click();
  await expect(page).toHaveURL(/tab=cash/);
  await expect(page.getByRole('heading', { name: 'Экономика', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('кадры: все разрешённые вкладки доступны через мобильный выбор', async ({ page }) => {
  await page.goto('/staffing');
  const section = page.getByRole('textbox', { name: 'Раздел штатной численности', exact: true });
  await expect(section).toBeVisible();
  await section.click();
  for (const name of ['Обзор', 'Подразделения', 'Должности', 'Приём и увольнение', 'ФОТ', 'Журнал']) {
    await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('option', { name: 'Должности', exact: true }).click();
  await expect(page).toHaveURL(/tab=positions/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('меню: состояние открытия доступно клавиатуре и вспомогательным технологиям', async ({ page }) => {
  const menu = page.getByRole('button', { name: 'Меню', exact: true });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Карта объектов' }).click();
  await expect(page).toHaveURL(/\/map(?:\?|$)/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('длинная форма: сохранение доступно сразу и после прокрутки', async ({ page }) => {
  await page.goto('/reb?fleet=vehicles');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
  await expect(save).toBeInViewport();
  await dialog.getByLabel('Примечание', { exact: true }).scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await page.setViewportSize({ width: 375, height: 500 });
  await dialog.getByLabel('Примечание', { exact: true }).focus();
  await expect(save).toBeInViewport();
  await expect.poll(() => dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
});

test('конструктор: панель длинной формы закрепляется к окну', async ({ page }) => {
  await page.goto('/admin/directions/schools');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
});

test('графики наследуют размер и шрифт администратора', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route('**/api/appearance', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), fontSize: 18, fontFamily: 'Arial', radius: 0 } });
  });
  await page.goto('/staffing');
  const chartText = page.locator('[role="img"] svg text').first();
  await expect(chartText).toHaveCSS('font-size', '16px');
  await expect(chartText).toHaveCSS('font-family', /Arial/);
});

test('печать кадров скрывает действия редактирования', async ({ page }) => {
  await page.goto('/staffing');
  await expect(page.getByRole('button', { name: 'Новый срез', exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Новый срез', exact: true })).toBeHidden();
});

test('карточка объекта: панель длинной надстройки доступна в Drawer', async ({ page }) => {
  const sites = await (await page.request.get('/api/directions/schools/sites')).json();
  const site = sites[0];
  const card = await (await page.request.get(`/api/directions/schools/sites/${site.id}`)).json();
  const tracker = card.trackers.find((t: { layout: string; rows: unknown[] }) => t.layout === 'MATRIX' && t.rows.length > 5);
  expect(tracker, 'Для проверки требуется штатная длинная надстройка школ').toBeTruthy();
  await page.goto(`/d/schools?site=${site.id}`);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Раздел карточки объекта', exact: true }).click();
  await page.getByRole('option', { name: tracker.name, exact: true }).click();
  await dialog.getByRole('button', { name: 'Внести изменения', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
});

test('ввод факта: первая правка резервирует полную высоту закреплённых действий', async ({ page }) => {
  await page.goto('/d/mkd?tab=entry');
  const input = page.locator('.mantine-Accordion-panel .mantine-NumberInput-input:visible').first();
  await expect(input).toBeEditable();
  await input.fill(await input.inputValue() === '1' ? '2' : '1');
  const panel = page.locator('.entry-save-panel');
  await expect(panel).toBeVisible();
  const height = (await panel.boundingBox())!.height;
  await expect.poll(() => page.locator('.mantine-Accordion-root').evaluate(e => parseFloat(getComputedStyle(e).marginBottom))).toBeGreaterThanOrEqual(height);
  await panel.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(panel).toHaveCount(0);
});
