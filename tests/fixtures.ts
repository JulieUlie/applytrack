import { test as base, expect } from '@playwright/test';
import { ApiClient } from './support/api-client';
import { BoardPage } from './pages/board-page';
import type { Workspace } from './support/types';

type Fixtures = {
  /** A fresh, empty workspace per test, deleted again afterwards. */
  workspace: Workspace;
  /** API client authorised for that workspace. */
  api: ApiClient;
  /** The board page object, with the test's workspace token already in the browser. */
  board: BoardPage;
};

export const test = base.extend<Fixtures>({
  workspace: async ({ request }, use) => {
    const res = await request.post('/api/workspaces', { data: {} });
    expect(res.status()).toBe(201);
    const workspace: Workspace = await res.json();
    await use(workspace);
    await request.delete('/api/workspace', { headers: { authorization: `Bearer ${workspace.token}` } });
  },

  api: async ({ request, workspace }, use) => {
    await use(new ApiClient(request, workspace.token));
  },

  board: async ({ page, workspace }, use) => {
    // API-first setup: hand the token to the app before any of its scripts run.
    await page.addInitScript((token) => window.localStorage.setItem('applytrack.token', token), workspace.token);
    await use(new BoardPage(page));
  },
});

export { expect };
