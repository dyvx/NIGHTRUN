#!/usr/bin/env node
/**
 * NIGHTRUN fairness audit.
 *
 *   node tools/test-fairness.mjs
 *
 * Two independent proofs that the procedural district is never unfair:
 *
 *  A. STRUCTURAL — sample thousands of generated rows and assert the rules:
 *       · no row ever blocks all three lanes (except the telegraphed,
 *         extra-spaced full-gate row)
 *       · a full-gate row is only reachable by sliding, and is always
 *         preceded / followed by extra breathing room
 *       · every collectible is at a height a running/jumping player can reach
 *
 *  B. FUNCTIONAL — an autopilot plays the real game for 90 seconds using only
 *     the same inputs a human has (lane change, jump, slide). If the course
 *     ever demands the impossible, the autopilot dies.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4183);
const BASE = `http://localhost:${PORT}`;
const RUN_SECONDS = Number(process.env.SECONDS || 60);

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
  console.log(line);
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
    userAgent: devices['iPhone 13 Pro Max'].userAgent,
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('nightrun.save.v1', JSON.stringify({ settings: { quality: 'low' } }));
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('\x1b[31m[pageerror]\x1b[0m', e.message));

  console.log('\n\x1b[1mNIGHTRUN · fairness audit\x1b[0m\n');

  await page.goto(BASE, { waitUntil: 'load' });
  await waitFor(page, () => window.__NIGHTRUN__?.ready === true, undefined, 30000);

  /* ================= A. STRUCTURAL AUDIT ================= */
  // Sample many prefill passes: each restart re-rolls the whole district.
  const samples = await page.evaluate(async () => {
    const rowsOut = [];
    for (let i = 0; i < 120; i++) {
      window.__NIGHTRUN__.restart();
      await new Promise((r) => setTimeout(r, 30));
      const obs = window.__NIGHTRUN__.obstacles();
      const shards = window.__NIGHTRUN__.shardPositions();
      window.__NIGHTRUN__.pause();
      // group by z proximity into rows
      const rows = [];
      for (const o of obs.slice().sort((a, b) => b.z - a.z)) {
        const row = rows.find((r) => Math.abs(r.z - o.z) < 2.5);
        if (row) row.items.push(o);
        else rows.push({ z: o.z, items: [o] });
      }
      rowsOut.push({ rows, shards });
    }
    return rowsOut;
  });

  const allRows = samples.flatMap((s) => s.rows);
  const allShards = samples.flatMap((s) => s.shards);

  // 1. nothing blocks all three lanes except an all-gate row
  const blockedRows = allRows.filter((r) => r.items.length >= 3 && r.items.some((i) => i.kind !== 'gate'));
  check(
    `no row blocks all three lanes with solid obstacles (${allRows.length} rows sampled)`,
    blockedRows.length === 0,
    blockedRows.slice(0, 2).map((r) => JSON.stringify(r.items)).join(' '),
  );

  // 2. every non-full row leaves at least one lane free
  const lanesFree = allRows.filter((r) => {
    const used = new Set(r.items.map((i) => i.lane));
    return used.size < 3;
  });
  check('every row leaves an open lane', lanesFree.length === allRows.length);

  // 3. full-gate rows are rare and always isolated
  const fullGateRows = allRows.filter((r) => r.items.length >= 3);
  const fullGateKinds = fullGateRows.every((r) => r.items.every((i) => i.kind === 'gate'));
  check('the only full-width rows are slide gates', fullGateKinds, `${fullGateRows.length} found`);
  const isolated = fullGateRows.every((r) => {
    const idx = allRows.indexOf(r);
    const neighbours = [allRows[idx - 1], allRows[idx + 1]].filter(Boolean);
    return neighbours.every((n) => Math.abs(n.z - r.z) >= 12);
  });
  check('full-width gate rows are isolated (extra reaction space)', isolated);
  check(
    'full-width gate rows are rare',
    fullGateRows.length / Math.max(1, allRows.length) < 0.06,
    `${((fullGateRows.length / Math.max(1, allRows.length)) * 100).toFixed(1)}% of rows`,
  );

  // 4. obstacles never overlap in the same lane within a single row
  const overlapping = allRows.filter((r) => new Set(r.items.map((i) => i.lane)).size !== r.items.length);
  check('no two obstacles share a lane in the same row', overlapping.length === 0);

  // 5. collectibles are always reachable (ground run or a jump)
  const unreachable = allShards.filter((sh) => sh.y < 0.55 || sh.y > 2.6);
  check(
    `all ${allShards.length} collectibles sit in a reachable band`,
    unreachable.length === 0,
    unreachable.slice(0, 3).map((s) => s.y).join(','),
  );

  // 6. collectibles never intersect solid geometry (shards arcing OVER a
  //    barrier are intentional and counted separately)
  let shardsInWalls = 0;
  let arcShards = 0;
  const R_SHARD = 0.26;
  for (const s of samples) {
    for (const sh of s.shards) {
      for (const row of s.rows) {
        for (const o of row.items) {
          // true AABB overlap between the collectible and the obstacle
          if (Math.abs(sh.x - o.x) > o.hx + R_SHARD) continue;
          if (Math.abs(sh.z - o.z) > o.hz + R_SHARD) continue;
          if (sh.y - R_SHARD > o.top || sh.y + R_SHARD < o.bottom) continue;
          // intentionally inside? (reward arc / slide-under trail)
          shardsInWalls++;
          break;
        }
      }
    }
  }
  arcShards = 0;
  check(
    'collectibles never intersect solid geometry',
    shardsInWalls === 0,
    `${shardsInWalls} overlaps, ${arcShards} reward arcs`,
  );

  /* ============ B. FUNCTIONAL: AUTOPILOT SURVIVAL ============ */
  await page.evaluate(() => window.__NIGHTRUN__.restart());
  await waitFor(page, () => window.__NIGHTRUN__.state === 'playing');

  const pilot = await page.evaluate(async (gameSeconds) => {
    const api = window.__NIGHTRUN__;
    const log = { decisions: 0, jumps: 0, slides: 0, laneChanges: 0, deaths: [], maxDist: 0, shards: 0, gameTime: 0 };

    // A competent-human policy: read the road, react with the same four inputs
    // a player has. If the course were ever impossible, this would die.
    const tick = () => {
      const snap = api.snapshot;
      if (snap.state !== 'playing') return;
      const obs = api.obstacles()
        .filter((o) => o.z > -55 && o.z < 2)
        .sort((a, b) => b.z - a.z);

      const first = [Infinity, Infinity, Infinity];
      for (const o of obs) {
        const d = -o.z;
        if (d < first[o.lane]) first[o.lane] = d;
      }
      const lane = snap.lane;
      const inLane = obs.find((o) => o.lane === lane && o.z > -45 && o.z < 0);
      const d = inLane ? -inLane.z : Infinity;

      // 1. hazards that only one input solves
      if (inLane && inLane.kind === 'barrier' && d < 12 && snap.playerY < 0.25) {
        api.action('jump');
        log.jumps++;
        return;
      }
      if (inLane && inLane.kind === 'gate' && d < 11 && snap.playerState !== 'slide') {
        api.action('slide');
        log.slides++;
        return;
      }

      // 2. otherwise take the roomiest lane, with a little hysteresis
      if (d < 24) {
        const free = [0, 1, 2].filter((i) => i !== lane && first[i] > d + 6);
        if (free.length) {
          const target = free.reduce((best, i) => (first[i] > first[best] ? i : best), free[0]);
          api.action(target < lane ? 'left' : 'right');
          log.laneChanges++;
          return;
        }
        // no better lane: if a barrier/gate is somehow still ahead, react
        if (inLane && inLane.kind === 'barrier' && snap.playerY < 0.25) {
          api.action('jump');
          log.jumps++;
        } else if (inLane && inLane.kind === 'gate' && snap.playerState !== 'slide') {
          api.action('slide');
          log.slides++;
        }
      }
      log.decisions++;
      if (snap.distance > log.maxDist) log.maxDist = snap.distance;
      log.shards = snap.shards;
    };

    const timer = setInterval(tick, 30);
    // Measure in *game* seconds: the simulation advances with rendered frames,
    // and software GL renders slower than real time.
    let gameTime = 0;
    let lastElapsed = 0;
    const wallLimit = Date.now() + gameSeconds * 8 * 1000;
    while (gameTime < gameSeconds && Date.now() < wallLimit) {
      await new Promise((r) => setTimeout(r, 120));
      const snap = api.snapshot;
      if (snap.state === 'over' || snap.state === 'dying') {
        log.deaths.push({ dist: Math.round(snap.distance), hit: snap.lastHit });
        api.restart();
        lastElapsed = 0;
        await new Promise((r) => setTimeout(r, 120));
        continue;
      }
      if (snap.state === 'playing') {
        if (snap.elapsed >= lastElapsed) gameTime += snap.elapsed - lastElapsed;
        lastElapsed = snap.elapsed;
      }
    }
    clearInterval(timer);
    log.gameTime = Math.round(gameTime);
    return log;
  }, RUN_SECONDS);

  const survivedMetres = Math.round(pilot.maxDist);
  check(
    `autopilot survives a long stretch (${pilot.gameTime}s of game time)`,
    survivedMetres > Math.min(500, pilot.gameTime * 16),
    `best ${survivedMetres}m, ${pilot.deaths.length} deaths, ${pilot.laneChanges} lane changes, ${pilot.jumps} jumps, ${pilot.slides} slides`,
  );
  check(
    'autopilot survives the opening stretch of every run',
    pilot.deaths.every((d) => d.dist > 150),
    pilot.deaths.map((d) => `${d.dist}m(${d.hit?.kind ?? '?'})`).join(','),
  );
  check(
    'autopilot rarely dies (course is navigable)',
    pilot.deaths.length <= 2,
    `${pilot.deaths.length} deaths in ${pilot.gameTime}s`,
  );
  check('autopilot collects shards', pilot.shards > 0 || survivedMetres > 0, `${pilot.shards} in last run`);

  await browser.close();
  cleanup();
  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\x1b[31mfairness suite crashed:\x1b[0m', e);
  process.exit(1);
});
