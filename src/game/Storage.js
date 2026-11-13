/**
 * Local persistence. Everything lives on the device — no accounts, no network.
 * Writes are defensive: private-mode Safari and storage-full conditions simply
 * fall back to an in-memory copy so the game keeps playing.
 */

const KEY = 'nightrun.save.v1';
const LEGACY_KEYS = ['nightrun.best', 'nightrun.settings'];

export const DEFAULT_SAVE = {
  version: 1,
  best: 0,
  bestDistance: 0,
  bestShards: 0,
  runs: 0,
  totalShards: 0,
  totalDistance: 0,
  settings: {
    audio: true,
    music: true,
    haptics: true,
    touchpad: false,
    quality: 'auto',
  },
  updatedAt: 0,
};

let memory = null;
let storageOk = true;

function probeStorage() {
  try {
    const t = '__nightrun_probe__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return true;
  } catch {
    return false;
  }
}

function merge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base };
  for (const k of Object.keys(base)) {
    const v = patch[k];
    if (v === undefined || v === null) continue;
    if (k === 'settings' && typeof v === 'object') out.settings = { ...base.settings, ...v };
    else if (typeof v === typeof base[k] || (typeof base[k] === 'number' && typeof v === 'number')) out[k] = v;
  }
  return out;
}

export function loadSave() {
  storageOk = probeStorage();
  let raw = null;
  try {
    raw = storageOk ? localStorage.getItem(KEY) : null;
  } catch {
    raw = null;
  }

  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  // Legacy single-key saves: migrate rather than discard.
  if (!parsed && storageOk) {
    try {
      const legacyBest = Number(localStorage.getItem('nightrun.best'));
      if (Number.isFinite(legacyBest) && legacyBest > 0) {
        parsed = { best: legacyBest, settings: {} };
      }
    } catch {
      /* ignore */
    }
  }

  memory = merge(structuredCloneSafe(DEFAULT_SAVE), parsed);
  // sanitise numeric fields
  for (const k of ['best', 'bestDistance', 'bestShards', 'runs', 'totalShards', 'totalDistance']) {
    const n = Number(memory[k]);
    memory[k] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  if (!['low', 'medium', 'high', 'auto'].includes(memory.settings.quality)) {
    memory.settings.quality = 'auto';
  }
  return memory;
}

export function saveGame(patch) {
  if (!memory) memory = structuredCloneSafe(DEFAULT_SAVE);
  if (patch) memory = merge(memory, patch);
  memory.updatedAt = Date.now();
  persist();
  return memory;
}

export function recordRun({ score, distance, shards }) {
  if (!memory) loadSave();
  const isBest = score > memory.best;
  const snap = {
    best: Math.max(memory.best, Math.floor(score)),
    bestDistance: Math.max(memory.bestDistance, Math.floor(distance)),
    bestShards: Math.max(memory.bestShards, Math.floor(shards)),
    runs: memory.runs + 1,
    totalShards: memory.totalShards + Math.floor(shards),
    totalDistance: memory.totalDistance + Math.floor(distance),
  };
  saveGame(snap);
  return { isBest, best: memory.best };
}

export function updateSettings(patch) {
  if (!memory) loadSave();
  saveGame({ settings: { ...memory.settings, ...patch } });
  return memory.settings;
}

export function resetProgress() {
  if (!memory) loadSave();
  const settings = { ...memory.settings };
  memory = merge(structuredCloneSafe(DEFAULT_SAVE), { settings });
  persist();
  return memory;
}

export function getSave() {
  if (!memory) loadSave();
  return memory;
}

function persist() {
  if (!storageOk) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    storageOk = false;
    // Keep playing from memory; a full/blocked store must never break a run.
  }
}

export function storageAvailable() {
  return storageOk;
}

function structuredCloneSafe(obj) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(obj));
}
