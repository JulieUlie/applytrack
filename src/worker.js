// ApplyTrack: a small job application tracker.
// Static UI from ./site, REST API under /api, one SQLite Durable Object per workspace.
import { DurableObject } from "cloudflare:workers";

const VERSION = "1.0.0";
export const STATUSES = ["wishlist", "applied", "interview", "offer", "rejected"];
const TOKEN_RE = /^at_[a-f0-9]{32}$/;
const ID_RE = /^app_[a-f0-9]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // workspaces delete themselves after 30 days
const MAX_APPLICATIONS = 200;
const SORTS = { updated: "updated_at DESC", company: "company COLLATE NOCASE ASC", appliedOn: "applied_on DESC" };

const FIELDS = {
  company: { required: true, max: 80 },
  role: { required: true, max: 80 },
  status: { enum: STATUSES },
  appliedOn: { date: true },
  location: { max: 80 },
  link: { url: true, max: 300 },
  notes: { max: 1000 },
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-expose-headers": "location, x-request-id",
  "access-control-max-age": "86400",
};

class HttpError extends Error {
  constructor(status, message, extra = {}, headers = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(data === null ? null : JSON.stringify(data, null, 2), {
    status,
    headers: data === null ? { ...CORS, ...headers } : { "content-type": "application/json; charset=utf-8", ...CORS, ...headers },
  });
}

const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// ---------- validation (pure, shared by POST and PATCH) ----------
export function validate(input, { partial = false } = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(422, "Validation failed", { fields: { body: "Body must be a JSON object" } });
  }
  const fields = {};
  const out = {};
  for (const key of Object.keys(input)) if (!(key in FIELDS)) fields[key] = "Unknown field";

  for (const [key, rule] of Object.entries(FIELDS)) {
    let value = input[key];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      if (rule.required && !partial) fields[key] = "Required";
      else if (rule.required && partial && key in input) fields[key] = "Required";
      else if (key in input) out[key] = "";
      continue;
    }
    if (typeof value !== "string") { fields[key] = "Must be a string"; continue; }
    value = value.trim();
    if (rule.max && value.length > rule.max) { fields[key] = `Must be at most ${rule.max} characters`; continue; }
    if (rule.enum && !rule.enum.includes(value)) { fields[key] = `Must be one of: ${rule.enum.join(", ")}`; continue; }
    if (rule.date) {
      const d = new Date(`${value}T00:00:00Z`);
      if (!DATE_RE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) { fields[key] = "Must be a date in the format YYYY-MM-DD"; continue; }
      if (d.getTime() > Date.now() + 864e5) { fields[key] = "Cannot be in the future"; continue; }
    }
    if (rule.url) {
      let ok = false;
      try { ok = ["http:", "https:"].includes(new URL(value).protocol); } catch {}
      if (!ok) { fields[key] = "Must be an http(s) URL"; continue; }
    }
    out[key] = value;
  }
  if (Object.keys(fields).length) throw new HttpError(422, "Validation failed", { fields });
  if (partial && Object.keys(out).length === 0) throw new HttpError(422, "Validation failed", { fields: { body: "Send at least one field to update" } });
  return out;
}

async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Content-Type must be application/json");
  const text = await request.text();
  if (text.length > 20_000) throw new HttpError(413, "Body too large");
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Body must be valid JSON"); }
}

function workspaceFor(env, request) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new HttpError(401, "Missing bearer token", {}, { "www-authenticate": 'Bearer realm="applytrack"' });
  if (!TOKEN_RE.test(match[1])) throw new HttpError(401, "Malformed token", {}, { "www-authenticate": 'Bearer error="invalid_token"' });
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(match[1]));
}

function methodNotAllowed(allow) {
  return new HttpError(405, "Method not allowed", {}, { allow });
}

