import { test, expect, type Page } from '@playwright/test';

test.skip(process.env.MATRIX_E2E !== 'true', 'Нужны MATRIX_E2E=true и отдельная локальная база с демо-данными');
const sizes = [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }];
const codes = ['schools', 'mkd', 'networks', 'streets'];
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: 'rukovod', password: 'Rukovod2026demo' } });
  expect(response.ok()).toBe(true);
}
async function theme(page: Page, value: string) {
  if (await page.locator('html').getAttribute('data-mantine-color-scheme') !== value) {
    await page.getByRole('button', { name: 'Сменить тему' }).click();
    await page.getByRole('heading', { level: 2 }).hover();
    await expect(page.getByRole('tooltip')).toBeHidden();
  }
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', value);
}

test('все направления: обе темы, четыре экрана, легенда, прокрутка и контраст', async ({ page }, info) => {
  await login(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const code of codes) {
    await page.goto(`/d/${code}?tab=matrix`);
    await expect(page.locator('.matrix-table tbody tr').first()).toBeVisible({ timeout: 30000 });
    for (const mode of ['light', 'dark']) {
      await theme(page, mode);
      for (const size of sizes) {
        await page.setViewportSize(size);
        await expect(page.getByLabel('Светофор матрицы', { exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const legend = await page.getByLabel('Светофор матрицы', { exact: true }).boundingBox();
        expect(legend!.x + legend!.width).toBeLessThanOrEqual(size.width + 1);
        const scroll = await page.locator('.matrix-table').evaluate((table) => {
          const box = table.parentElement!;
          box.scrollLeft = box.scrollWidth;
          const moved = box.scrollLeft;
          box.scrollLeft = 0;
          return { moved, scrollWidth: box.scrollWidth, width: box.clientWidth };
        });
        if (scroll.scrollWidth > scroll.width) expect(scroll.moved).toBeGreaterThan(0);
        const colors = await page.locator('.matrix-status-cell').evaluateAll((cells) => {
          const seen = new Set<string>();
          return cells.filter((c) => { const r = c.getAttribute('data-risk')!; if (seen.has(r)) return false; seen.add(r); return true; })
            .map((c) => { const s = getComputedStyle(c); return { text: s.color, background: s.backgroundColor }; });
        });
        const luminance = (color: string) => {
          const rgb = color.startsWith('color(srgb') ? color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
            : color.match(/[\d.]+/g)!.slice(0, 3).map((v) => Number(v) / 255);
          return rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
            .reduce((a, v, n) => a + v * [0.2126, 0.7152, 0.0722][n], 0);
        };
        for (const color of colors) {
          const a = luminance(color.text), b = luminance(color.background);
          expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
        }
        await page.mouse.move(0, 0);
        await page.screenshot({ path: info.outputPath(`${code}-${mode}-${size.width}.png`), fullPage: true });
      }
    }
  }
  expect(errors).toEqual([]);
});

test('фильтры, историческая дата, подсказки, карточка и надстройки', async ({ page }, info) => {
  await login(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/d/mkd?tab=matrix');
  await expect(page.locator('.matrix-table tbody tr')).toHaveCount(42);
  await page.getByRole('textbox', { name: 'Все разделы', exact: true }).click();
  await page.getByRole('option').first().click();
  expect(await page.locator('.matrix-table tbody tr').count()).toBeLessThan(42);
  await page.getByRole('switch', { name: 'Только отстающие объекты' }).check();
  const risks = await page.locator('.matrix-table tbody tr td:first-child').allTextContents();
  expect(risks.every((r) => r.includes('Критично') || r.includes('Отставание'))).toBe(true);
  await page.goto('/d/schools?tab=matrix');
  await expect(page.locator('.matrix-status-cell').first()).toBeVisible();
  const current = await page.locator('.matrix-status-cell').allTextContents();
  await page.getByRole('textbox', { name: 'Дата среза', exact: true }).click();
  await page.getByRole('option').last().click();
  await expect(page).toHaveURL(/date=/);
  await expect.poll(() => page.locator('.matrix-status-cell').allTextContents()).not.toEqual(current);
  await page.goto('/d/schools?tab=matrix');
  const critical = page.locator('td[data-risk="crit"]').first();
  await critical.hover();
  await expect(page.getByRole('tooltip')).toContainText('Критично');
  await expect(page.getByRole('tooltip')).toContainText('Факт:');
  await expect(page.getByRole('tooltip')).toContainText('План на дату:');
  await expect.poll(() => page.getByRole('tooltip').evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1);
  await page.screenshot({ path: info.outputPath('schools-tooltip.png'), fullPage: true });
  await critical.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await critical.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/site=.*work=|work=.*site=/);
  await page.goto('/d/schools?tab=trackers');
  await expect(page.locator('td[data-risk]').first()).toBeVisible();
  const controls = page.locator('.mantine-SegmentedControl-root').first();
  const labels = await controls.locator('label').allTextContents();
  for (const label of labels) {
    await controls.getByText(label, { exact: true }).click();
    await expect(page.locator('td[data-risk]').first()).toBeVisible();
    for (const mode of ['light', 'dark']) {
      await theme(page, mode);
      for (const size of sizes) {
        await page.setViewportSize(size);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await theme(page, 'light');
    await page.screenshot({ path: info.outputPath(`tracker-${labels.indexOf(label)}.png`), fullPage: true });
  }
  await page.goto('/d/networks?tab=trackers');
  await expect(page.locator('td[data-risk]').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('network-trackers.png'), fullPage: true });
  for (const mode of ['light', 'dark']) {
    await theme(page, mode);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test('до и после: одинаковые проценты, все цвета показаны на демо-данных', async ({ page }, info) => {
  await login(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/d/schools?tab=matrix');
  await theme(page, 'light');
  const after = await page.locator('.matrix-status-cell').allTextContents();
  for (const risk of ['done', 'warn', 'crit', 'wait', 'na']) expect(await page.locator(`td[data-risk="${risk}"]`).count()).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('after-light.png'), fullPage: true });
  await theme(page, 'dark');
  await page.screenshot({ path: info.outputPath('after-dark.png'), fullPage: true });
  if (process.env.MATRIX_BEFORE_URL) {
    await page.goto(process.env.MATRIX_BEFORE_URL + '/d/schools?tab=matrix');
    await expect(page.locator('.matrix-table tbody tr')).toHaveCount(4);
    const before = await page.locator('.matrix-table tbody tr').evaluateAll((rows) =>
      rows.flatMap((row) => [...row.querySelectorAll('td')].slice(1).map((cell) => cell.textContent ?? '')));
    expect(before).toEqual(after);
    await theme(page, 'light');
    await page.screenshot({ path: info.outputPath('before-light.png'), fullPage: true });
  }
});
