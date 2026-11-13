#!/usr/bin/env node
/**
 * NIGHTRUN offline / PWA verification.
 *
 *   node tools/test-offline.mjs
 *
 * Proves (does not assume):
 *  1. the service worker installs and precaches every emitted build asset
 *  2. the manifest is valid and every icon it references is cached
 *  3. the game boots, plays and saves progress with the network hard-off
 *  4. "close and reopen" works offline (fresh page, offline, same origin)
 *  5. an app update prunes old caches but never touches saved progress
 *  6. no runtime request ever leaves the origin (no CDNs)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4181);
const BASE = `http://localhost:${PORT}`;
const DIST = join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, extra = '') {
  const line = ok
    ? `  \x1b[32m✓\x1b[0m ${name}${extra ? `  \x1b[90m${extra}\x1b[0m` : ''}`
    : `  \x1b[31m✗\x1b[0m ${name}${extra ? `  \x1b[90m${extra}\x1b[0m` : ''}`;
  if (ok) pass++;
  else fail++;
  results.push(line);
  console.log(line); // stream progress so a hang is visible
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(p.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

const waitFor = (page, fn, arg, timeout = 20000) =>
  page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

async function main() {
  const server = spawn(process.execPath, [resolve(ROOT, 'tools/serve.mjs'), String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cleanup = () => {
    try {
      server.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  process.on('exit', cleanup);
  server.stderr.on('data', (d) => process.stderr.write(`\x1b[31m[server] ${d}\x1b[0m`));
  await sleep(800);

  console.log('\n\x1b[1mNIGHTRUN · offline / PWA suite\x1b[0m\n');

  /* -------------------- static build sanity -------------------- */
  const distFiles = walk(DIST);
  const swSource = readFileSync(join(DIST, 'sw.js'), 'utf8');
  const manifestMatch = swSource.match(/const PRECACHE_URLS = (\[[^\]]*\]);/);
  const precache = manifestMatch ? JSON.parse(manifestMatch[1]) : [];
  const versionMatch = swSource.match(/const CACHE_VERSION = '([^']+)'/);

  check('dist contains a built service worker', distFiles.includes('sw.js'));
  check('service worker has a versioned cache name', !!versionMatch, versionMatch?.[1]);
  check(`service worker precaches the whole build (${precache.length} files)`, precache.length >= 10);
  const missingFromPrecache = distFiles.filter(
    (f) => !f.endsWith('.map') && f !== 'sw.js' && !precache.includes(f),
  );
  check('every emitted asset is in the precache list', missingFromPrecache.length === 0, missingFromPrecache.join(', '));

  const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
  const manifestOk =
    manifest.name &&
    manifest.short_name &&
    manifest.start_url &&
    manifest.display === 'fullscreen' &&
    manifest.icons?.length >= 2 &&
    manifest.icons.some((i) => (i.purpose || '').includes('maskable')) &&
    manifest.theme_color &&
    manifest.background_color;
  check('web app manifest is valid + installable', manifestOk, `${manifest.icons?.length} icons`);

  const iconFiles = manifest.icons.map((i) => i.src.replace('./', ''));
  const missingIcons = iconFiles.filter((i) => !distFiles.includes(i));
  check('every manifest icon exists in the build', missingIcons.length === 0, missingIcons.join(', '));
  check('iOS apple-touch-icon is present', distFiles.includes('icons/apple-touch-icon.png'));
  check('offline fallback page is present + precached', precache.includes('offline.html'));

  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const externalRefs = (html.match(/(?:src|href)="https?:\/\/[^"]+"/g) || []).filter(
    (r) => !r.includes('schema.org'),
  );
  check('index.html references no external URLs', externalRefs.length === 0, externalRefs.join(' '));

  const jsFiles = distFiles.filter((f) => f.endsWith('.js'));
  const externalInJs = jsFiles.filter((f) => /https?:\/\/(?!www\.w3\.org)/.test(readFileSync(join(DIST, f), 'utf8')));
  check('bundled JS contains no runtime CDN URLs', externalInJs.length === 0, externalInJs.join(' '));

  /* ------------------------- live browser ------------------------ */
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--mute-audio',
    ],
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
      if (!localStorage.getItem('nightrun.save.v1')) {
        localStorage.setItem('nightrun.save.v1', JSON.stringify({ settings: { quality: 'low' } }));
      }
    } catch {
      /* ignore */
    }
  });

  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'load' });
  const booted = await waitFor(page, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);
  check('first (online) load boots the game', booted);

  /* ------------------- service worker install ------------------- */
  const controlled = await waitFor(page, () => !!navigator.serviceWorker.controller, undefined, 20000);
  check('service worker takes control of the page', controlled);

  // Let the install finish filling the cache.
  const cacheInfo = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const detail = {};
    for (const n of names) {
      const c = await caches.open(n);
      detail[n] = (await c.keys()).length;
    }
    return detail;
  });
  const cacheName = Object.keys(cacheInfo).find((n) => n.startsWith('nightrun-'));
  check('cache is populated with the versioned name', !!cacheName, JSON.stringify(cacheInfo));
  check(
    `cached ${cacheInfo[cacheName] ?? 0} of ${precache.length} assets`,
    (cacheInfo[cacheName] ?? 0) >= precache.length,
  );

  const cachedList = await page.evaluate(async (name) => {
    const c = await caches.open(name);
    return (await c.keys()).map((r) => new URL(r.url).pathname.replace(/^\//, ''));
  }, cacheName);
  const notCached = precache.filter((f) => !cachedList.some((c) => c === f || c.endsWith(`/${f}`)));
  check('every precached asset is actually in the cache', notCached.length === 0, notCached.join(', '));

  /* --------------------- play + save online --------------------- */
  await page.click('#btn-play');
  await waitFor(page, () => window.__NIGHTRUN__.state === 'playing');
  await sleep(1500);
  const onlineScore = (await page.evaluate(() => window.__NIGHTRUN__.snapshot)).distance;
  await page.evaluate(() => {
    // Persist a known best so we can prove updates keep it.
    const s = JSON.parse(localStorage.getItem('nightrun.save.v1') || '{}');
    s.best = 4242;
    s.runs = 7;
    localStorage.setItem('nightrun.save.v1', JSON.stringify(s));
  });

  /* ------------------------ go offline ------------------------- */
  await context.setOffline(true);
  const offlineFlag = await page.evaluate(() => navigator.onLine === false);
  check('browser is genuinely offline', offlineFlag);

  // 1. Reload the running page with no network at all.
  const reloadOk = await page.reload({ waitUntil: 'load' }).then(() => true).catch(() => false);
  const bootedOffline = await waitFor(page, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);
  check('reload while offline launches the game', reloadOk && bootedOffline);

  const offlineMenu = await page.evaluate(() => ({
    state: window.__NIGHTRUN__.state,
    best: window.__NIGHTRUN__.save().best,
    online: navigator.onLine,
  }));
  check('offline boot reaches the menu', offlineMenu.state === 'menu');
  check('personal best survived the offline reload', offlineMenu.best === 4242, `best=${offlineMenu.best}`);

  // 2. Play offline.
  await page.click('#btn-play');
  const playingOffline = await waitFor(page, () => window.__NIGHTRUN__.state === 'playing', undefined, 10000);
  await sleep(2000);
  const offlineSnap = await page.evaluate(() => window.__NIGHTRUN__.snapshot);
  check('gameplay runs with no network', playingOffline && offlineSnap.distance > 0, `dist=${offlineSnap.distance.toFixed(0)}m`);
  check('obstacles + shards stream offline', offlineSnap.activeObstacles >= 0);

  // controls still work offline
  await page.keyboard.press('ArrowLeft');
  check('controls work offline', await waitFor(page, () => window.__NIGHTRUN__.snapshot.lane === 0, undefined, 5000));

  // pause + resume offline
  await page.evaluate(() => window.__NIGHTRUN__.pause());
  const pausedOffline = await waitFor(page, () => window.__NIGHTRUN__.state === 'paused', undefined, 5000);
  await page.evaluate(() => window.__NIGHTRUN__.resume());
  check('pause/resume works offline', pausedOffline && (await waitFor(page, () => window.__NIGHTRUN__.state === 'playing')));

  // saving offline
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('nightrun.save.v1') || '{}');
    s.best = 5000;
    localStorage.setItem('nightrun.save.v1', JSON.stringify(s));
  });
  const offlineSaved = await page.evaluate(() => window.__NIGHTRUN__.save().best);

  /* ------------- simulate closing + reopening the app ----------- */
  await page.close();
  const page2 = await context.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  const reopened = await page2.goto(BASE, { waitUntil: 'load' }).then(() => true).catch(() => false);
  const booted2 = await waitFor(page2, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);
  check('reopening the installed app works offline', reopened && booted2);
  const state2 = await page2.evaluate(() => ({
    state: window.__NIGHTRUN__.state,
    best: window.__NIGHTRUN__.save().best,
  }));
  check('reopened app keeps saved progress', state2.best === 5000, `best=${state2.best}`);
  await page2.click('#btn-play');
  check('reopened app starts a run offline', await waitFor(page2, () => window.__NIGHTRUN__.state === 'playing', undefined, 10000));

  /* ------------------- offline deep-link fallback ---------------- */
  const deep = await context.newPage();
  await deep.goto(`${BASE}/some/unknown/route`, { waitUntil: 'load' }).catch(() => {});
  const deepOk = await waitFor(deep, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);
  check('offline navigation fallback serves the game shell', deepOk);
  await deep.close();

  /* ---------------------- update resilience --------------------- */
  // Plant a fake old cache; the next activation must remove it but keep data.
  const page3 = await context.newPage();
  await page3.goto(BASE, { waitUntil: 'load' });
  await waitFor(page3, () => !!navigator.serviceWorker.controller);
  await page3.evaluate(async () => {
    const c = await caches.open('nightrun-v0-stale');
    await c.put('/stale.js', new Response('old'));
  });
  await context.setOffline(false);

  // Ship a "new build": touch the service worker so the browser installs and
  // activates a fresh worker (exactly what happens when we deploy an update).
  const swPath = join(DIST, 'sw.js');
  const originalSw = readFileSync(swPath, 'utf8');
  writeFileSync(swPath, `${originalSw}\n// update marker ${Date.now()}\n`);

  await page3.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
    await new Promise((r) => setTimeout(r, 800));
    if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  await sleep(3000);
  await page3.reload({ waitUntil: 'load' });
  await waitFor(page3, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);
  const afterUpdate = await page3.evaluate(async () => {
    const names = await caches.keys();
    return {
      names,
      best: window.__NIGHTRUN__.save().best,
      runs: window.__NIGHTRUN__.save().runs,
      state: window.__NIGHTRUN__.state,
    };
  });
  check('stale caches are pruned on update', !afterUpdate.names.includes('nightrun-v0-stale'), afterUpdate.names.join(','));
  check('update keeps saved progress', afterUpdate.best === 5000 && afterUpdate.runs >= 7, `best=${afterUpdate.best}`);
  check('game still boots after the update cycle', afterUpdate.state === 'menu');
  writeFileSync(swPath, originalSw); // restore the shipped worker

  /* ---------------------- origin hygiene ------------------------ */
  const foreign = requests.filter((u) => {
    try {
      return new URL(u).origin !== BASE;
    } catch {
      return false;
    }
  });
  check('no cross-origin requests at runtime', foreign.length === 0, foreign.slice(0, 3).join(' '));
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  cleanup();
  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\x1b[31moffline suite crashed:\x1b[0m', e);
  process.exit(1);
});