// ---------- router ----------
async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/health") {
    if (method !== "GET") throw methodNotAllowed("GET");
    return json({ status: "ok", version: VERSION, time: new Date().toISOString() });
  }

  if (pathname === "/api/workspaces") {
    if (method !== "POST") throw methodNotAllowed("POST");
    const body = request.headers.get("content-type") ? await readJson(request) : {};
    const token = `at_${hex(16)}`;
    const ws = env.WORKSPACE.get(env.WORKSPACE.idFromName(token));
    const info = await ws.init(Boolean(body && body.seed));
    return json({ token, ...info }, 201);
  }

  const ws = workspaceFor(env, request);
  const call = async (fn) => {
    const result = await fn();
    if (result && result.error) throw new HttpError(result.status, result.error);
    return result;
  };

  if (pathname === "/api/workspace") {
    if (method === "GET") return json(await call(() => ws.info()));
    if (method === "DELETE") { await call(() => ws.destroy()); return json(null, 204); }
    throw methodNotAllowed("GET, DELETE");
  }

  if (pathname === "/api/stats") {
    if (method !== "GET") throw methodNotAllowed("GET");
    return json(await call(() => ws.stats()));
  }

  if (pathname === "/api/applications") {
    if (method === "GET") {
      const status = url.searchParams.get("status");
      const sort = url.searchParams.get("sort") || "updated";
      const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
      if (status && !STATUSES.includes(status)) throw new HttpError(400, `Unknown status filter. Use one of: ${STATUSES.join(", ")}`);
      if (!(sort in SORTS)) throw new HttpError(400, `Unknown sort. Use one of: ${Object.keys(SORTS).join(", ")}`);
      return json(await call(() => ws.list({ status, sort, q })));
    }
    if (method === "POST") {
      const data = validate(await readJson(request));
      const created = await call(() => ws.create(data));
      return json(created, 201, { location: `/api/applications/${created.id}` });
    }
    throw methodNotAllowed("GET, POST");
  }

  const one = pathname.match(/^\/api\/applications\/([^/]+)$/);
  if (one) {
    const id = one[1];
    if (!["GET", "PATCH", "DELETE"].includes(method)) throw methodNotAllowed("GET, PATCH, DELETE");
    if (!ID_RE.test(id)) throw new HttpError(404, "Application not found");
    if (method === "GET") return json(await call(() => ws.get(id)));
    if (method === "PATCH") return json(await call(async () => ws.update(id, validate(await readJson(request), { partial: true }))));
    await call(() => ws.remove(id));
    return json(null, 204);
  }

  throw new HttpError(404, "No such endpoint. See /api.html");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const requestId = hex(8);
    let response;
    try {
      response = await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) response = json({ error: err.message, ...err.extra }, err.status, err.headers);
      else { console.error(err); response = json({ error: "Internal error" }, 500); }
    }
    response.headers.set("x-request-id", requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  },
};

// ---------- storage: one SQLite Durable Object per workspace ----------
// Example data: fictional companies, roles in Antwerp (hybrid and remote). Listed oldest update first.
const SEED = [
  { company: "Berchem Mobility", role: "Test Engineer", status: "rejected", appliedOn: 34, location: "Antwerp (hybrid)", notes: "Role was filled internally." },
  { company: "Eilandje Media", role: "QA Analyst", status: "rejected", appliedOn: 27, location: "Antwerp (remote)", notes: "They went with Cypress instead of Playwright." },
  { company: "Zuid Health Tech", role: "Automation Engineer", status: "wishlist", appliedOn: null, location: "Antwerp (hybrid)", notes: "Posting expected in January." },
  { company: "Meir Commerce", role: "QA Engineer, e-commerce", status: "applied", appliedOn: 9, location: "Antwerp (remote)", notes: "Asks for CI/CD with GitHub Actions." },
  { company: "Havenlink Logistics", role: "Test Automation Engineer", status: "applied", appliedOn: 5, location: "Antwerp (hybrid)", notes: "Port logistics platform; API tests with Postman." },
  { company: "Diamond Data", role: "Software Engineer in Test", status: "interview", appliedOn: 14, location: "Antwerp (remote)", notes: "Fully remote, Antwerp office once a month." },
  { company: "Kaai Fintech", role: "Senior QA Automation Engineer", status: "offer", appliedOn: 30, location: "Antwerp (hybrid)", notes: "Offer valid for two weeks." },
  { company: "Scheldt Systems", role: "QA Test Automation Engineer", status: "interview", appliedOn: 11, location: "Antwerp (hybrid)", notes: "Technical round: Playwright exercise in TypeScript." },
];

