import './style.css';
import { UI } from './game/UI.js';
import { Game, STATE } from './game/Game.js';
import { AudioEngine } from './game/Audio.js';
import { loadSave, getSave, updateSettings, resetProgress } from './game/Storage.js';
import { registerServiceWorker } from './pwa.js';

const VERSION = '1.0.0';

const canvas = document.getElementById('stage');

let save = loadSave();
const audio = new AudioEngine();
let game = null;
let settingsOrigin = 'menu';
let booted = false;

/* ------------------------------------------------------------------ */
/* UI wiring                                                           */
/* ------------------------------------------------------------------ */
const ui = new UI({
  onPlay: () => {
    audio.init();
    audio.sfx('ui');
    game?.startRun();
  },
  onSettings: () => {
    settingsOrigin = game?.state === STATE.PAUSED ? 'pause' : 'menu';
    audio.sfx('ui');
    ui.updateSettings(getSave().settings);
    ui.setScreen('settings');
  },
  onSettingsClose: () => {
    audio.sfx('ui');
    if (settingsOrigin === 'pause' && game?.state === STATE.PAUSED) {
      ui.showPause({ score: game.score, distance: game.distance, shards: game.shards });
    } else {
      ui.setScreen('menu');
    }
  },
  onHowTo: () => {
    audio.init();
    audio.sfx('ui');
    ui.setScreen('howto');
  },
  onHowToClose: () => {
    audio.sfx('ui');
    ui.setScreen('menu');
  },
  onPause: () => {
    audio.sfx('ui');
    game?.pause();
  },
  onResume: () => {
    audio.sfx('ui');
    game?.resume();
  },
  onQuit: () => {
    audio.sfx('ui');
    game?.quitToMenu();
  },
  onRestart: () => {
    audio.sfx('ui');
    game?.startRun();
  },
  onMenu: () => {
    audio.sfx('ui');
    game?.quitToMenu();
  },
  onToggle: (key, value) => {
    audio.init();
    const next = updateSettings({ [key]: value });
    game?.applySettings(next);
    audio.sfx('ui');
    if (key === 'music') {
      if (value && (game?.state === STATE.PLAYING)) audio.startMusic();
      audio.setMusic(value);
    }
    if (key === 'audio') audio.setAudio(value);
    ui.updateSettings(next);
  },
  onQuality: (q) => {
    audio.sfx('ui');
    updateSettings({ quality: q });
    game?.applyQuality(q);
    ui.updateSettings(getSave().settings);
  },
  onResetData: () => {
    const ok = window.confirm('Reset personal best, stats and settings? This cannot be undone.');
    if (!ok) return;
    const fresh = resetProgress();
    game.best = 0;
    game.save = fresh;
    game.applySettings(fresh.settings);
    ui.updateSettings(fresh.settings);
    ui.updateMenu(fresh);
    audio.sfx('ui');
  },
});

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
async function boot() {
  const fail = (message) => {
    const label = document.getElementById('boot-label');
    if (label) {
      label.textContent = message;
      label.style.color = '#ff2f6d';
    }
    const fill = document.getElementById('boot-fill');
    if (fill) fill.style.width = '100%';
  };

  const webglOk = (() => {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
      return false;
    }
  })();
  if (!webglOk) {
    fail('WEBGL UNAVAILABLE ON THIS DEVICE');
    return;
  }

  const frames = (n = 1) => new Promise((r) => {
    let i = 0;
    const tick = () => (++i >= n ? r() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

  try {
    ui.setBootProgress(0.12, 'CALIBRATING NEON GRID');
    await frames(2);

    ui.setBootProgress(0.38, 'RAISING THE DISTRICT');
    game = new Game({ canvas, ui, audio, save });
    game.init();
    await frames(2);

    ui.setBootProgress(0.72, 'SYNTHESISING TEXTURES');
    await frames(2);

    ui.setBootProgress(0.92, 'SPINNING UP AUDIO');
    ui.updateSettings(save.settings);
    ui.updateMenu(save);
    await frames(2);

    ui.setBootProgress(1, 'READY');
    await frames(1);
    ui.showHud(false);
    ui.setScreen('menu');
    booted = true;
  } catch (err) {
    console.error('[nightrun] boot failed:', err);
    fail('BOOT FAILED — RELOAD TO RETRY');
    return;
  }

  registerServiceWorker({
    onOfflineReady: () => ui.setNetState(navigator.onLine),
    onUpdate: () => {
      // A new build is cached in the background. It activates on the next
      // launch, so a run in progress is never interrupted and the save file
      // (localStorage) is completely untouched.
      console.info('[nightrun] new version cached — will activate next launch');
    },
  });

  window.addEventListener('online', () => ui.setNetState(true));
  window.addEventListener('offline', () => ui.setNetState(false));

  // iOS: block pinch-zoom / double-tap gestures entirely.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  let lastTouch = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const t = Date.now();
      if (t - lastTouch < 320) e.preventDefault();
      lastTouch = t;
    },
    { passive: false },
  );
}

