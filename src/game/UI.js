import { formatScore } from './utils.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['boot', 'menu', 'pause', 'over', 'settings', 'howto'];

/**
 * Thin DOM layer. Keeps all markup concerns out of the gameplay systems.
 */
export class UI {
  constructor(handlers = {}) {
    this.h = handlers;
    this.el = {
      boot: $('screen-boot'),
      menu: $('screen-menu'),
      pause: $('screen-pause'),
      over: $('screen-over'),
      settings: $('screen-settings'),
      howto: $('screen-howto'),
      hud: $('hud'),
      touchpad: $('touch-pad'),
      bootFill: $('boot-fill'),
      bootLabel: $('boot-label'),

      hudScore: $('hud-score'),
      hudBest: $('hud-best'),
      hudDist: $('hud-dist'),
      hudShards: $('hud-shards'),
      hudSpeed: $('hud-speed'),

      menuBest: $('menu-best'),
      menuBestMeta: $('menu-best-meta'),
      netState: $('net-state'),

      pauseScore: $('pause-score'),
      pauseDist: $('pause-dist'),
      pauseShards: $('pause-shards'),

      overScore: $('over-score'),
      overBest: $('over-best'),
      overDist: $('over-dist'),
      overShards: $('over-shards'),
      overBadge: $('over-badge'),
      overEyebrow: $('over-eyebrow'),

      flash: $('flash'),
      rotate: $('rotate-hint'),
    };
    this._last = {};
    this._screen = null;
    this._bind();
  }