export class Workspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.schema();
  }

  schema() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
      applied_on TEXT, location TEXT, link TEXT, notes TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  }

  meta(key) {
    const row = this.sql.exec(`SELECT value FROM meta WHERE key = ?`, key).toArray()[0];
    return row ? row.value : null;
  }

  missing() {
    return this.meta("createdAt") ? null : { status: 401, error: "Unknown or expired workspace" };
  }

  static row(r) {
    return { id: r.id, company: r.company, role: r.role, status: r.status, appliedOn: r.applied_on || "", location: r.location || "", link: r.link || "", notes: r.notes || "", createdAt: r.created_at, updatedAt: r.updated_at };
  }

  async init(seed) {
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    this.sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('createdAt', ?), ('expiresAt', ?)`, createdAt, expiresAt);
    await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
    if (seed) {
      // stagger timestamps so "recently updated" has a stable order
      SEED.forEach((s, i) => {
        const at = new Date(Date.now() - (SEED.length - i) * 60_000).toISOString();
        this.insert({ ...s, appliedOn: s.appliedOn === null ? "" : daysAgo(s.appliedOn), link: "" }, at);
      });
    }
    return { createdAt, expiresAt, seeded: Boolean(seed) };
  }

  info() {
    return this.missing() || {
      createdAt: this.meta("createdAt"),
      expiresAt: this.meta("expiresAt"),
      applications: this.sql.exec(`SELECT COUNT(*) AS n FROM applications`).one().n,
      limit: MAX_APPLICATIONS,
    };
  }

  insert(data, at = new Date().toISOString()) {
    const id = `app_${hex(6)}`;
    this.sql.exec(
      `INSERT INTO applications (id, company, role, status, applied_on, location, link, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, data.company, data.role, data.status || "applied", data.appliedOn || "", data.location || "", data.link || "", data.notes || "", at, at,
    );
    return id;
  }

  list({ status, sort, q }) {
    const gone = this.missing();
    if (gone) return gone;
    const where = [];
    const args = [];
    if (status) { where.push(`status = ?`); args.push(status); }
    if (q) { where.push(`(company LIKE ? OR role LIKE ? OR location LIKE ?)`); const like = `%${q.replace(/[%_]/g, "")}%`; args.push(like, like, like); }
    const sql = `SELECT * FROM applications ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${SORTS[sort]}, created_at DESC`;
    const items = this.sql.exec(sql, ...args).toArray().map(Workspace.row);
    return { items, count: items.length };
  }

  get(id) {
    const gone = this.missing();
    if (gone) return gone;
    const r = this.sql.exec(`SELECT * FROM applications WHERE id = ?`, id).toArray()[0];
    return r ? Workspace.row(r) : { status: 404, error: "Application not found" };
  }

  create(data) {
    const gone = this.missing();
    if (gone) return gone;
    const n = this.sql.exec(`SELECT COUNT(*) AS n FROM applications`).one().n;
    if (n >= MAX_APPLICATIONS) return { status: 409, error: `Workspace is full (${MAX_APPLICATIONS} applications)` };
    return this.get(this.insert(data));
  }

  update(id, patch) {
    const current = this.get(id);
    if (current.error) return current;
    const next = { ...current, ...patch };
    // keep updatedAt strictly increasing, even within the same millisecond
    const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
    this.sql.exec(
      `UPDATE applications SET company = ?, role = ?, status = ?, applied_on = ?, location = ?, link = ?, notes = ?, updated_at = ? WHERE id = ?`,
      next.company, next.role, next.status, next.appliedOn, next.location, next.link, next.notes, now, id,
    );
    return this.get(id);
  }

  remove(id) {
    const current = this.get(id);
    if (current.error) return current;
    this.sql.exec(`DELETE FROM applications WHERE id = ?`, id);
    return { ok: true };
  }

  stats() {
    const gone = this.missing();
    if (gone) return gone;
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of this.sql.exec(`SELECT status, COUNT(*) AS n FROM applications GROUP BY status`)) byStatus[r.status] = r.n;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const sent = total - byStatus.wishlist;
    const answered = byStatus.interview + byStatus.offer + byStatus.rejected;
    return { total, byStatus, responseRate: sent ? Math.round((answered / sent) * 100) / 100 : 0 };
  }

  async destroy() {
    const gone = this.missing();
    if (gone) return gone;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.schema();
    return { ok: true };
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
    this.schema();
  }
}
