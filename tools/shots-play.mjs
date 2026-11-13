/**
 * Capture gameplay screenshots while an autopilot plays the built game.
 *   node tools/shots-play.mjs [outDir] [prefix]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 4184);
const BASE = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] || '/tmp/play');
const PREFIX = process.argv[3] || 'p';
const W = Number(process.env.W || 430);
const H = Number(process.env.H || 900);
const QUALITY = process.env.Q || 'high';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [resolve('tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await sleep(800);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: W < 700, hasTouch: W < 700 });
await ctx.addInitScript((q) => {
  localStorage.setItem('nightrun.save.v1', JSON.stringify({ best: 18420, bestDistance: 2480, runs: 27, settings: { quality: q } }));
}, QUALITY);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__NIGHTRUN__?.ready === true, { timeout: 30000 });
await page.click('#btn-play');
await page.waitForFunction(() => window.__NIGHTRUN__.state === 'playing', { timeout: 10000 });
await page.evaluate(() => {
  const api = window.__NIGHTRUN__;
  window.__pilot = setInterval(() => {
    const snap = api.snapshot;
    if (snap.state !== 'playing') return;
    const obs = api.obstacles().filter((o) => o.z > -60 && o.z < 2);
    const clear = [Infinity, Infinity, Infinity];
    for (const o of obs) {
      const d = -o.z;
      if (d < clear[o.lane]) clear[o.lane] = d;
    }
    const lane = snap.lane;
    if (clear[lane] < 22) {
      let best = lane;
      for (let i = 0; i < 3; i++) if (clear[i] > clear[best] + 4) best = i;
      if (best !== lane && snap.playerState !== 'air') api.action(best < lane ? 'left' : 'right');
    }
    const ahead = obs.filter((o) => o.lane === snap.lane && o.z > -40 && o.z < 0).sort((a, b) => b.z - a.z)[0];
    if (ahead) {
      const d = -ahead.z;
      if (ahead.kind === 'barrier' && d < 11 && snap.playerY < 0.2) api.action('jump');
      else if (ahead.kind === 'gate' && d < 10 && snap.playerState !== 'slide') api.action('slide');
    }
  }, 32);
});

const shots = [];
for (let i = 0; i < 14; i++) {
  await sleep(900);
  const s = await page.evaluate(() => {
    const api = window.__NIGHTRUN__;
    const obs = api.obstacles().filter((o) => o.z > -20 && o.z < -4);
    return { kind: obs[0]?.kind, dist: api.snapshot.distance, state: api.snapshot.state, shards: api.snapshot.shards };
  });
  const file = join(OUT, `${PREFIX}-${String(i).padStart(2, '0')}-${s.kind || 'open'}.png`);
  await page.screenshot({ path: file });
  shots.push(`${file}  dist=${Math.round(s.dist)}m shards=${s.shards}`);
}
console.log(shots.join('\n'));
await browser.close();
server.kill();
