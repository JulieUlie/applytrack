// Reads the Playwright and Newman JSON results and writes site/reports/summary.json for the Tests page.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
const pw = read('results/playwright.json');
const nm = read('results/newman.json');

const summary = { generatedAt: new Date().toISOString(), target: process.env.BASE_URL || 'a local build (wrangler dev)' };

if (pw) {
  const s = pw.stats;
  const projects = {};
  const walk = (suite) => {
    for (const spec of suite.specs || []) for (const t of spec.tests) projects[t.projectName] = (projects[t.projectName] || 0) + 1;
    for (const child of suite.suites || []) walk(child);
  };
  pw.suites.forEach(walk);
  summary.playwright = {
    passed: s.expected + s.flaky,
    failed: s.unexpected,
    flaky: s.flaky,
    skipped: s.skipped,
    durationMs: Math.round(s.duration),
    projects,
  };
}

if (nm) {
  const st = nm.run.stats;
  summary.newman = {
    requests: st.requests.total,
    assertions: st.assertions.total,
    failedAssertions: st.assertions.failed,
    durationMs: nm.run.timings.completed - nm.run.timings.started,
  };
}

mkdirSync('site/reports', { recursive: true });
writeFileSync('site/reports/summary.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
