import { test } from '../fixtures';
import { expect } from '../support/contract';
import { anApplication, uid } from '../support/data';
import type { Application } from '../support/types';

test.describe('Applications CRUD', () => {
  test('creates an application and returns it with a Location header', async ({ api }) => {
    const input = anApplication();

    const res = await api.create(input);

    expect(res.status()).toBe(201);
    const body: Application = await res.json();
    expect(body).toMatchSchema('Application');
    expect(body).toMatchObject(input);
    expect(res.headers()['location']).toBe(`/api/applications/${body.id}`);
    expect(body.createdAt).toBe(body.updatedAt);
  });

  test('defaults status to "applied" and trims whitespace', async ({ api }) => {
    const res = await api.create({ company: '  Trim Corp  ', role: ' QA ' });

    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ company: 'Trim Corp', role: 'QA', status: 'applied', notes: '' });
  });

  test('reads back a created application by id', async ({ api }) => {
    const created = await api.seed(anApplication());

    const res = await api.get(created.id);

    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(created);
  });

  test('updates only the fields that are sent', async ({ api }) => {
    const created = await api.seed(anApplication({ status: 'applied', notes: 'keep me' }));

    const res = await api.update(created.id, { status: 'interview' });

    expect(res.status()).toBe(200);
    const updated: Application = await res.json();
    expect(updated).toMatchSchema('Application');
    expect(updated).toMatchObject({ ...created, status: 'interview', updatedAt: expect.any(String) });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  test('clears an optional field with an empty string', async ({ api }) => {
    const created = await api.seed(anApplication({ location: 'Ghent' }));

    const updated = await (await api.update(created.id, { location: '' })).json();

    expect(updated.location).toBe('');
  });

  test('deletes an application, after which it is gone', async ({ api }) => {
    const created = await api.seed(anApplication());

    const del = await api.remove(created.id);
    expect(del.status()).toBe(204);
    expect(await del.text()).toBe('');

    const get = await api.get(created.id);
    expect(get.status()).toBe(404);
    expect(await get.json()).toEqual({ error: 'Application not found' });
  });

  test('returns 404 for update and delete of an unknown id', async ({ api }) => {
    const missing = 'app_000000000000';
    expect((await api.update(missing, { status: 'offer' })).status()).toBe(404);
    expect((await api.remove(missing)).status()).toBe(404);
  });
});

test.describe('Listing, filtering and sorting', () => {
  test('lists all applications with a matching count', async ({ api }) => {
    await api.seed(anApplication());
    await api.seed(anApplication());

    const res = await api.list();

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchSchema('ApplicationList');
    expect(body.count).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  test('filters by status', async ({ api }) => {
    const offer = await api.seed(anApplication({ status: 'offer' }));
    await api.seed(anApplication({ status: 'rejected' }));

    const body = await (await api.list({ status: 'offer' })).json();

    expect(body.items.map((a: Application) => a.id)).toEqual([offer.id]);
  });

  test('searches case-insensitively in company, role and location', async ({ api }) => {
    const tag = uid();
    const byCompany = await api.seed(anApplication({ company: `Zebra ${tag}` }));
    const byLocation = await api.seed(anApplication({ location: `Zebraville ${tag}` }));
    await api.seed(anApplication({ company: 'Other', location: 'Elsewhere' }));

    const body = await (await api.list({ q: `zebra` })).json();

    expect(body.items.map((a: Application) => a.id).sort()).toEqual([byCompany.id, byLocation.id].sort());
  });

  test('sorts by company name A to Z', async ({ api }) => {
    for (const company of ['Charlie', 'alpha', 'Bravo']) await api.seed(anApplication({ company }));

    const body = await (await api.list({ sort: 'company' })).json();

    expect(body.items.map((a: Application) => a.company)).toEqual(['alpha', 'Bravo', 'Charlie']);
  });

  test('sorts by most recently updated first by default', async ({ api }) => {
    const first = await api.seed(anApplication());
    const second = await api.seed(anApplication());
    await api.update(first.id, { notes: 'touched' });

    const body = await (await api.list()).json();

    expect(body.items.map((a: Application) => a.id)).toEqual([first.id, second.id]);
  });

  for (const [param, value] of [['status', 'hired'], ['sort', 'salary']] as const) {
    test(`rejects an unknown ${param} value with 400`, async ({ api }) => {
      const res = await api.list({ [param]: value });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toContain(`Unknown ${param === 'status' ? 'status filter' : 'sort'}`);
    });
  }
});

test.describe('Stats', () => {
  test('counts per status and computes the response rate', async ({ api }) => {
    const statuses = ['wishlist', 'applied', 'applied', 'interview', 'rejected'] as const;
    for (const status of statuses) await api.seed(anApplication({ status }));

    const res = await api.stats();

    expect(res.status()).toBe(200);
    const stats = await res.json();
    expect(stats).toMatchSchema('Stats');
    expect(stats).toEqual({
      total: 5,
      byStatus: { wishlist: 1, applied: 2, interview: 1, offer: 0, rejected: 1 },
      // 2 answered (interview + rejected) out of 4 sent (wishlist does not count)
      responseRate: 0.5,
    });
  });
});
