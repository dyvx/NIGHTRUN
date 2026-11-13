#!/usr/bin/env node
/**
 * Live deployment smoke test — proves the *hosted* build boots, plays, caches
 * itself, and keeps working offline.
 *
 *   node tools/test-live.mjs https://nightrun-five.vercel.app
 */
import { chromium } from 'playwright';

const URL_UNDER_TEST = process.argv[2] || 'https://nightrun-five.vercel.app';
let pass = 0;
let fail = 0;
const out = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, extra = '') {
  const line = ok
    ? `  \x1b[32m✓\x1b[0m ${name}${extra ? `  \x1b[90m${extra}\x1b[0m` : ''}`
    : `  \x1b[31m✗\x1b[0m ${name}${extra ? `  \x1b[90m${extra}\x1b[0m` : ''}`;
  if (ok) pass++;
  else fail++;
  out.push(line);
  console.log(line);
}

const waitFor = (page, fn, arg, timeout = 25000) =>
  page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
await context.addInitScript(() => {
  try {
    localStorage.setItem('nightrun.save.v1', JSON.stringify({ settings: { quality: 'low' } }));
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();
const failures = [];
page.on('pageerror', (e) => failures.push(e.message));

console.log(`\n\x1b[1mNIGHTRUN · live deployment check\x1b[0m  \x1b[90m${URL_UNDER_TEST}\x1b[0m\n`);

const resp = await page.goto(URL_UNDER_TEST, { waitUntil: 'load' });
check('serves the app (HTTP 200)', resp && resp.status() === 200, `status=${resp?.status()}`);
check('reaches the menu', await waitFor(page, () => window.__NIGHTRUN__?.ready === true, undefined, 40000));

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel=manifest]');
  const res = await fetch(link.href);
  return { status: res.status, json: await res.json() };
});
check('web manifest is served + parseable', manifest.status === 200 && !!manifest.json.name, manifest.json.display);

check('service worker controls the page', await waitFor(page, () => !!navigator.serviceWorker.controller, undefined, 30000));

const cache = await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  const names = await caches.keys();
  const detail = {};
  for (const n of names) detail[n] = (await (await caches.open(n)).keys()).length;
  return detail;
});
const total = Object.values(cache).reduce((a, b) => a + b, 0);
check('full build precached', total >= 14, `${total} entries · ${Object.keys(cache).join(',')}`);

await page.click('#btn-play');
check('a run starts', await waitFor(page, () => window.__NIGHTRUN__.state === 'playing', undefined, 15000));
await sleep(2500);
const snap = await page.evaluate(() => window.__NIGHTRUN__.snapshot);
check('the game simulates on the live host', snap.distance > 1, `dist=${snap.distance.toFixed(0)}m`);

await page.keyboard.press('ArrowLeft');
check('input works', await waitFor(page, () => window.__NIGHTRUN__.snapshot.lane === 0, undefined, 5000));

/* ------------------------- offline on the live host ------------------------- */
await context.setOffline(true);
check('browser offline', await page.evaluate(() => navigator.onLine === false));
const reloaded = await page.reload({ waitUntil: 'load' }).then(() => true).catch(() => false);
check('reload while offline works', reloaded && (await waitFor(page, () => window.__NIGHTRUN__?.ready === true, undefined, 30000)));
await page.click('#btn-play');
check('plays offline from the installed cache', await waitFor(page, () => window.__NIGHTRUN__.state === 'playing', undefined, 12000));

check('no page errors', failures.length === 0, failures.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
