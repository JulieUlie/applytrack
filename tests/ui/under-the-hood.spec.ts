import { test, expect } from '../fixtures';
import { anApplication } from '../support/data';

/** The teaching panel: every action shows its REST call and the Playwright test that covers it. */
test.describe('Under the hood panel', () => {
  test('shows the REST calls and the matching test for each action', async ({ board, page }) => {
    const hood = page.getByRole('complementary', { name: 'Under the hood' });
    const calls = hood.getByRole('listitem');
    await board.goto();

    await expect(calls.filter({ hasText: '/applications' })).toContainText('GET');
    await expect(hood).toContainText('API test: list applications');

    await board.addApplication(anApplication());
    await expect(calls.first()).toContainText(/GET/);
    await expect(calls.filter({ hasText: 'POST' })).toContainText('201');
    await expect(hood).toContainText('UI test: add an application');
    await expect(hood.locator('pre')).toContainText('board.addApplication(app)');
  });

  test('explains a validation error with the 422 the API returned', async ({ board, page }) => {
    const hood = page.getByRole('complementary', { name: 'Under the hood' });
    await board.goto();

    await board.addApplication({ company: '', role: '' });

    await expect(hood.getByRole('listitem').first()).toContainText('422');
    await expect(hood).toContainText('UI test: validation messages');
  });
});

test.describe('Paging instead of scrolling', () => {
  test('splits a long list over pages that fit the screen', async ({ board, api, page }) => {
    for (let i = 0; i < 25; i++) await api.seed(anApplication({ company: `Page Co ${String(i).padStart(2, '0')}` }));
    await board.goto();
    const pager = page.getByRole('navigation', { name: 'Pages' });

    await expect(pager).toBeVisible();
    const perPage = await board.rows.count();
    expect(perPage).toBeGreaterThan(0);
    expect(perPage).toBeLessThan(25);
    await expect(pager).toContainText(`1–${perPage} of 25`);

    await pager.getByRole('button', { name: 'Next page' }).click();

    await expect(pager).toContainText(`${perPage + 1}–`);
    await expect(pager.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  });
});
