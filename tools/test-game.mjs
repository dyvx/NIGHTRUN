#!/usr/bin/env node
/**
 * NIGHTRUN gameplay test suite — drives the real, built game in a real
 * browser with real WebGL.
 *
 *   node tools/test-game.mjs            # headless (software GL)
 *   node tools/test-game.mjs --headed   # watch it play
 *
 * Covers: boot, lane switching, jumping, sliding, collisions, game over,
 * score/best persistence across reloads, repeated restarts, pause/resume,
 * touch swipes, on-screen pad, responsive resizing, memory, and frame pacing.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4180);
const BASE = `http://localhost:${PORT}`;
const HEADED = process.argv.includes('--headed');

let pass = 0;
let fail = 0;
const results = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    results.push(`  \x1b[32m✓\x1b[0m ${name}${extra ? `  \x1b[90m${extra}\x1b[0m` : ''}`);
  } else {
    fail++;
    results.push(`  \x1b[31m✗\x1b[0m ${name}${extra ? `  \x1b[90m${extra}\x1b[0m` : ''}`);
  }
}

/**
 * Clicking a button that instantly swaps screens confuses Playwright's
 * actionability retry loop (the element legitimately disappears mid-check),
 * so UI navigation uses a direct DOM click. Real pointer input is exercised
 * separately (mouse click on play, swipes, on-screen pad).
 */
async function tap(page, selector) {
  await page.waitForSelector(selector, { state: 'attached', timeout: 20000 });
  await page.$eval(selector, (el) => el.click());
}

const waitFor = (page, fn, arg, timeout = 20000) =>
  page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

async function startServer() {
  const child = spawn(process.execPath, [resolve(ROOT, 'tools/serve.mjs'), String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`\x1b[90m[server] ${d}\x1b[0m`));
  child.stderr.on('data', (d) => process.stderr.write(`\x1b[31m[server] ${d}\x1b[0m`));
  await sleep(700);
  return child;
}

