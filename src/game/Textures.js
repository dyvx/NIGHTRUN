import * as THREE from 'three';
import { mulberry32 } from './utils.js';

/**
 * Every texture in NIGHTRUN is generated at runtime on a canvas.
 * No image files = nothing to download, nothing to break offline, tiny build.
 * Results are cached so a restart never re-rasterises anything.
 */

const cache = new Map();
let maxAnisotropy = 4;

export function setAnisotropy(value) {
  maxAnisotropy = Math.max(1, Math.min(16, value | 0));
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(tex, { repeat = null, srgb = true } = {}) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

function cached(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

/* ------------------------------------------------------------------ */
/* Road surface: dark asphalt + lane dashes + glowing guide lines       */
/* ------------------------------------------------------------------ */
export function roadTexture() {
  return cached('road', () => {
    const W = 512;
    const H = 1024;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#08050f';
    ctx.fillRect(0, 0, W, H);

    // asphalt grain
    const rnd = mulberry32(1337);
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const a = rnd() * 0.06;
      ctx.fillStyle = `rgba(${120 + rnd() * 60},${110 + rnd() * 70},${180 + rnd() * 60},${a})`;
      ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
    }

    // subtle violet floor glow
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(90,30,160,0.16)');
    grad.addColorStop(0.5, 'rgba(30,10,60,0.05)');
    grad.addColorStop(1, 'rgba(90,30,160,0.16)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // outer neon rails (road edges)
    const rail = (x, color) => {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 26;
      ctx.fillStyle = color;
      ctx.fillRect(x - 3, 0, 6, H);
      ctx.restore();
    };
    rail(14, '#45f0ff');
    rail(W - 14, '#ff2f6d');

    // lane dividers: dashed
    const dashH = H / 4;
    for (const x of [W / 3, (W * 2) / 3]) {
      ctx.save();
      ctx.shadowColor = 'rgba(162,75,255,0.9)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(190,150,255,0.55)';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(x - 2, i * dashH + dashH * 0.12, 4, dashH * 0.62);
      }
      ctx.restore();
    }

    return finish(new THREE.CanvasTexture(c), { repeat: [1, 1] });
  });
}

/* ------------------------------------------------------------------ */
/* Building facades with lit windows                                    */
/* ------------------------------------------------------------------ */
export function facadeTexture(variant = 0) {
  return cached(`facade-${variant}`, () => {
    const W = 256;
    const H = 512;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const rnd = mulberry32(99 + variant * 31);

    const palettes = [
      ['#0a0614', '#45f0ff', '#a24bff'],
      ['#0c0413', '#ff2f6d', '#a24bff'],
      ['#07060f', '#2f6bff', '#45f0ff'],
      ['#0a0410', '#a24bff', '#ff2f6d'],
    ];
    const [bg, lit1, lit2] = palettes[variant % palettes.length];

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const cols = 6;
    const rows = 16;
    const cw = W / cols;
    const ch = H / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const on = rnd();
        if (on < 0.42) continue;
        const col = rnd() > 0.5 ? lit1 : lit2;
        const alpha = 0.16 + rnd() * 0.72;
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        ctx.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.22, cw * 0.6, ch * 0.5);
        ctx.restore();
      }
    }

    // horizontal structure lines
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let y = 0; y < rows; y++) ctx.fillRect(0, y * ch, W, 2);

    // vertical accent stripe
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = lit1;
    ctx.fillRect(W * 0.06, 0, 3, H);

    return finish(new THREE.CanvasTexture(c), { repeat: [1, 1] });
  });
}

/* ------------------------------------------------------------------ */
/* Neon sign panel                                                      */
/* ------------------------------------------------------------------ */
export function signTexture(text, hue = 'cyan', vertical = false) {
  return cached(`sign-${text}-${hue}-${vertical}`, () => {
    const W = vertical ? 128 : 512;
    const H = vertical ? 512 : 192;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const palette = {
      cyan: ['#45f0ff', '#0a4a55'],
      violet: ['#c489ff', '#3a1266'],
      crimson: ['#ff5c8a', '#5c0a24'],
      gold: ['#ffd98a', '#5c4408'],
      blue: ['#7aa5ff', '#0b1f5c'],
    }[hue] || ['#45f0ff', '#0a4a55'];
    const [glow, dark] = palette;

    // panel body
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // frame
    ctx.strokeStyle = glow;
    ctx.lineWidth = vertical ? 4 : 6;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 22;
    ctx.strokeRect(6, 6, W - 12, H - 12);

    // letters
    ctx.fillStyle = '#fff';
    ctx.shadowColor = glow;
    ctx.shadowBlur = 34;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (vertical) {
      const chars = text.split('');
      const step = H / (chars.length + 0.4);
      ctx.font = `700 ${Math.min(84, step * 0.85)}px "Arial Narrow", Impact, sans-serif`;
      chars.forEach((chr, i) => {
        ctx.fillText(chr, W / 2, step * (i + 0.7));
      });
    } else {
      ctx.font = `700 ${Math.min(96, (W / Math.max(1, text.length)) * 1.55)}px "Arial Narrow", Impact, sans-serif`;
      ctx.fillText(text, W / 2, H / 2);
      // underline bar
      ctx.fillStyle = glow;
      ctx.shadowBlur = 20;
      ctx.fillRect(W * 0.16, H * 0.78, W * 0.68, 5);
    }

    return finish(new THREE.CanvasTexture(c), { srgb: true });
  });
}

/* ------------------------------------------------------------------ */
/* Radial glow sprite (additive)                                        */
/* ------------------------------------------------------------------ */
export function glowTexture(colorHex = '#45f0ff') {
  return cached(`glow-${colorHex}`, () => {
    const S = 128;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, colorHex);
    g.addColorStop(0.28, colorHex);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/* ------------------------------------------------------------------ */
/* Overhead banner / arch hologram                                      */
/* ------------------------------------------------------------------ */
export function bannerTexture(text = 'NIGHTRUN') {
  return cached(`banner-${text}`, () => {
    const W = 1024;
    const H = 128;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(255,47,109,0.0)');
    g.addColorStop(0.2, 'rgba(255,47,109,0.55)');
    g.addColorStop(0.5, 'rgba(162,75,255,0.7)');
    g.addColorStop(0.8, 'rgba(69,240,255,0.55)');
    g.addColorStop(1, 'rgba(69,240,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.32, W, H * 0.36);

    ctx.font = '700 64px "Arial Narrow", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#45f0ff';
    ctx.shadowBlur = 30;
    ctx.fillText(text, W / 2, H / 2);

    return finish(new THREE.CanvasTexture(c), { srgb: true });
  });
}

/* ------------------------------------------------------------------ */
/* Sky dome gradient                                                    */
/* ------------------------------------------------------------------ */
export function skyTexture() {
  return cached('sky', () => {
    const W = 64;
    const H = 512;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#03000a');
    g.addColorStop(0.42, '#0b0320');
    g.addColorStop(0.62, '#1b0633');
    g.addColorStop(0.78, '#2a0730');
    g.addColorStop(0.9, '#43102f');
    g.addColorStop(1, '#0a0418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** Free GPU memory for a full teardown (used on quality changes). */
export function disposeTextures() {
  for (const tex of cache.values()) tex.dispose?.();
  cache.clear();
}
