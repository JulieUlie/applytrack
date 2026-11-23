import { test, expect } from '../fixtures';
import { anApplication } from '../support/data';

/** Network mocking with page.route: force failures the real server would rarely produce. */
test.describe('When the server misbehaves', () => {
  test('shows an error banner on a 500 and recovers with "Try again"', async ({ board, page }) => {
    let fail = true;
    await page.route('**/api/applications?*', async (route) => {
      if (fail) return route.fulfill({ status: 500, json: { error: 'Internal error' } });
      return route.continue();
    });

    await board.goto();

    await expect(board.errorBanner).toBeVisible();
    await expect(board.errorBanner).toContainText('The server answered with an error: Internal error');

    fail = false;
    await board.errorBanner.getByRole('button', { name: 'Try again' }).click();

    await expect(board.errorBanner).toBeHidden();
    await expect(board.emptyState).toBeVisible();
  });

  test('shows an error banner when the network is down', async ({ board, page }) => {
    await page.route('**/api/stats', (route) => route.abort('internetdisconnected'));

    await board.goto();

    await expect(board.errorBanner).toBeVisible();
    await expect(board.errorBanner).toContainText('Could not reach the server');
  });

  test('a slow, older search answer never overwrites a newer one', async ({ board, api, page }) => {
    const slow = await api.seed(anApplication({ company: 'Slowpoke Labs' }));
    const fast = await api.seed(anApplication({ company: 'Quickstep Labs' }));
    // the first search is held back on the network until after the second one has answered
    let releaseSlow!: () => void;
    const held = new Promise<void>((r) => (releaseSlow = r));
    await page.route('**/api/applications?*q=Slowpoke*', async (route) => { await held; await route.continue(); });
    await board.goto();

    const slowRequest = page.waitForRequest((r) => r.url().includes('q=Slowpoke'));
    await board.search.fill('Slowpoke');
    await slowRequest;
    await board.search.fill('Quickstep');
    await expect(board.rows).toHaveCount(1);
    await expect(board.row(fast.company)).toBeVisible();

    const slowResponse = page.waitForResponse((r) => r.url().includes('q=Slowpoke'));
    releaseSlow();
    await slowResponse;

    await expect(board.row(slow.company)).toHaveCount(0);
    await expect(board.row(fast.company)).toBeVisible();
    await expect(board.search).toHaveValue('Quickstep');
  });

  test('renders whatever the API returns (stubbed response)', async ({ board, page }) => {
    const stub = { ...anApplication({ company: 'Stubbed Inc', status: 'offer' }), id: 'app_aaaaaaaaaaaa', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' };
    await page.route('**/api/applications?*', (route) => route.fulfill({ json: { items: [stub], count: 1 } }));

    await board.goto();

    await expect(board.row('Stubbed Inc')).toBeVisible();
    await expect(board.row('Stubbed Inc').getByRole('combobox')).toHaveValue('offer');
  });

  test('keeps the old status when an update fails', async ({ board, api, page }) => {
    const app = await api.seed(anApplication({ status: 'applied' }));
    await page.route(`**/api/applications/${app.id}`, (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Service unavailable' } }) : route.continue(),
    );
    await board.goto();

    await board.changeStatus(app.company, 'offer');

    await expect(board.toast).toHaveText('Could not update status: Service unavailable');
    await expect(board.page.getByLabel(`Status of ${app.company}`)).toHaveValue('applied');
  });

  test('creates a new workspace when the stored token has expired', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('applytrack.token', `at_${'f'.repeat(32)}`));

    const created = page.waitForResponse((r) => r.url().endsWith('/api/workspaces') && r.status() === 201);
    await page.goto('/board');
    await created;

    await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
    await expect(page.locator('#error-banner')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('applytrack.token'))).not.toBe(`at_${'f'.repeat(32)}`);
  });
});
