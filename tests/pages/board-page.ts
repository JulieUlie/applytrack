import { Locator, Page, expect } from '@playwright/test';
import type { ApplicationInput, Status } from '../support/types';

const LABELS: Record<Status, string> = {
  wishlist: 'Wishlist',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

/** Page object for the board at "/". Locators follow what a user sees: roles, labels and text. */
export class BoardPage {
  readonly heading: Locator;
  readonly addButton: Locator;
  readonly search: Locator;
  readonly sort: Locator;
  readonly table: Locator;
  readonly rows: Locator;
  readonly emptyState: Locator;
  readonly toast: Locator;
  readonly errorBanner: Locator;
  readonly dialog: Locator;
  readonly confirmDialog: Locator;
  readonly responseRate: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Applications', level: 1 });
    this.addButton = page.getByRole('button', { name: 'Add application' });
    this.search = page.getByRole('searchbox', { name: 'Search' });
    this.sort = page.getByLabel('Sort by');
    this.table = page.getByRole('table', { name: 'Job applications' });
    this.rows = this.table.locator('tbody tr');
    this.emptyState = page.locator('#empty');
    this.toast = page.locator('#toast');
    this.errorBanner = page.locator('#error-banner');
    this.dialog = page.getByRole('dialog').filter({ has: page.locator('form') });
    this.confirmDialog = page.locator('#confirm-dialog');
    this.responseRate = page.locator('#response-rate');
  }

  async goto() {
    await this.page.goto('/board');
    await expect(this.heading).toBeVisible();
    await expect(this.page.locator('#loading')).toBeHidden();
  }

  row(company: string): Locator {
    return this.rows.filter({ has: this.page.getByText(company, { exact: true }) });
  }

  statusFilter(status: Status | 'all'): Locator {
    const name = status === 'all' ? 'All' : LABELS[status];
    return this.page.getByRole('region', { name: 'Overview' }).getByRole('button', { name: new RegExp(`^\\d+ ${name}$`) });
  }

  async expectCount(status: Status | 'all', n: number) {
    await expect(this.statusFilter(status).locator('.stat-n')).toHaveText(String(n));
  }

  async fillForm(data: Partial<ApplicationInput>) {
    const d = this.dialog;
    if (data.company !== undefined) await d.getByLabel('Company').fill(data.company);
    if (data.role !== undefined) await d.getByLabel('Role').fill(data.role);
    if (data.status !== undefined) await d.getByLabel('Status').selectOption(data.status);
    if (data.appliedOn !== undefined) await d.getByLabel('Applied on').fill(data.appliedOn);
    if (data.location !== undefined) await d.getByLabel('Location').fill(data.location);
    if (data.link !== undefined) await d.getByLabel('Link to posting').fill(data.link);
    if (data.notes !== undefined) await d.getByLabel('Notes').fill(data.notes);
  }

  async openAddForm() {
    await this.addButton.click();
    await expect(this.dialog.getByRole('heading', { name: 'Add application' })).toBeVisible();
  }

  async addApplication(data: Partial<ApplicationInput>) {
    await this.openAddForm();
    await this.fillForm(data);
    await this.dialog.getByRole('button', { name: 'Save application' }).click();
  }

  async edit(company: string) {
    await this.page.getByRole('button', { name: `Edit ${company}` }).click();
    await expect(this.dialog.getByRole('heading', { name: `Edit ${company}` })).toBeVisible();
  }

  async changeStatus(company: string, status: Status) {
    await this.page.getByLabel(`Status of ${company}`).selectOption(status);
  }

  async delete(company: string, { confirm = true } = {}) {
    await this.page.getByRole('button', { name: `Delete ${company}` }).click();
    await expect(this.confirmDialog).toBeVisible();
    await this.confirmDialog.getByRole('button', { name: confirm ? 'Delete' : 'Cancel' }).click();
  }

  fieldError(name: string): Locator {
    return this.dialog.locator(`.err[data-for="${name}"]`);
  }
}
