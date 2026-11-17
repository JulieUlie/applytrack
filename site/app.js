// ApplyTrack board. Plain ES module, no build step.
const TOKEN_KEY = "applytrack.token";
const STATUSES = [
  ["wishlist", "Wishlist"],
  ["applied", "Applied"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
];
const LABEL = Object.fromEntries(STATUSES);

const $ = (sel) => document.querySelector(sel);
const state = { items: [], stats: null, status: "", q: "", sort: "updated", editing: null, page: 0, pageSize: 6, calls: [] };

// ---------- "Under the hood": what each action does in REST, and the Playwright test that checks it ----------
const LESSONS = {
  load: {
    rest: "GET reads data. To draw this board the browser makes two GET calls, one for the list and one for the counters. Both answer 200 OK with JSON.",
    title: "API test: list applications",
    code: `const res = await api.list();
expect(res.status()).toBe(200);
const body = await res.json();
expect(body).toMatchSchema('ApplicationList');`,
    why: "An API test skips the browser: it calls the endpoint directly and checks the answer against the OpenAPI spec.",
  },
  add: {
    rest: "POST creates an application. The API answers 201 Created, with a Location header that points at the new id.",
    title: "UI test: add an application",
    code: `await board.addApplication(app);
await expect(board.toast)
  .toHaveText('Application added');
await expect(board.row(app.company))
  .toBeVisible();`,
    why: "Playwright fills in the form like a user, finding each field by its label. Afterwards the test asks the API whether the data is really stored.",
  },
  invalid: {
    rest: "The API checked the input and answered 422 Unprocessable, with one message per field. The form only shows what the server said.",
    title: "UI test: validation messages",
    code: `await board.fillForm({ company: '' });
await save.click();
await expect(board.fieldError('company'))
  .toHaveText('Required');`,
    why: "The error path is tested on purpose. The API tests add a table of 12 invalid inputs, each expecting a 422.",
  },
  edit: {
    rest: "PATCH sends only the fields that changed. The answer, 200 OK, is the updated application.",
    title: "UI test: edit an application",
    code: `await board.edit(app.company);
await board.fillForm({ role: newRole });
await save.click();
await expect(board.row(app.company))
  .toContainText(newRole);`,
    why: "The test creates its application through the API first, so it starts from known data in a few milliseconds instead of clicking through the form.",
  },
  status: {
    rest: 'A status change is a PATCH with one field, {"status": "…"}. Then the board fetches the counters again with GET /api/stats.',
    title: "UI test: change the status",
    code: `await board.changeStatus(app.company, 'offer');
await board.expectCount('applied', 0);
await board.expectCount('offer', 1);`,
    why: "Playwright waits by itself until the counters update. No sleeps in the test, so it does not become flaky.",
  },
  delete: {
    rest: "DELETE removes the application. 204 No Content means it worked and there is nothing to send back.",
    title: "UI test: delete after confirming",
    code: `await board.delete(app.company);
await expect(board.row(app.company))
  .toHaveCount(0);
const res = await api.get(app.id);
expect(res.status()).toBe(404);`,
    why: "Checked twice: the row is gone from the screen, and the API answers 404 Not Found for that id.",
  },
  filter: {
    rest: "Filtering happens on the server: a GET with ?status=… in the query string returns only the matching applications.",
    title: "UI test: filter by status",
    code: `await board.statusFilter('offer').click();
await expect(board.rows).toHaveCount(1);`,
    why: "The API test for the same filter calls GET ?status=offer and compares the ids it gets back.",
  },
  search: {
    rest: "Search is a GET with ?q=…. The server looks in company, role and location, ignoring upper and lower case.",
    title: "UI test: search",
    code: `await board.search.fill('searchable');
await expect(board.rows).toHaveCount(1);`,
    why: "No waiting code needed: toHaveCount keeps retrying until the list matches, or fails after a timeout.",
  },
  sort: {
    rest: "Sorting is done by the server too: GET with ?sort=company or ?sort=appliedOn.",
    title: "UI test: sort by company",
    code: `await board.sort.selectOption({
  label: 'Company A–Z' });
await expect(names).toHaveText(
  ['Alpha Co', 'Bravo Co', 'Charlie Co']);`,
    why: "toHaveText with a list checks every row and their order in one assertion.",
  },
  page: {
    rest: "Paging happens in the browser: the list is already loaded, so there is no new API call.",
    title: "Config: the same tests on a phone",
    code: `{ name: 'mobile',
  grep: /@mobile/,
  use: { ...devices['Pixel 7'] } }`,
    why: "Tests tagged @mobile also run on an emulated Pixel 7, where the table turns into cards and fewer fit on a page.",
  },
  error: {
    rest: "The server answered with an error or could not be reached, so the board shows a banner instead of a broken page.",
    title: "UI test: a broken server",
    code: `await page.route('**/api/applications?*',
  r => r.fulfill({ status: 500 }));
await board.goto();
await expect(board.errorBanner)
  .toBeVisible();`,
    why: "page.route fakes the failure, so the error path is tested every run without breaking the real server.",
  },
  workspace: {
    rest: "POST /api/workspaces creates a private workspace and returns a bearer token. Every later call sends it in the Authorization header.",
    title: "Fixture: a fresh workspace per test",
    code: `const res = await request
  .post('/api/workspaces');
const { token } = await res.json();
await page.addInitScript(t => localStorage
  .setItem('applytrack.token', t), token);`,
    why: "Each test gets its own workspace this way, so the tests never share data and can all run in parallel.",
  },
};

function explain(key) {
  const l = LESSONS[key];
  if (!l) return;
  $("#hood-rest").textContent = l.rest;
  $("#hood-test-title").textContent = l.title;
  $("#hood-code").textContent = l.code;
  $("#hood-why").textContent = l.why;
  $("#hood").dataset.lesson = key;
}

function renderCalls() {
  $("#hood-calls").replaceChildren(...state.calls.map((c) => {
    const cls = c.status >= 500 || c.status === 0 ? "bad" : c.status >= 400 ? "warn" : "ok";
    return el("li", {},
      el("span", { class: `m m-${c.method.toLowerCase()}` }, c.method),
      el("code", { class: "path", title: c.path }, c.path),
      el("span", { class: `sc ${cls}` }, c.status ? String(c.status) : "failed"),
      el("span", { class: "ms" }, `${c.ms} ms`));
  }));
}

function logCall(method, path, status, started) {
  state.calls.unshift({ method, path: path.replace(/^\/api/, ""), status, ms: Math.round(performance.now() - started) });
  state.calls = state.calls.slice(0, 4);
  renderCalls();
}

// ---------- API ----------
class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body || {};
  }
}

