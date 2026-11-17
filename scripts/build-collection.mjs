// Builds the Postman collection from readable JS instead of hand-editing escaped JSON.
// Usage: node scripts/build-collection.mjs  -> postman/*.json and site/downloads/*.json
import { mkdirSync, writeFileSync } from 'node:fs';

// turn a block-bodied arrow function into Postman script lines, dedented
const lines = (fn) => {
  const body = fn.toString().split('\n').slice(1, -1);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return body.map((l) => l.slice(indent));
};
const tests = (fn) => [{ listen: 'test', script: { type: 'text/javascript', exec: lines(fn) } }];
const pre = (fn) => ({ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(fn) } });

const url = (path, query = []) => ({
  raw: `{{baseUrl}}${path}${query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`,
  host: ['{{baseUrl}}'],
  path: path.split('/').filter(Boolean),
  ...(query.length ? { query } : {}),
});

const json = (body) => ({ mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } });
const jsonHeader = [{ key: 'Content-Type', value: 'application/json' }];
const noAuth = { type: 'noauth' };

function request(name, method, path, { body, query, auth, headers, test, prerequest, description } = {}) {
  return {
    name,
    event: [...(prerequest ? [pre(prerequest)] : []), ...(test ? tests(test) : [])],
    request: {
      method,
      ...(auth ? { auth } : {}),
      header: body !== undefined ? [...jsonHeader, ...(headers || [])] : headers || [],
      ...(body !== undefined ? { body: json(body) } : {}),
      url: url(path, query),
      ...(description ? { description } : {}),
    },
  };
}