/* ------------------------------------------------------------------ */
/* test / debug hook (also useful for players to inspect a run)         */
/* ------------------------------------------------------------------ */
window.__NIGHTRUN__ = {
  version: VERSION,
  get ready() {
    return booted && !!game && game.state !== STATE.BOOT;
  },
  get state() {
    return game?.state ?? 'boot';
  },
  get snapshot() {
    if (!game) return { state: 'boot' };
    const p = game.player;
    return {
      state: game.state,
      score: game.score,
      best: game.best,
      distance: game.distance,
      shards: game.shards,
      speed: game.speed,
      difficulty: game.difficulty,
      lane: p.laneIndex,
      playerX: p.x,
      playerY: p.y,
      playerState: p.state,
      playerHeight: p.height,
      activeObstacles: game.field.activeObstacles,
      activeShards: game.field.shards.activeCount,
      fps: game.fps,
      elapsed: game.elapsed,
      lastHit: game.lastHit || null,
      quality: game.qualityName,
      audioReady: audio.ready,
      settings: getSave().settings,
    };
  },
  action: (a) => game?.handleAction(a),
  pause: () => game?.pause(),
  resume: () => game?.resume(),
  restart: () => game?.startRun(),
  toMenu: () => game?.quitToMenu(),
  setQuality: (q) => game?.applyQuality(q),
  save: () => getSave(),
  resetSave: () => resetProgress(),
  /** Test helper: every live obstacle in the field, for fairness audits. */
  obstacles() {
    if (!game) return [];
    const out = [];
    for (const pool of [game.field.barriers, game.field.gates, game.field.blocks]) {
      for (const it of pool.items) {
        if (it.active) {
          out.push({
            kind: it.kind,
            lane: it.lane,
            z: +it.z.toFixed(2),
            x: it.x,
            bottom: +(it.cy - it.hy).toFixed(2),
            top: +(it.cy + it.hy).toFixed(2),
            hx: it.hx,
            hz: it.hz,
          });
        }
      }
    }
    return out.sort((a, b) => b.z - a.z);
  },
  shardPositions() {
    if (!game) return [];
    return game.field.shards.items
      .filter((s) => s.active)
      .map((s) => ({
        x: +s.group.position.x.toFixed(2),
        y: +Number(s.baseY ?? s.group.position.y).toFixed(2),
        z: +Number(s.z ?? 0).toFixed(2),
      }));
  },
  /** Test helper: expose the nearest upcoming obstacle for assertions. */
  nearestObstacle() {
    if (!game) return null;
    const pools = [game.field.barriers, game.field.gates, game.field.blocks];
    let best = null;
    for (const pool of pools) {
      for (const it of pool.items) {
        if (!it.active) continue;
        if (it.z < -160 || it.z > 4) continue;
        if (!best || Math.abs(it.z) < Math.abs(best.z)) best = it;
      }
    }
    return best ? { kind: best.kind, lane: best.lane, z: best.z, cy: best.cy, hy: best.hy } : null;
  },
};

boot();
