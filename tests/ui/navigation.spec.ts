import { test, expect } from '../fixtures';
import { anApplication } from '../support/data';

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
    await expect(page.getByRole('main').getByRole('link', { name: 'Back to the overview' })).toHaveAttribute('href', '/');
    await page.getByRole('main').getByRole('link', { name: 'Open the board' }).click();
    await expect(page).toHaveURL(/\/board$/);
  });
});

test.describe('Layout', () => {
  test('on a 1024px laptop the board columns stay readable next to the panel', async ({ board, api, page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await api.seed(anApplication({ company: 'Havenlink Logistics', status: 'interview' }));
    await board.goto();

    const row = board.row('Havenlink Logistics');
    await expect(row).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Under the hood' })).toBeVisible();
    // no column header or company name is cut off ("Compan…"), the status pill fits its column
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#apps-table th, #apps-table td.company, #apps-table td select')]
        .filter((e) => e.offsetWidth > 0 && e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.textContent?.trim()),
    );
    expect(clipped).toEqual([]);
    // the date and place move to the edit form at this width; the data is still there
    await expect(row).toContainText('Antwerp');
  });

  for (const path of ['/', '/board', '/api', '/tests']) {
    test(`${path} is never wider than the screen @mobile`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

      expect(overflowX).toBeLessThanOrEqual(0);
    });
  }
});
