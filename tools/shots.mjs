/**
 * Capture reference screenshots of the built game for visual review.
 *   node tools/shots.mjs [outDir]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 4182);
const BASE = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] || '/tmp/shots');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [resolve('tools/serve.mjs'), String(PORT)], { cwd: resolve('.'), stdio: 'ignore' });
await sleep(700);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

async function shoot({ width, height, dpr, quality = 'high', prefix }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: width < 700, hasTouch: width < 700 });
  await ctx.addInitScript((q) => {
    localStorage.setItem('nightrun.save.v1', JSON.stringify({
      best: 18420, bestDistance: 2480, bestShards: 341, runs: 27, settings: { quality: q, touchpad: false },
    }));
  }, quality);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__NIGHTRUN__?.ready === true, { timeout: 30000 });
  await sleep(1400);
  await page.screenshot({ path: join(OUT, `${prefix}-menu.png`) });

  await page.click('#btn-play');
  await page.waitForFunction(() => window.__NIGHTRUN__.state === 'playing', { timeout: 10000 });

  // wait for an obstacle pair to be close and in frame
  await page.waitForFunction(
    () => {
      const n = window.__NIGHTRUN__.nearestObstacle();
      return n && n.z > -22 && n.z < -8;
    },
    { timeout: 40000 },
  ).catch(() => {});
  await page.screenshot({ path: join(OUT, `${prefix}-play1.png`) });

  await sleep(1600);
  await page.screenshot({ path: join(OUT, `${prefix}-play2.png`) });

  // jump pose
  await page.evaluate(() => window.__NIGHTRUN__.action('jump'));
  await sleep(180);
  await page.screenshot({ path: join(OUT, `${prefix}-jump.png`) });
  await sleep(900);

  // slide pose
  await page.evaluate(() => window.__NIGHTRUN__.action('slide'));
  await sleep(140);
  await page.screenshot({ path: join(OUT, `${prefix}-slide.png`) });
  await sleep(1200);

  // pause
  await page.evaluate(() => window.__NIGHTRUN__.pause());
  await sleep(600);
  await page.screenshot({ path: join(OUT, `${prefix}-pause.png`) });
  await page.evaluate(() => window.__NIGHTRUN__.resume());
  await sleep(400);

  // settings
  await page.evaluate(() => {
    const b = document.getElementById('btn-pause');
    b && b.click();
  });
  await sleep(300);
  await page.evaluate(() => document.getElementById('btn-pause-settings').click());
  await sleep(600);
  await page.screenshot({ path: join(OUT, `${prefix}-settings.png`) });
  await page.evaluate(() => document.getElementById('btn-settings-close').click());
  await sleep(300);
  await page.evaluate(() => document.getElementById('btn-resume').click());
  await sleep(300);

  // die for the game over screen
  await page.waitForFunction(() => window.__NIGHTRUN__.state === 'over', { timeout: 120000 }).catch(() => {});
  await sleep(900);
  await page.screenshot({ path: join(OUT, `${prefix}-over.png`) });

  await ctx.close();
  console.log('captured', prefix);
}

const which = process.argv[3];
if (which !== 'desktop') await shoot({ width: 430, height: 900, dpr: 1.6, prefix: 'mobile' });
if (which !== 'mobile') await shoot({ width: 1280, height: 800, dpr: 1, prefix: 'desktop' });

await browser.close();
server.kill();
console.log('screenshots in', OUT);