const collection = {
  info: {
    name: 'ApplyTrack API',
    description:
      'End-to-end walk through the ApplyTrack REST API. Run it top to bottom (Collection Runner or Newman): it creates its own workspace, chains ids through collection variables, checks status codes, headers, bodies and JSON schemas, and deletes the workspace at the end.\n\nDocs: https://applytrack.julietous.workers.dev/api',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'token', value: '' },
    { key: 'applicationId', value: '' },
    { key: 'company', value: '' },
  ],
  event: [
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: lines(() => {
          // collection-level checks that run after every request
          pm.test('responds within the time budget', () => {
            // budget comes from the environment, 2 s if not set
            pm.expect(pm.response.responseTime).to.be.below(Number(pm.environment.get('budgetMs') || 2000));
          });
          pm.test('has a request id header', () => {
            pm.response.to.have.header('x-request-id');
          });
        }),
      },
    },
  ],
  item: [
    {
      name: '1. Setup',
      item: [
        request('Health check', 'GET', '/api/health', {
          auth: noAuth,
          test: () => {
            pm.test('status 200', () => pm.response.to.have.status(200));
            pm.test('service is ok', () => pm.expect(pm.response.json().status).to.eql('ok'));
          },
        }),
        request('Create workspace', 'POST', '/api/workspaces', {
          auth: noAuth,
          body: { seed: false },
          test: () => {
            pm.test('status 201', () => pm.response.to.have.status(201));
            const ws = pm.response.json();
            pm.test('token has the documented format', () => pm.expect(ws.token).to.match(/^at_[a-f0-9]{32}$/));
            pm.test('expires in 30 days', () => {
              const days = (Date.parse(ws.expiresAt) - Date.parse(ws.createdAt)) / 864e5;
              pm.expect(days).to.be.within(29.9, 30.1);
            });
            // chain: every following request authenticates with this token
            pm.collectionVariables.set('token', ws.token);
          },
        }),
      ],
    },
    {
      name: '2. Applications CRUD',
      item: [
        request('Create application', 'POST', '/api/applications', {
          prerequest: () => {
            // unique test data per run, and today's date in the YYYY-MM-DD format the API expects
            pm.collectionVariables.set('company', `Postman Corp ${Date.now()}`);
            pm.collectionVariables.set('today', new Date().toISOString().slice(0, 10));
          },
          body: '{\n  "company": "{{company}}",\n  "role": "QA Automation Engineer",\n  "status": "applied",\n  "appliedOn": "{{today}}",\n  "location": "Antwerp",\n  "link": "https://example.com/jobs/1"\n}',
          test: () => {
            const schema = {
              type: 'object',
              required: ['id', 'company', 'role', 'status', 'appliedOn', 'location', 'link', 'notes', 'createdAt', 'updatedAt'],
              properties: {
                id: { type: 'string', pattern: '^app_[a-f0-9]{12}$' },
                status: { enum: ['wishlist', 'applied', 'interview', 'offer', 'rejected'] },
              },
            };
            pm.test('status 201', () => pm.response.to.have.status(201));
            pm.test('body matches the schema', () => pm.response.to.have.jsonSchema(schema));
            pm.test('Location header points at the new item', () => {
              pm.expect(pm.response.headers.get('Location')).to.eql(`/api/applications/${pm.response.json().id}`);
            });
            pm.collectionVariables.set('applicationId', pm.response.json().id);
          },
        }),
        request('Get application', 'GET', '/api/applications/{{applicationId}}', {
          test: () => {
            pm.test('status 200', () => pm.response.to.have.status(200));
            pm.test('returns the application that was created', () => {
              const app = pm.response.json();
              pm.expect(app.id).to.eql(pm.collectionVariables.get('applicationId'));
              pm.expect(app.company).to.eql(pm.collectionVariables.get('company'));
            });
          },
        }),
        request('List applications', 'GET', '/api/applications', {
          test: () => {
            pm.test('status 200', () => pm.response.to.have.status(200));
            const body = pm.response.json();
            pm.test('count matches the number of items', () => pm.expect(body.count).to.eql(body.items.length));
            pm.test('contains the new application', () => {
              pm.expect(body.items.map((a) => a.id)).to.include(pm.collectionVariables.get('applicationId'));
            });
          },
        }),
        request('Filter by status', 'GET', '/api/applications', {
          query: [{ key: 'status', value: 'applied' }],
          test: () => {
            pm.test('only "applied" items come back', () => {
              pm.response.json().items.forEach((a) => pm.expect(a.status).to.eql('applied'));
            });
          },
        }),
        request('Move to interview', 'PATCH', '/api/applications/{{applicationId}}', {
          body: { status: 'interview', notes: 'First call went well' },
          test: () => {
            pm.test('status 200', () => pm.response.to.have.status(200));
            const app = pm.response.json();
            pm.test('status and notes are updated', () => {
              pm.expect(app.status).to.eql('interview');
              pm.expect(app.notes).to.eql('First call went well');
            });
            pm.test('other fields are untouched', () => pm.expect(app.location).to.eql('Antwerp'));
            pm.test('updatedAt moved forward', () => pm.expect(Date.parse(app.updatedAt)).to.be.above(Date.parse(app.createdAt)));
          },
        }),
        request('Stats', 'GET', '/api/stats', {
          test: () => {
            pm.test('status 200', () => pm.response.to.have.status(200));
            pm.test('counts the interview', () => {
              const s = pm.response.json();
              pm.expect(s.byStatus.interview).to.eql(1);
              pm.expect(s.total).to.eql(1);
              pm.expect(s.responseRate).to.eql(1);
            });
          },
        }),
        request('Delete application', 'DELETE', '/api/applications/{{applicationId}}', {
          test: () => {
            pm.test('status 204', () => pm.response.to.have.status(204));
            pm.test('empty body', () => pm.expect(pm.response.text()).to.eql(''));
          },
        }),
        request('Get deleted application', 'GET', '/api/applications/{{applicationId}}', {
          test: () => {
            pm.test('status 404', () => pm.response.to.have.status(404));
            pm.test('explains why', () => pm.expect(pm.response.json().error).to.eql('Application not found'));
          },
        }),
      ],
    },
    {
      name: '3. Negative cases',
      item: [
        request('No token', 'GET', '/api/applications', {
          auth: noAuth,
          test: () => {
            pm.test('status 401', () => pm.response.to.have.status(401));
            pm.test('WWW-Authenticate header', () => pm.response.to.have.header('WWW-Authenticate'));
          },
        }),
        request('Validation errors', 'POST', '/api/applications', {
          body: { role: '', status: 'hired', link: 'ftp://example.com', salary: 5000 },
          test: () => {
            pm.test('status 422', () => pm.response.to.have.status(422));
            const { fields } = pm.response.json();
            pm.test('one message per invalid field', () => {
              pm.expect(fields).to.have.all.keys('company', 'role', 'status', 'link', 'salary');
              pm.expect(fields.company).to.eql('Required');
              pm.expect(fields.salary).to.eql('Unknown field');
            });
          },
        }),
        request('Invalid JSON', 'POST', '/api/applications', {
          body: '{ "company": "Acme", ',
          test: () => {
            pm.test('status 400', () => pm.response.to.have.status(400));
            pm.test('error message', () => pm.expect(pm.response.json().error).to.eql('Body must be valid JSON'));
          },
        }),
        request('Unknown status filter', 'GET', '/api/applications', {
          query: [{ key: 'status', value: 'hired' }],
          test: () => {
            pm.test('status 400', () => pm.response.to.have.status(400));
          },
        }),
        request('Wrong method', 'PUT', '/api/applications/{{applicationId}}', {
          body: { status: 'offer' },
          test: () => {
            pm.test('status 405', () => pm.response.to.have.status(405));
            pm.test('Allow header lists the valid methods', () => pm.expect(pm.response.headers.get('Allow')).to.eql('GET, PATCH, DELETE'));
          },
        }),
      ],
    },
    {
      name: '4. Teardown',
      item: [
        request('Delete workspace', 'DELETE', '/api/workspace', {
          test: () => {
            pm.test('status 204', () => pm.response.to.have.status(204));
          },
        }),
        request('Token no longer works', 'GET', '/api/stats', {
          test: () => {
            pm.test('status 401', () => pm.response.to.have.status(401));
            pm.collectionVariables.unset('token');
          },
        }),
      ],
    },
  ],
};

const env = (name, baseUrl) => ({
  name,
  values: [
    { key: 'baseUrl', value: baseUrl, enabled: true },
    { key: 'budgetMs', value: '2000', enabled: true },
  ],
  _postman_variable_scope: 'environment',
});

mkdirSync('postman', { recursive: true });
mkdirSync('site/downloads', { recursive: true });
const out = {
  'applytrack.postman_collection.json': collection,
  'local.postman_environment.json': env('ApplyTrack local', 'http://127.0.0.1:8787'),
  'live.postman_environment.json': env('ApplyTrack live', 'https://applytrack.julietous.workers.dev'),
};
for (const [file, data] of Object.entries(out)) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(`postman/${file}`, text);
  if (file !== 'local.postman_environment.json') writeFileSync(`site/downloads/${file}`, text);
}
console.log('Wrote postman/ and site/downloads/');