function token() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function saveToken(t) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch {}
}

async function api(path, { method = "GET", body, auth = true, log = true } = {}) {
  const headers = auth ? { authorization: `Bearer ${token()}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const started = performance.now();
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    if (log) logCall(method, path, 0, started);
    throw err;
  }
  if (log) logCall(method, path, res.status, started);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

async function newWorkspace(seed) {
  const ws = await api("/api/workspaces", { method: "POST", body: { seed }, auth: false });
  saveToken(ws.token);
  return ws;
}

// ---------- rendering ----------
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  const chip = (value, label, count) =>
    el("button", { type: "button", class: `stat ${value ? `s-${value}` : "s-all"}`, "aria-pressed": String(state.status === value), dataset: { status: value }, onclick: () => setFilter(value) },
      el("span", { class: "stat-n" }, String(count)), el("span", { class: "stat-l" }, label));
  $("#stats").replaceChildren(
    chip("", "All", s.total),
    ...STATUSES.map(([v, l]) => chip(v, l, s.byStatus[v])),
    el("p", { class: "rate", id: "response-rate" }, el("strong", {}, `${Math.round(s.responseRate * 100)}%`), " response rate"),
  );
}

function rowFor(a) {
  const select = el("select", { class: `status s-${a.status}`, "aria-label": `Status of ${a.company}`, onchange: (e) => changeStatus(a, e.target) },
    ...STATUSES.map(([v, l]) => el("option", { value: v, selected: v === a.status }, l)));
  return el("tr", { dataset: { id: a.id } },
    el("td", { "data-label": "Company", class: "company" },
      el("strong", { title: a.company }, a.company),
      a.link ? el("a", { href: a.link, target: "_blank", rel: "noopener noreferrer", class: "posting", "aria-label": `Job posting for ${a.company} (opens in new tab)` }, "↗") : null),
    el("td", { "data-label": "Role" }, a.role),
    el("td", { "data-label": "Status" }, select),
    el("td", { "data-label": "Applied", class: "mono" }, fmtDate(a.appliedOn)),
    el("td", { "data-label": "Location" }, a.location || "—"),
    el("td", { class: "row-actions" },
      el("button", { type: "button", class: "btn line small", "aria-label": `Edit ${a.company}`, onclick: () => openForm(a) }, "Edit"),
      el("button", { type: "button", class: "btn line small danger-text", "aria-label": `Delete ${a.company}`, onclick: () => confirmDelete(a) }, "Delete")),
  );
}

// The page never scrolls: as many rows as fit in the table area are shown, the rest is on the next pages.
function fitPageSize() {
  const wrap = $("#table-wrap");
  const body = $("#apps-body");
  const head = $("#apps-table thead");
  const first = body.firstElementChild;
  if (!first) return;
  const gap = parseFloat(getComputedStyle(first).marginBottom) || 0;
  const rowH = first.getBoundingClientRect().height + gap;
  const headH = head && getComputedStyle(head).display !== "none" ? head.getBoundingClientRect().height : 0;
  const size = Math.max(1, Math.floor((wrap.clientHeight - headH) / rowH));
  if (size !== state.pageSize) {
    state.pageSize = size;
    renderRows();
  }
}

function renderRows() {
  const pages = Math.max(1, Math.ceil(state.items.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * state.pageSize;
  const shown = state.items.slice(start, start + state.pageSize);
  $("#apps-body").replaceChildren(...shown.map(rowFor));

  const filtered = Boolean(state.status || state.q);
  const has = state.items.length > 0;
  $("#apps-table").hidden = !has;
  $("#empty").hidden = has;
  $("#empty-title").textContent = filtered ? "No matches" : "No applications yet";
  $("#empty-text").textContent = filtered ? "Nothing matches this search or filter." : "Add the first one, or load a few examples to look around.";
  $("#sample-btn").hidden = filtered;
  $("#result-count").textContent = `${state.items.length} application${state.items.length === 1 ? "" : "s"} found`;

  $("#pager").hidden = pages <= 1;
  $("#page-info").textContent = `${start + 1}–${start + shown.length} of ${state.items.length}`;
  $("#prev-page").disabled = state.page === 0;
  $("#next-page").disabled = state.page >= pages - 1;
}

function showError(err) {
  $("#error-text").textContent = err ? `Could not reach the server: ${err.message}` : "";
  $("#error-banner").hidden = !err;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

// ---------- data ----------
async function load(lesson = "load") {
  const qs = new URLSearchParams({ sort: state.sort });
  if (state.status) qs.set("status", state.status);
  if (state.q) qs.set("q", state.q);
  try {
    const [list, stats] = await Promise.all([api(`/api/applications?${qs}`), api("/api/stats")]);
    state.items = list.items;
    state.stats = stats;
    showError(null);
    renderStats();
    renderRows();
    fitPageSize();
    explain(lesson);
  } catch (err) {
    if (err.status === 401) { await newWorkspace(false); return load("workspace"); }
    showError(err);
    explain("error");
  } finally {
    $("#loading").hidden = true;
  }
}

async function loadWorkspaceInfo() {
  try {
    const info = await api("/api/workspace", { log: false });
    const days = Math.max(0, Math.ceil((Date.parse(info.expiresAt) - Date.now()) / 864e5));
    $("#workspace-info").textContent = `${info.applications}/${info.limit} slots · deleted in ${days} day${days === 1 ? "" : "s"}`;
  } catch {}
}

function setFilter(value) {
  state.status = value;
  state.page = 0;
  load("filter");
}

async function changeStatus(app, select) {
  select.disabled = true;
  try {
    const updated = await api(`/api/applications/${app.id}`, { method: "PATCH", body: { status: select.value } });
    Object.assign(app, updated);
    select.className = `status s-${updated.status}`;
    toast(`${app.company} moved to ${LABEL[updated.status]}`);
    await load("status");
  } catch (err) {
    select.value = app.status;
    toast(`Could not update status: ${err.message}`);
    explain("error");
  } finally {
    select.disabled = false;
  }
}

// ---------- add / edit dialog ----------
const form = $("#app-form");
const dialog = $("#app-dialog");

function clearErrors() {
  form.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
  $("#form-error").textContent = "";
}

function openForm(app = null) {
  state.editing = app;
  form.reset();
  clearErrors();
  $("#dialog-title").textContent = app ? `Edit ${app.company}` : "Add application";
  $("#save-btn").textContent = app ? "Save changes" : "Save application";
  if (app) for (const name of ["company", "role", "status", "appliedOn", "location", "link", "notes"]) form.elements[name].value = app[name] || "";
  else form.elements.appliedOn.value = new Date().toISOString().slice(0, 10);
  dialog.showModal();
  form.elements.company.focus();
}

function showFieldErrors(fields) {
  for (const [name, msg] of Object.entries(fields)) {
    const slot = form.querySelector(`.err[data-for="${name}"]`);
    const input = form.elements[name];
    if (slot && input) {
      slot.id = `err-${name}`;
      slot.textContent = msg;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", slot.id);
    }
  }
  const first = form.querySelector("[aria-invalid]");
  if (first) first.focus();
  const unplaced = Object.keys(fields).filter((n) => !form.querySelector(`.err[data-for="${n}"]`));
  $("#form-error").textContent = unplaced.length ? unplaced.map((n) => `${n}: ${fields[n]}`).join(" · ") : "Please fix the highlighted fields.";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();
  const data = Object.fromEntries(new FormData(form));
  const save = $("#save-btn");
  save.disabled = true;
  try {
    if (state.editing) {
      await api(`/api/applications/${state.editing.id}`, { method: "PATCH", body: data });
      toast("Application updated");
    } else {
      await api("/api/applications", { method: "POST", body: data });
      toast("Application added");
      state.page = 0;
    }
    dialog.close();
    await Promise.all([load(state.editing ? "edit" : "add"), loadWorkspaceInfo()]);
  } catch (err) {
    if (err.status === 422 && err.body.fields) { showFieldErrors(err.body.fields); explain("invalid"); }
    else $("#form-error").textContent = err.message;
  } finally {
    save.disabled = false;
  }
});

$("#cancel-btn").addEventListener("click", () => dialog.close());
$("#add-btn").addEventListener("click", () => openForm());

// ---------- delete ----------
const confirmDialog = $("#confirm-dialog");
let pendingDelete = null;
function confirmDelete(app) {
  pendingDelete = app;
  $("#confirm-text").textContent = `${app.role} at ${app.company} will be removed for good.`;
  confirmDialog.showModal();
  $("#confirm-cancel").focus();
}
$("#confirm-cancel").addEventListener("click", () => confirmDialog.close());
$("#confirm-ok").addEventListener("click", async () => {
  const app = pendingDelete;
  confirmDialog.close();
  if (!app) return;
  if (app === "workspace") return resetWorkspace();
  try {
    await api(`/api/applications/${app.id}`, { method: "DELETE" });
    toast(`Deleted ${app.company}`);
    await Promise.all([load("delete"), loadWorkspaceInfo()]);
  } catch (err) {
    toast(`Could not delete: ${err.message}`);
  }
});

// ---------- workspace ----------
$("#reset-btn").addEventListener("click", () => {
  pendingDelete = "workspace";
  $("#confirm-title").textContent = "Reset workspace?";
  $("#confirm-text").textContent = "All applications in this workspace are deleted and you start over with the examples.";
  $("#confirm-ok").textContent = "Reset";
  confirmDialog.showModal();
  $("#confirm-cancel").focus();
});
confirmDialog.addEventListener("close", () => {
  $("#confirm-title").textContent = "Delete application?";
  $("#confirm-ok").textContent = "Delete";
});

async function freshSample(message) {
  try { await api("/api/workspace", { method: "DELETE" }); } catch {}
  await newWorkspace(true);
  state.status = "";
  state.q = "";
  state.page = 0;
  $("#search").value = "";
  toast(message);
  await Promise.all([load("workspace"), loadWorkspaceInfo()]);
}
const resetWorkspace = () => freshSample("Workspace reset");
$("#sample-btn").addEventListener("click", () => freshSample("Sample data loaded"));

// ---------- toolbar, pager, panel ----------
let searchTimer;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); state.page = 0; load("search"); }, 200);
});
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; state.page = 0; load("sort"); });
$("#retry-btn").addEventListener("click", () => load());
$("#prev-page").addEventListener("click", () => { state.page--; renderRows(); explain("page"); });
$("#next-page").addEventListener("click", () => { state.page++; renderRows(); explain("page"); });

const hood = $("#hood");
const hoodOpen = $("#hood-open");
hoodOpen.addEventListener("click", () => { hood.classList.add("open"); hoodOpen.setAttribute("aria-expanded", "true"); $("#hood-close").focus(); });
$("#hood-close").addEventListener("click", () => { hood.classList.remove("open"); hoodOpen.setAttribute("aria-expanded", "false"); hoodOpen.focus(); });

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { state.pageSize = 50; renderRows(); fitPageSize(); }, 120);
});

// ---------- start ----------
(async function start() {
  explain("load");
  let fresh = false;
  try {
    if (!token()) { await newWorkspace(true); fresh = true; }
  } catch (err) {
    $("#loading").hidden = true;
    showError(err);
    return explain("error");
  }
  await Promise.all([load(fresh ? "workspace" : "load"), loadWorkspaceInfo()]);
})();
