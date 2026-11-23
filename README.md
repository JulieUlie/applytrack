# ApplyTrack

**Playwright and REST API testing.** A showcase project by Julie Toussaint, test automation engineer with five years of end-to-end testing in Ranorex, C# and Oracle PL/SQL. QA automation roles also ask for Playwright, TypeScript and API testing: this project shows those skills on a small job application tracker, with a test suite built around what the job postings ask for.

- **Overview:** https://applytrack.julietous.workers.dev
- **The app:** [/board](https://applytrack.julietous.workers.dev/board), with an *Under the hood* panel that shows the REST call behind every click and the Playwright test that covers it
- **API docs:** [/api](https://applytrack.julietous.workers.dev/api) · [OpenAPI spec](https://applytrack.julietous.workers.dev/openapi.json)
- **Test overview and latest reports:** [/tests](https://applytrack.julietous.workers.dev/tests)

## From Ranorex and C# to Playwright

| Five years with Ranorex and C# | Shown here with Playwright |
| --- | --- |
| RanoreXPath and object repositories | Locators by role and label, a page object |
| Shared C# libraries for the tests | A typed API client and custom fixtures in TypeScript |
| Oracle test-data layer, setup and teardown | Test data created through the REST API, a fresh workspace per test |
| Business logic tested in PL/SQL | API and contract tests against an OpenAPI spec, plus Postman |
| Data-driven tests | A table of invalid input, each case its own test |
| Desktop and Android handheld apps | Chromium, Firefox, WebKit and an emulated phone |
| Owner of the nightly unattended runs | GitHub Actions on every push, HTML reports with traces |
| Accessible controls added to the app under test | axe accessibility scans and a keyboard-only test |

## What is tested, and why

The suite covers what job postings for QA and test automation engineers ask for:

| Asked for in postings | Where it is covered |
| --- | --- |
| Playwright with TypeScript | `tests/`, one config with several projects |
| REST API testing | `tests/api/` with Playwright's `request` fixture |
| Postman and Newman | `postman/` collection, run with Newman locally and in CI ([open in Postman](https://www.postman.com/julie-ulies-team/julie-toussaint-public/collection/adzh7vf/applytrack-api)) |
| Swagger / OpenAPI | `site/openapi.json` + custom `toMatchSchema` matcher (`tests/support/contract.ts`) |
| Authentication flows | `tests/api/auth-and-workspaces.spec.ts` |
| Page objects, fixtures, test data | `tests/pages/board-page.ts`, `tests/fixtures.ts`, `tests/support/data.ts` |
| Isolation and parallel runs | Each test creates its own workspace through the API |
| Network mocking | `tests/ui/resilience.spec.ts` (`page.route`) |
| Cross-browser and mobile | Chromium, Firefox, WebKit, Pixel 7 |
| CI/CD | `.github/workflows/tests.yml` |
| Negative and boundary tests | `tests/api/validation.spec.ts` (data-driven) |
| Accessibility | `tests/ui/accessibility.spec.ts` (axe-core, WCAG 2.1 AA, keyboard-only flow) |
| Performance awareness | `tests/api/performance.spec.ts`, response-time budget on every Postman request |

Latest run against the live app: 196 Playwright tests (51 API, 48 Chromium, 42 Firefox, 42 WebKit, 13 mobile) and 69 Postman assertions over 17 requests, all green. The UI tests also check that no page scrolls or is wider than the screen: every page fits one screen and pages through long lists instead.

## What changed in v2

A polish release: no new features, but fixes found by looking at the app again at phone, tablet and laptop widths. Each fix has its own regression test (17 new Playwright tests).

- **Readable board on 1024px laptops and landscape tablets.** With the side panel open, six columns left the company and role unreadable ("Compan…"). Between 901 and 1199px the board now shows company, role, status and actions; date and place stay in the edit form.
- **No stale search results.** A slow, older search answer could overwrite the results of a newer one. Only the newest request may now draw the board (tested by holding one response back with `page.route`).
- **Escape closes the *Under the hood* sheet** on phones and tablets and returns focus to its button, like the dialogs.
- **Date picker:** starts on today in the visitor's own time zone (it used the UTC date, which is still yesterday just after midnight in Belgium) and offers no future dates, which the API refuses anyway.
- **Clearer error banner:** "The server answered with an error" when the API returns an error, "Could not reach the server" only when the network is down.
- **Reduced motion:** the sheet, toast and filter underline no longer animate when the system asks for less motion.
- **404 page:** the button said "Back to the board" but led to the overview; it now offers both.
- An expired workspace token is replaced once, never in a loop.

## Structure

```
src/worker.js            Cloudflare Worker: REST API + one SQLite Durable Object per workspace
site/                    Static UI: overview (index), board, API and Tests pages, openapi.json, published reports
tests/
  api/                   API tests (CRUD, validation, auth, workspaces, performance)
  ui/                    UI tests (board, paging and the Under the hood panel, mocking, accessibility, navigation, layout)
  pages/board-page.ts    Page object
  fixtures.ts            workspace / api / board fixtures (API-first setup)
  support/               API client, test data builder, OpenAPI contract matcher
postman/                 Collection + local/live environments (generated by scripts/build-collection.mjs)
scripts/                 run-all, summary for the tests page, Postman collection builder, banner renderer (og.mjs)
```

## Run locally

Requires Node 20+.

```bash
npm install
npx playwright install chromium firefox webkit
npm run dev            # app on http://127.0.0.1:8787
```

```bash
npm test               # all Playwright projects (starts the app itself if it is not running)
npm run test:api       # API tests only
npm run test:ui-mode   # Playwright UI mode, good for exploring
npm run postman        # Postman collection with Newman (app must be running)
npm run test:all       # everything + reports in site/reports + summary for the tests page
```

Run the API tests against the live app instead:

```bash
BASE_URL=https://applytrack.julietous.workers.dev npx playwright test --project=api
```

## The API in short

`POST /api/workspaces` returns a token (`{"seed": true}` adds eight example roles in Antwerp, hybrid and remote; the companies are fictional) (`at_` + 32 hex). Send it as `Authorization: Bearer …` to `/api/applications` (GET, POST), `/api/applications/{id}` (GET, PATCH, DELETE), `/api/stats` and `/api/workspace`. Validation errors are `422` with a message per field. Workspaces delete themselves after 30 days. Full reference on the [API page](https://applytrack.julietous.workers.dev/api).

## Deployment

Cloudflare Workers with static assets and a SQLite-backed Durable Object:

```bash
npm run test:all       # refresh the published reports first
npx wrangler deploy
```

## Credits

Built by Julie Toussaint. Fonts: IBM Plex (SIL Open Font License). The example companies are fictional. Test tooling: Playwright, Newman, newman-reporter-htmlextra, axe-core, Ajv.