  _bind() {
    const on = (id, fn) => {
      const node = $(id);
      if (node) node.addEventListener('click', (e) => {
        e.preventDefault();
        fn(e);
      });
    };
    on('btn-play', () => this.h.onPlay?.());
    on('btn-settings', () => this.h.onSettings?.());
    on('btn-howto', () => this.h.onHowTo?.());
    on('btn-settings-close', () => this.h.onSettingsClose?.());
    on('btn-howto-close', () => this.h.onHowToClose?.());
    on('btn-resume', () => this.h.onResume?.());
    on('btn-pause', () => this.h.onPause?.());
    on('btn-pause-settings', () => this.h.onSettings?.());
    on('btn-quit', () => this.h.onQuit?.());
    on('btn-restart', () => this.h.onRestart?.());
    on('btn-menu', () => this.h.onMenu?.());
    on('btn-reset-data', () => this.h.onResetData?.());

    const sw = (id, key) => {
      const node = $(id);
      if (!node) return;
      node.addEventListener('click', (e) => {
        e.preventDefault();
        const next = node.getAttribute('aria-checked') !== 'true';
        this.h.onToggle?.(key, next);
      });
    };
    sw('opt-audio', 'audio');
    sw('opt-music', 'music');
    sw('opt-haptics', 'haptics');
    sw('opt-touchpad', 'touchpad');

    const quality = $('opt-quality');
    if (quality) {
      quality.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-q]');
        if (!btn) return;
        e.preventDefault();
        this.h.onQuality?.(btn.dataset.q);
      });
    }

    // Keep the "OFFLINE READY" indicator honest.
    const net = () => this.setNetState(navigator.onLine);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    net();
  }

  /* ------------------------------------------------------------------ */
  setScreen(name) {
    console.log('[dbg] setScreen(' + name + ')', new Error().stack);
    if (this._screen === name) return;
    this._screen = name;
    for (const key of SCREENS) {
      const node = this.el[key];
      if (!node) continue;
      node.classList.toggle('is-active', key === name);
      if (key !== name) node.setAttribute('aria-hidden', 'true');
      else node.removeAttribute('aria-hidden');
    }
  }

  hideAll() {
    this.setScreen(null);
  }

  showHud(show) {
    this.el.hud.classList.toggle('is-hidden', !show);
  }

  setBootProgress(p, label) {
    if (this.el.bootFill) this.el.bootFill.style.width = `${Math.round(Math.min(1, p) * 100)}%`;
    if (label && this.el.bootLabel) this.el.bootLabel.textContent = label;
  }

  setTouchpad(on) {
    this.el.touchpad.classList.toggle('on', !!on);
  }

  setNetState(online) {
    const node = this.el.netState;
    if (!node) return;
    node.classList.toggle('dot--on', true);
    node.classList.remove('dot--on', 'dot--off');
    if (online) {
      node.classList.add('dot--on');
      node.innerHTML = '<i></i>ONLINE · READY OFFLINE';
    } else {
      node.classList.add('dot--off');
      node.innerHTML = '<i></i>OFFLINE MODE';
    }
  }

  /* ------------------------------------------------------------------ */
  _setText(node, value, pop = false) {
    if (!node) return;
    const str = String(value);
    if (node.textContent === str) return;
    node.textContent = str;
    if (pop) {
      node.classList.remove('pop');
      // force reflow so the animation can restart
      void node.offsetWidth;
      node.classList.add('pop');
    }
  }

  updateHud({ score, best, distance, shards, speed }) {
    const key = `${score}|${best}|${distance}|${shards}|${speed}`;
    if (this._last.hud === key) return;
    this._last.hud = key;
    this._setText(this.el.hudScore, formatScore(score));
    this._setText(this.el.hudBest, formatScore(best));
    this._setText(this.el.hudShards, formatScore(shards), shards !== this._last.shards);
    if (this.el.hudDist) this.el.hudDist.innerHTML = `${Math.floor(distance)}<i>m</i>`;
    if (this.el.hudSpeed) this.el.hudSpeed.innerHTML = `${speed.toFixed(1)}<i>x</i>`;
    this._last.shards = shards;
  }

  updateMenu(save) {
    this._setText(this.el.menuBest, formatScore(save.best));
    if (this.el.menuBestMeta) {
      this.el.menuBestMeta.textContent = save.runs
        ? `${save.runs} RUN${save.runs === 1 ? '' : 'S'} · ${Math.floor(save.bestDistance)}M BEST`
        : 'NO RUNS YET';
    }
  }

  updateSettings(settings) {
    const setSwitch = (id, on) => {
      const node = $(id);
      if (node) node.setAttribute('aria-checked', on ? 'true' : 'false');
    };
    setSwitch('opt-audio', settings.audio);
    setSwitch('opt-music', settings.music);
    setSwitch('opt-haptics', settings.haptics);
    setSwitch('opt-touchpad', settings.touchpad);

    const q = $('opt-quality');
    if (q) {
      for (const btn of q.querySelectorAll('button[data-q]')) {
        btn.classList.toggle('on', btn.dataset.q === settings.quality);
      }
    }
    this.setTouchpad(settings.touchpad);
  }

  showPause({ score, distance, shards }) {
    this._setText(this.el.pauseScore, formatScore(score));
    if (this.el.pauseDist) this.el.pauseDist.textContent = `${Math.floor(distance)}m`;
    this._setText(this.el.pauseShards, formatScore(shards));
    this.setScreen('pause');
  }

  showOver({ score, best, distance, shards, isBest }) {
    this._setText(this.el.overScore, formatScore(score));
    this._setText(this.el.overBest, formatScore(best));
    if (this.el.overDist) this.el.overDist.textContent = `${Math.floor(distance)}m`;
    this._setText(this.el.overShards, formatScore(shards));
    this.el.overBadge.classList.toggle('is-hidden', !isBest);
    this.el.overEyebrow.textContent = isBest ? 'NEW RECORD' : 'SIGNAL LOST';
    this.setScreen('over');
  }

  flash(on) {
    const f = this.el.flash;
    if (!f) return;
    f.classList.toggle('on', on);
    if (on) setTimeout(() => f.classList.remove('on'), 90);
  }

  showRotateHint(show) {
    this.el.rotate?.classList.toggle('is-hidden', !show);
  }

  showError(message) {
    this.setBootProgress(1, message);
  }
}
