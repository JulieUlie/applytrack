import { test, expect } from '../fixtures';

test.describe('Navigation', () => {
  test('the overview states the purpose and leads to every page @mobile', async ({ board, page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Playwright and REST API testing');
    const nav = page.getByRole('navigation', { name: 'Main' });

    await page.getByRole('link', { name: 'Try the app' }).click();
    await expect(board.heading).toBeVisible();

    await nav.getByRole('link', { name: 'API' }).click();
    await expect(page).toHaveURL(/\/api$/);
    await expect(page.getByRole('heading', { name: 'REST API', level: 1 })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'API' })).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Tests' }).click();
    await expect(page.getByRole('heading', { name: 'How this app is tested' })).toBeVisible();

    await nav.getByRole('link', { name: 'Overview' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('the overview maps existing experience to the skills shown here', async ({ page }) => {
    await page.goto('/');

    const bridge = page.getByRole('table', { name: /existing experience/ });

    await expect(bridge.getByRole("row")).toHaveCount(9);
    await expect(bridge).toContainText('RanoreXPath');
    await expect(bridge).toContainText('Locators by role and label');
  });

  test('the overview counts up to the results of the latest run', async ({ page, request }) => {
    const summary = await (await request.get('/reports/summary.json')).json();
    await page.goto('/');

    const counter = page.locator('#proof-pw');

    await expect(counter).toHaveText(String(summary.playwright.passed));
    await expect(counter).toHaveAttribute('aria-label', String(summary.playwright.passed));
    await expect(page.locator('#proof-pm')).toHaveText(String(summary.newman.assertions));
  });

  test('with reduced motion the numbers appear at once', async ({ page, request }) => {
    const summary = await (await request.get('/reports/summary.json')).json();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    await expect(page.locator('#proof-pw')).toHaveText(String(summary.playwright.passed), { timeout: 1000 });
  });

  for (const path of ['/', '/board', '/api', '/tests']) {
    test(`${path} fits the screen without scrolling @mobile`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test('tabs switch with a click and with the arrow keys', async ({ page }) => {
    await page.goto('/api');
    const tabs = page.getByRole('tablist', { name: 'API reference' });

    await tabs.getByRole('tab', { name: 'Errors' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Errors' })).toContainText('Validation failed');
    await expect(page).toHaveURL(/#errors$/);

    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: 'Fields' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: 'Fields' })).toBeFocused();
  });

  test('the Postman collection can be downloaded from the API page', async ({ page }) => {
    await page.goto('/api');

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download Postman collection' }).click();

    expect((await download).suggestedFilename()).toBe('applytrack.postman_collection.json');
  });

  test('an unknown page returns a 404 page', async ({ page }) => {
    const res = await page.goto('/does-not-exist');

    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('Layout', () => {
  for (const path of ['/', '/board', '/api', '/tests']) {
    test(`${path} is never wider than the screen @mobile`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

      expect(overflowX).toBeLessThanOrEqual(0);
    });
  }
});
