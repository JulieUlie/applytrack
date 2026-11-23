import { test, expect } from '../fixtures';
import { anApplication, uid } from '../support/data';

test.describe('Board', () => {
  test('a fresh workspace shows the empty state @mobile', async ({ board }) => {
    await board.goto();

    await expect(board.emptyState).toBeVisible();
    await expect(board.emptyState.getByRole('heading')).toHaveText('No applications yet');
    await expect(board.table).toBeHidden();
    await board.expectCount('all', 0);
  });

  test('adds an application through the form @mobile', async ({ board, api }) => {
    const app = anApplication({ status: 'interview' });
    await board.goto();

    await board.addApplication(app);

    await expect(board.dialog).toBeHidden();
    await expect(board.toast).toHaveText('Application added');
    const row = board.row(app.company);
    await expect(row).toBeVisible();
    await expect(row).toContainText(app.role);
    await expect(row.getByRole('combobox')).toHaveValue('interview');
    await board.expectCount('interview', 1);

    // the UI wrote through to the API
    const { items } = await (await api.list()).json();
    expect(items).toEqual([expect.objectContaining({ company: app.company, role: app.role, status: 'interview' })]);
  });

  test('shows the server validation messages next to the fields', async ({ board }) => {
    await board.goto();
    await board.openAddForm();

    await board.fillForm({ company: '', role: 'r'.repeat(90), link: 'not a url' });
    await board.dialog.getByRole('button', { name: 'Save application' }).click();

    await expect(board.fieldError('company')).toHaveText('Required');
    await expect(board.fieldError('role')).toHaveText('Must be at most 80 characters');
    await expect(board.fieldError('link')).toHaveText('Must be an http(s) URL');
    await expect(board.dialog.getByLabel('Company')).toHaveAttribute('aria-invalid', 'true');
    await expect(board.dialog.getByLabel('Company')).toBeFocused();
    await expect(board.dialog).toBeVisible();
  });

  test('edits an existing application', async ({ board, api }) => {
    const app = await api.seed(anApplication());
    const newRole = `Senior SDET ${uid()}`;
    await board.goto();

    await board.edit(app.company);
    await expect(board.dialog.getByLabel('Role')).toHaveValue(app.role);
    await board.fillForm({ role: newRole, location: 'Remote' });
    await board.dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(board.toast).toHaveText('Application updated');
    await expect(board.row(app.company)).toContainText(newRole);
    await expect(board.row(app.company)).toContainText('Remote');
  });

  test('changes the status inline and updates the counters', async ({ board, api }) => {
    const app = await api.seed(anApplication({ status: 'applied' }));
    await board.goto();
    await board.expectCount('applied', 1);

    await board.changeStatus(app.company, 'offer');

    await expect(board.toast).toHaveText(`${app.company} moved to Offer`);
    await board.expectCount('applied', 0);
    await board.expectCount('offer', 1);
    await expect(board.responseRate).toContainText('100%');
  });

  test('deletes after confirmation', async ({ board, api }) => {
    const app = await api.seed(anApplication());
    await board.goto();

    await board.delete(app.company);

    await expect(board.toast).toHaveText(`Deleted ${app.company}`);
    await expect(board.row(app.company)).toHaveCount(0);
    expect((await api.get(app.id)).status()).toBe(404);
  });

  test('cancelling the delete keeps the application', async ({ board, api }) => {
    const app = await api.seed(anApplication());
    await board.goto();

    await board.delete(app.company, { confirm: false });

    await expect(board.confirmDialog).toBeHidden();
    await expect(board.row(app.company)).toBeVisible();
    expect((await api.get(app.id)).status()).toBe(200);
  });

  test('searches by company, role or location', async ({ board, api }) => {
    const hit = await api.seed(anApplication({ company: 'Searchable Systems' }));
    const miss = await api.seed(anApplication({ company: 'Other Org', location: 'Leuven' }));
    await board.goto();

    await board.search.fill('searchable');

    await expect(board.rows).toHaveCount(1);
    await expect(board.row(hit.company)).toBeVisible();
    await expect(board.row(miss.company)).toHaveCount(0);

    await board.search.fill('nothing-matches-this');
    await expect(board.emptyState.getByRole('heading')).toHaveText('No matches');
  });

  test('filters by status with the overview buttons', async ({ board, api }) => {
    const offer = await api.seed(anApplication({ status: 'offer' }));
    await api.seed(anApplication({ status: 'rejected' }));
    await board.goto();
    await expect(board.rows).toHaveCount(2);

    await board.statusFilter('offer').click();

    await expect(board.statusFilter('offer')).toHaveAttribute('aria-pressed', 'true');
    await expect(board.rows).toHaveCount(1);
    await expect(board.row(offer.company)).toBeVisible();

    await board.statusFilter('all').click();
    await expect(board.rows).toHaveCount(2);
  });

  test('sorts by company name', async ({ board, api }) => {
    for (const company of ['Charlie Co', 'Alpha Co', 'Bravo Co']) await api.seed(anApplication({ company }));
    await board.goto();

    await board.sort.selectOption({ label: 'Company A–Z' });

    await expect(board.rows.locator('td.company strong')).toHaveText(['Alpha Co', 'Bravo Co', 'Charlie Co']);
  });

  test('keeps data after a reload', async ({ board, api, page }) => {
    const app = await api.seed(anApplication());
    await board.goto();
    await expect(board.row(app.company)).toBeVisible();

    await page.reload();

    await expect(board.row(app.company)).toBeVisible();
  });

  test('loads sample data from the empty state', async ({ board }) => {
    await board.goto();

    await board.emptyState.getByRole('button', { name: 'Load sample data' }).click();

    await expect(board.toast).toHaveText('Sample data loaded');
    await board.expectCount('all', 8);
    await expect(board.rows.first()).toContainText('Antwerp');
  });

  test('the posting link opens in a new tab', async ({ board, api }) => {
    const app = await api.seed(anApplication({ link: 'https://example.com/jobs/42' }));
    await board.goto();

    const link = board.row(app.company).getByRole('link', { name: /Job posting for/ });

    await expect(link).toHaveAttribute('href', 'https://example.com/jobs/42');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('the date picker starts on today and offers no future dates @mobile', async ({ board, page }) => {
    await board.goto();
    // "today" as the visitor's own calendar shows it, not the UTC date
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    await board.openAddForm();

    const date = board.dialog.getByLabel('Applied on');
    await expect(date).toHaveValue(today);
    await expect(date).toHaveAttribute('max', today);
  });

  test('closes the form with Escape without saving', async ({ board, api, page }) => {
    await board.goto();
    await board.openAddForm();
    await board.fillForm({ company: 'Never saved', role: 'QA' });

    await page.keyboard.press('Escape');

    await expect(board.dialog).toBeHidden();
    expect((await (await api.list()).json()).count).toBe(0);
  });
});
