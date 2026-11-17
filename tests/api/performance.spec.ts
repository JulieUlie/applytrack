import { test, expect } from '../fixtures';
import { anApplication } from '../support/data';

/**
 * Light performance smoke: not a load test, but a guard that catches an endpoint that suddenly gets slow.
 * Budgets are generous so the test does not flake on a busy CI runner.
 */
const BUDGET_MS = Number(process.env.API_BUDGET_MS ?? 1500);

test('list and stats stay within the response-time budget with 50 applications', async ({ api }) => {
  await Promise.all(Array.from({ length: 50 }, (_, i) => api.seed(anApplication({ company: `Load ${i}` }))));

  for (const call of [() => api.list(), () => api.list({ q: 'Load 4' }), () => api.stats()]) {
    const started = performance.now();
    const res = await call();
    const elapsed = performance.now() - started;

    expect(res.ok()).toBeTruthy();
    expect(elapsed, `${res.url()} took ${elapsed.toFixed(0)} ms`).toBeLessThan(BUDGET_MS);
  }
});

test('handles 20 parallel creates without losing any', async ({ api }) => {
  const results = await Promise.all(Array.from({ length: 20 }, () => api.create(anApplication())));

  expect(results.map((r) => r.status())).toEqual(Array(20).fill(201));
  const ids = new Set(await Promise.all(results.map(async (r) => (await r.json()).id)));
  expect(ids.size).toBe(20);
  expect((await (await api.list()).json()).count).toBe(20);
});
