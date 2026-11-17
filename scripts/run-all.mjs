// One command for the full run: start the app (unless BASE_URL is set), run Playwright and Newman,
// write the summary for the Tests page, stop the app, and exit non-zero if anything failed.
import { spawn, spawnSync } from 'node:child_process';

const local = !process.env.BASE_URL;
const base = process.env.BASE_URL || 'http://127.0.0.1:8787';
const isWin = process.platform === 'win32';
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, env: { ...process.env, ...env } }).status ?? 1;

async function up() {
  try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
}

let server;
if (local && !(await up())) {
  server = spawn('npx', ['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1'], { stdio: 'ignore', shell: isWin });
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await up())) { console.error('App did not start'); process.exit(1); }
}

const env = { BASE_URL: base };
const playwright = run('npx', ['playwright', 'test'], env);
const envFile = local ? 'postman/local.postman_environment.json' : 'postman/live.postman_environment.json';
const newman = run('npx', [
  'newman', 'run', 'postman/applytrack.postman_collection.json', '-e', envFile, '--env-var', `baseUrl=${base}`,
  '-r', 'cli,htmlextra,json',
  '--reporter-htmlextra-export', 'site/reports/newman/index.html',
  '--reporter-htmlextra-title', '"ApplyTrack API - Newman run"',
  '--reporter-json-export', 'results/newman.json',
]);
run('node', ['scripts/summary.mjs'], local ? {} : env);

if (server) {
  if (isWin) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
}
process.exit(playwright || newman ? 1 : 0);
