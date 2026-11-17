// Renders scripts/og.html to the 1200x630 share banner: node scripts/og.mjs site/og-YYYYMMDD.png
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
const out = process.argv[2] || 'site/og.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL('scripts/og.html').href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
