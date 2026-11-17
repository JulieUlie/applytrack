import { test } from '../fixtures';
import { expect } from '../support/contract';
import { anApplication, isoDaysAgo } from '../support/data';

/** Data-driven negative tests: one row per rule, each expecting a 422 with a message on the right field. */
const invalidCases: { name: string; body: Record<string, unknown>; field: string; message: string }[] = [
  { name: 'missing company', body: { role: 'QA' }, field: 'company', message: 'Required' },
  { name: 'blank role', body: { company: 'Acme', role: '   ' }, field: 'role', message: 'Required' },
  { name: 'company too long', body: anApplication({ company: 'x'.repeat(81) }), field: 'company', message: 'Must be at most 80 characters' },
  { name: 'unknown status', body: { ...anApplication(), status: 'hired' }, field: 'status', message: 'Must be one of: wishlist, applied, interview, offer, rejected' },
  { name: 'date in wrong format', body: anApplication({ appliedOn: '17/11/2026' }), field: 'appliedOn', message: 'Must be a date in the format YYYY-MM-DD' },
  { name: 'impossible date', body: anApplication({ appliedOn: '2026-02-30' }), field: 'appliedOn', message: 'Must be a date in the format YYYY-MM-DD' },
  { name: 'date in the future', body: anApplication({ appliedOn: isoDaysAgo(-5) }), field: 'appliedOn', message: 'Cannot be in the future' },
  { name: 'link without http(s)', body: anApplication({ link: 'javascript:alert(1)' }), field: 'link', message: 'Must be an http(s) URL' },
  { name: 'notes too long', body: anApplication({ notes: 'n'.repeat(1001) }), field: 'notes', message: 'Must be at most 1000 characters' },
  { name: 'number instead of string', body: { ...anApplication(), company: 42 }, field: 'company', message: 'Must be a string' },
  { name: 'unknown field', body: { ...anApplication(), salary: 5000 }, field: 'salary', message: 'Unknown field' },
  { name: 'read-only id', body: { ...anApplication(), id: 'app_123456789012' }, field: 'id', message: 'Unknown field' },
];

test.describe('Validation on create', () => {
  for (const c of invalidCases) {
    test(`422 for ${c.name}`, async ({ api }) => {
      const res = await api.create(c.body);

      expect(res.status()).toBe(422);
      const body = await res.json();
      expect(body).toMatchSchema('ValidationError');
      expect(body.fields[c.field]).toBe(c.message);
    });
  }

  test('reports every invalid field at once', async ({ api }) => {
    const res = await api.create({ status: 'nope', link: 'ftp://x' });

    expect(res.status()).toBe(422);
    expect((await res.json()).fields).toEqual({
      company: 'Required',
      role: 'Required',
      status: expect.stringContaining('Must be one of'),
      link: 'Must be an http(s) URL',
    });
  });

  test('accepts boundary values (exactly 80 characters, today)', async ({ api }) => {
    const res = await api.create(anApplication({ company: 'c'.repeat(80), appliedOn: isoDaysAgo(0) }));
    expect(res.status()).toBe(201);
  });

  test('nothing is stored when validation fails', async ({ api }) => {
    await api.create({ role: 'no company' });
    expect((await (await api.list()).json()).count).toBe(0);
  });
});

test.describe('Validation on update', () => {
  test('rejects an empty patch', async ({ api }) => {
    const created = await api.seed(anApplication());
    const res = await api.update(created.id, {});
    expect(res.status()).toBe(422);
    expect((await res.json()).fields).toEqual({ body: 'Send at least one field to update' });
  });

  test('does not allow clearing a required field', async ({ api }) => {
    const created = await api.seed(anApplication());
    const res = await api.update(created.id, { company: '' });
    expect(res.status()).toBe(422);
    expect((await res.json()).fields).toEqual({ company: 'Required' });
  });
});

test.describe('Malformed requests', () => {
  test('400 for a body that is not valid JSON', async ({ request, api }) => {
    const res = await request.post('/api/applications', {
      headers: { ...api.headers, 'content-type': 'application/json' },
      // a Buffer is sent as-is; a string would be JSON-encoded by Playwright and become valid JSON
      data: Buffer.from('{"company": "Acme",'),
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'Body must be valid JSON' });
  });

  test('415 when the content type is not JSON', async ({ request, api }) => {
    const res = await request.post('/api/applications', {
      headers: { ...api.headers, 'content-type': 'text/plain' },
      data: 'company=Acme',
    });
    expect(res.status()).toBe(415);
  });

  test('422 when the body is a JSON array', async ({ api }) => {
    const res = await api.create([anApplication()] as unknown as Record<string, unknown>);
    expect(res.status()).toBe(422);
  });

  test('405 with an Allow header for an unsupported method', async ({ request, api }) => {
    const res = await request.put('/api/applications', { headers: api.headers, data: anApplication() });
    expect(res.status()).toBe(405);
    expect(res.headers()['allow']).toBe('GET, POST');
  });

  test('404 for an unknown endpoint', async ({ request, api }) => {
    const res = await request.get('/api/jobs', { headers: api.headers });
    expect(res.status()).toBe(404);
  });
});
