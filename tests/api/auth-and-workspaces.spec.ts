import { test } from '../fixtures';
import { expect } from '../support/contract';
import { ApiClient } from '../support/api-client';
import { anApplication } from '../support/data';

test.describe('Health', () => {
  test('is public and reports ok', async ({ request }) => {
    const res = await request.get('/api/health');

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(res.headers()['x-request-id']).toMatch(/^[a-f0-9]{16}$/);
    expect(await res.json()).toMatchSchema('Health');
  });
});

test.describe('Authentication', () => {
  const cases = [
    { name: 'no Authorization header', headers: {}, error: 'Missing bearer token' },
    { name: 'a Basic instead of a Bearer token', headers: { authorization: 'Basic dXNlcjpwYXNz' }, error: 'Missing bearer token' },
    { name: 'a malformed token', headers: { authorization: 'Bearer hello' }, error: 'Malformed token' },
    { name: 'a well-formed but unknown token', headers: { authorization: `Bearer at_${'0'.repeat(32)}` }, error: 'Unknown or expired workspace' },
  ];

  for (const c of cases) {
    test(`401 with ${c.name}`, async ({ request }) => {
      const res = await request.get('/api/applications', { headers: c.headers });

      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: c.error });
    });
  }

  test('401 responses tell the client how to authenticate', async ({ request }) => {
    const res = await request.get('/api/stats');
    expect(res.headers()['www-authenticate']).toContain('Bearer');
  });
});

test.describe('Workspaces', () => {
  test('a new workspace gets a token and a 30-day expiry', async ({ request }) => {
    const res = await request.post('/api/workspaces');

    expect(res.status()).toBe(201);
    const ws = await res.json();
    expect(ws).toMatchSchema('NewWorkspace');
    const days = (Date.parse(ws.expiresAt) - Date.parse(ws.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);
  });

  test('seed=true fills the workspace with eight Antwerp examples, hybrid and remote', async ({ request }) => {
    const ws = await (await request.post('/api/workspaces', { data: { seed: true } })).json();
    const api = new ApiClient(request, ws.token);

    const stats = await (await api.stats()).json();
    const { items } = await (await api.list()).json();

    expect(stats.total).toBe(8);
    expect(stats.byStatus).toEqual({ wishlist: 1, applied: 2, interview: 2, offer: 1, rejected: 2 });
    expect(new Set(items.map((a: { location: string }) => a.location))).toEqual(new Set(['Antwerp (hybrid)', 'Antwerp (remote)']));
  });

  test('workspaces are isolated from each other', async ({ api, request }) => {
    const mine = await api.seed(anApplication());
    const other = new ApiClient(request, (await (await request.post('/api/workspaces')).json()).token);

    expect((await other.get(mine.id)).status()).toBe(404);
    expect((await (await other.list()).json()).count).toBe(0);
    expect((await other.remove(mine.id)).status()).toBe(404);
    expect((await api.get(mine.id)).status()).toBe(200);
  });

  test('shows details and slot usage', async ({ api, request }) => {
    await api.seed(anApplication());

    const res = await request.get('/api/workspace', { headers: api.headers });

    const info = await res.json();
    expect(info).toMatchSchema('WorkspaceInfo');
    expect(info).toMatchObject({ applications: 1, limit: 200 });
  });

  test('deleting a workspace revokes its token', async ({ request }) => {
    const { token } = await (await request.post('/api/workspaces')).json();
    const headers = { authorization: `Bearer ${token}` };

    expect((await request.delete('/api/workspace', { headers })).status()).toBe(204);
    expect((await request.get('/api/applications', { headers })).status()).toBe(401);
  });
});

test.describe('CORS', () => {
  test('preflight allows browser clients on other origins', async ({ request }) => {
    const res = await request.fetch('/api/applications', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });
    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-origin']).toBe('*');
    expect(res.headers()['access-control-allow-headers']).toContain('authorization');
  });
});
