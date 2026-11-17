import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures';
import { anApplication } from '../support/data';

/** Automated accessibility checks with axe-core (WCAG 2.1 A and AA rules). */
const scan = (page: import('@playwright/test').Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

test.describe('Accessibility', () => {
  test('the board has no detectable WCAG violations', async ({ board, api, page }) => {
    await api.seed(anApplication({ status: 'interview' }));
    await board.goto();
    await expect(board.rows).toHaveCount(1);

    const results = await scan(page);

    expect(results.violations).toEqual([]);
  });

  test('the add form has no detectable WCAG violations, also with errors shown', async ({ board, page }) => {
    await board.goto();
    await board.openAddForm();
    expect((await scan(page)).violations).toEqual([]);

    await board.fillForm({ company: '' });
    await board.dialog.getByRole('button', { name: 'Save application' }).click();
    await expect(board.fieldError('company')).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  for (const path of ['/', '/api', '/tests']) {
    test(`the ${path} page has no detectable WCAG violations`, async ({ page }) => {
      await page.goto(path);
      expect((await scan(page)).violations).toEqual([]);
    });
  }

  test('the main flow works with the keyboard only', async ({ board, page }) => {
    await board.goto();

    await board.addButton.focus();
    await page.keyboard.press('Enter');
    await expect(board.dialog.getByLabel('Company')).toBeFocused();
    await page.keyboard.type('Keyboard Corp');
    await page.keyboard.press('Tab');
    await page.keyboard.type('QA Engineer');
    await page.keyboard.press('Enter');

    await expect(board.row('Keyboard Corp')).toBeVisible();
  });
});