async function main() {
  const server = await startServer();
  const cleanup = () => {
    try {
      server.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  process.on('exit', cleanup);
  process.on('uncaughtException', (e) => {
    cleanup();
    console.error(e);
    process.exit(1);
  });

  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
      '--mute-audio',
      '--enable-precise-memory-info',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    // Software GL: keep the pixel budget small — game logic is identical.
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13 Pro Max'].userAgent,
  });

  // Boot on the LOW preset so the software renderer keeps up, without
  // clobbering any save that is already on the device.
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
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const snap = () => page.evaluate(() => window.__NIGHTRUN__.snapshot);

  console.log('\n\x1b[1mNIGHTRUN · gameplay suite\x1b[0m\n');

  /* ================================ boot ================================ */
  await page.goto(BASE, { waitUntil: 'load' });
  const booted = await waitFor(page, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);
  check('boots and reaches the main menu', booted && (await snap()).state === 'menu');

  const glInfo = await page.evaluate(() => {
    const c = document.getElementById('stage');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { has: !!gl, w: c.width, h: c.height };
  });
  check('WebGL canvas is live', glInfo.has && glInfo.w > 0 && glInfo.h > 0, `${glInfo.w}x${glInfo.h}`);
  check('main menu is on screen', await page.isVisible('#screen-menu'));
  check('play button is interactive', await page.isEnabled('#btn-play'));

  // Real mouse click (verifies pointer input reaches the DOM controls).
  await page.click('#btn-play');
  check('mouse click starts a run', await waitFor(page, () => window.__NIGHTRUN__.state === 'playing'));

  let s = await snap();
  check('speed starts at the tuned baseline', Math.abs(s.speed - 15.5) < 1.5, `speed=${s.speed.toFixed(1)}`);
  check('HUD is visible during play', await page.isVisible('#hud'));

  /* ========================== lane switching =========================== */
  await page.keyboard.press('ArrowLeft');
  const leftOk = await waitFor(page, () => {
    const n = window.__NIGHTRUN__.snapshot;
    return n.lane === 0 && Math.abs(n.playerX + 2.3) < 0.06;
  });
  check('keyboard ← moves to the left lane', leftOk);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const rightOk = await waitFor(page, () => {
    const n = window.__NIGHTRUN__.snapshot;
    return n.lane === 2 && Math.abs(n.playerX - 2.3) < 0.06;
  });
  check('keyboard → moves to the right lane', rightOk);

  await page.keyboard.press('ArrowRight');
  await sleep(200);
  check('lane index clamps at the wall', (await snap()).lane === 2);

  await page.keyboard.press('KeyA');
  const backOk = await waitFor(page, () => window.__NIGHTRUN__.snapshot.lane === 1);
  check('WASD keys mirror the arrows', backOk);

  /* =============================== jump ================================ */
  await page.keyboard.press('Space');
  const rose = await waitFor(page, () => window.__NIGHTRUN__.snapshot.playerY > 0.4, undefined, 4000);
  check('jump lifts the player off the road', rose, `y=${(await snap()).playerY.toFixed(2)}`);

  const apex = await page.evaluate(async () => {
    let max = 0;
    for (let i = 0; i < 90; i++) {
      max = Math.max(max, window.__NIGHTRUN__.snapshot.playerY);
      if (window.__NIGHTRUN__.snapshot.playerState === 'run' && i > 20) break;
      await new Promise((r) => setTimeout(r, 16));
    }
    return max;
  });
  check('jump apex clears the barrier', apex > 0.75, `apex=${apex.toFixed(2)}m`);

  const landed = await waitFor(page, () => {
    const n = window.__NIGHTRUN__.snapshot;
    return n.playerY === 0 && n.playerState === 'run';
  }, undefined, 8000);
  check('player lands and resumes running', landed);

  /* =============================== slide =============================== */
  await page.keyboard.press('ArrowDown');
  const slid = await waitFor(page, () => {
    const n = window.__NIGHTRUN__.snapshot;
    return n.playerState === 'slide' && n.playerHeight < 1;
  }, undefined, 4000);
  check('slide drops the hitbox under gate height', slid, `h=${(await snap()).playerHeight}`);

  const stood = await waitFor(page, () => {
    const n = window.__NIGHTRUN__.snapshot;
    return n.playerState === 'run' && n.playerHeight > 1;
  }, undefined, 8000);
  check('player stands back up after the slide', stood);

  /* ============================== scoring ============================== */
  const before = await snap();
  await sleep(1200);
  const after = await snap();
  check(
    'distance and score accrue over time',
    after.distance > before.distance && after.score > before.score,
    `dist=${after.distance.toFixed(0)}m score=${after.score}`,
  );

  /* =========================== pause / resume ========================== */
  await page.click('#btn-pause');
  check('pause button opens the pause screen', await waitFor(page, () => window.__NIGHTRUN__.state === 'paused'));
  const frozenA = await snap();
  await sleep(900);
  const frozenB = await snap();
  check('pause freezes the simulation', frozenA.distance === frozenB.distance);

  await tap(page, '#btn-resume');
  const resumed = await waitFor(page, () => window.__NIGHTRUN__.state === 'playing' && window.__NIGHTRUN__.snapshot.distance > 0);
  check('resume continues the same run', resumed);

  await page.keyboard.press('Escape');
  check('Escape pauses', await waitFor(page, () => window.__NIGHTRUN__.state === 'paused'));
  await page.keyboard.press('Escape');
  check('Escape resumes', await waitFor(page, () => window.__NIGHTRUN__.state === 'playing'));

  /* ==================== collision → game over ========================== */
  const died = await waitFor(
    page,
    () => ['dying', 'over'].includes(window.__NIGHTRUN__.state),
    undefined,
    90000,
  );
  check('running into an obstacle ends the run', died);
  const overShown = await waitFor(page, () => window.__NIGHTRUN__.state === 'over', undefined, 15000);
  check('game-over screen appears', overShown && (await page.isVisible('#screen-over')));

  const over = await snap();
  check('final score is recorded', over.score > 0, `score=${over.score}`);
  const overScoreText = (await page.textContent('#over-score')).replace(/,/g, '');
  check('game-over screen shows the score', overScoreText === String(over.score));

  const savedAfterDeath = await page.evaluate(() => window.__NIGHTRUN__.save());
  check(
    'personal best written to localStorage',
    savedAfterDeath.best === over.best && over.best > 0,
    `best=${savedAfterDeath.best}`,
  );
  check('run counter incremented', savedAfterDeath.runs >= 1, `runs=${savedAfterDeath.runs}`);

  /* ============================= restart =============================== */
  for (let i = 0; i < 3; i++) {
    await tap(page, '#btn-restart');
    const started = await waitFor(page, () => window.__NIGHTRUN__.state === 'playing', undefined, 8000);
    await sleep(300);
    const r = await snap();
    check(
      `restart #${i + 1} begins a clean run`,
      started && r.lane === 1 && r.score < over.score && r.playerY === 0,
      `score=${r.score}`,
    );
  }

  /* ==================== persistence across reload ====================== */
  const bestBefore = (await snap()).best;
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);
  const afterReload = await snap();
  check('personal best survives a reload', afterReload.best === bestBefore && bestBefore > 0, `best=${afterReload.best}`);
  const menuBestText = (await page.textContent('#menu-best')).replace(/,/g, '');
  check('main menu displays the saved best', menuBestText === String(bestBefore));

  /* ======================= touch swipe controls ======================== */
  await page.click('#btn-play');
  await waitFor(page, () => window.__NIGHTRUN__.state === 'playing');

  const swipe = async (x0, y0, x1, y1) =>
    page.evaluate(
      ([x0, y0, x1, y1]) => {
        const el = document.getElementById('stage');
        const fire = (type, x, y) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          );
        fire('pointerdown', x0, y0);
        fire('pointermove', (x0 + x1) / 2, (y0 + y1) / 2);
        fire('pointermove', x1, y1);
        fire('pointerup', x1, y1);
      },
      [x0, y0, x1, y1],
    );

  await swipe(200, 500, 310, 505);
  check('swipe right changes lane', await waitFor(page, () => window.__NIGHTRUN__.snapshot.lane === 2, undefined, 4000));
  await swipe(200, 500, 80, 502);
  check('swipe left changes lane', await waitFor(page, () => window.__NIGHTRUN__.snapshot.lane === 1, undefined, 4000));

  await swipe(200, 520, 202, 380);
  check('swipe up jumps', await waitFor(page, () => window.__NIGHTRUN__.snapshot.playerY > 0.3, undefined, 4000));
  await waitFor(page, () => window.__NIGHTRUN__.snapshot.playerState === 'run', undefined, 8000);

  await swipe(200, 480, 202, 640);
  check(
    'swipe down slides',
    await waitFor(
      page,
      () => {
        const n = window.__NIGHTRUN__.snapshot;
        return n.playerState === 'slide' && n.playerHeight < 1;
      },
      undefined,
      4000,
    ),
  );
  await waitFor(page, () => window.__NIGHTRUN__.snapshot.playerState === 'run', undefined, 8000);

  /* ===================== optional on-screen pad ======================== */
  await page.evaluate(() => {
    const sw = document.getElementById('opt-touchpad');
    if (sw.getAttribute('aria-checked') !== 'true') sw.click();
    document.getElementById('btn-play'); // no-op, keeps linters quiet
  });
  await sleep(250);
  const padVisible = await page.isVisible('#touch-pad');
  check('on-screen pad can be enabled', padVisible);
  if (padVisible) {
    const laneBefore = (await snap()).lane;
    await page.click('.touch-btn--right');
    const moved = await waitFor(
      page,
      (l) => window.__NIGHTRUN__.snapshot.lane === Math.min(2, l + 1),
      laneBefore,
      4000,
    );
    check('on-screen pad steers the runner', moved, `lane ${laneBefore} → ${(await snap()).lane}`);
  }
  // settings must persist
  const persisted = await page.evaluate(() => window.__NIGHTRUN__.save().settings);
  check('settings persist to storage', persisted.touchpad === true);

  /* ========================== responsive ============================== */
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(600);
  const landscape = await page.evaluate(() => {
    const c = document.getElementById('stage');
    return { w: c.clientWidth, h: c.clientHeight, playing: window.__NIGHTRUN__.state };
  });
  check('landscape resize keeps playing', landscape.w > landscape.h, `${landscape.w}x${landscape.h}`);

  await page.setViewportSize({ width: 320, height: 568 });
  await sleep(500);
  check('small viewport resize keeps playing', (await snap()).state === 'playing');

  await page.setViewportSize({ width: 390, height: 780 });
  await sleep(400);

  /* ======================= quality presets ============================ */
  const beforeQ = consoleErrors.length;
  await page.evaluate(() => window.__NIGHTRUN__.setQuality('high'));
  await sleep(700);
  const high = await snap();
  const highShot = await page.evaluate(() => document.getElementById('stage').width);
  check('HIGH quality preset applies', high.quality === 'high' && highShot > 0, `buffer=${highShot}px`);
  await page.evaluate(() => window.__NIGHTRUN__.setQuality('low'));
  await sleep(500);
  check('LOW quality preset applies', (await snap()).quality === 'low');
  check('quality switching logs no errors', consoleErrors.length === beforeQ);

  /* ========================= frame pacing ============================= */
  const fps = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 300));
      samples.push(window.__NIGHTRUN__.snapshot.fps);
    }
    return samples;
  });
  const avgFps = fps.reduce((a, b) => a + b, 0) / fps.length;
  check('renders continuously (software GL floor)', avgFps > 8, `avg=${avgFps.toFixed(1)}fps`);

  /* ============================ errors =============================== */
  const realErrors = consoleErrors.filter((e) => !/favicon|manifest|ServiceWorker|Failed to load resource/i.test(e));
  check('no runtime console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  /* ====================== restarts / memory ========================== */
  const mem = await page.evaluate(async () => {
    const read = () => performance.memory?.usedJSHeapSize ?? 0;
    const start = read();
    for (let i = 0; i < 6; i++) {
      window.__NIGHTRUN__.restart();
      await new Promise((r) => setTimeout(r, 300));
    }
    return { start, end: read() };
  });
  if (mem.start) {
    const growthMb = (mem.end - mem.start) / 1048576;
    check('six restarts do not leak memory', growthMb < 40, `Δ=${growthMb.toFixed(1)}MB`);
  } else {
    check('six restarts do not leak memory', true, 'skipped (no heap API)');
  }

  /* ============================ teardown ============================= */
  await browser.close();
  cleanup();
  console.log(results.join('\n'));
  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\x1b[31mtest suite crashed:\x1b[0m', err);
  process.exit(1);
});
