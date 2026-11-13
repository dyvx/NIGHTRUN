import * as THREE from 'three';
import { World } from './World.js';
import { Field } from './Field.js';
import { Player } from './Player.js';
import { Input } from './Input.js';
import * as C from './constants.js';
import { clamp, damp, now } from './utils.js';
import { recordRun, saveGame, getSave } from './Storage.js';
import { setAnisotropy } from './Textures.js';

const STATE = {
  BOOT: 'boot',
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DYING: 'dying',
  OVER: 'over',
};

export { STATE };

export class Game {
  constructor({ canvas, ui, audio, save }) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = audio;
    this.save = save;

    this.state = STATE.BOOT;
    this.qualityName = this._resolveQuality(save.settings.quality);
    this.quality = C.QUALITY[this.qualityName];

    this.score = 0;
    this.best = save.best;
    this.distance = 0;
    this.shards = 0;
    this.speed = C.SPEED_START;
    this.difficulty = 0;
    this.elapsed = 0;
    this.runTime = 0;
    this.shardStreak = 0;

    this.deathTimer = 0;
    this.shake = 0;
    this.flashCooldown = 0;
    this.lastFrame = 0;
    this.rafId = 0;
    this.running = false;
    this.hudAccum = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.fps = 60;

    this._collider = { cx: 0, cy: 0, cz: 0, hx: 0, hy: 0, hz: 0 };
    this._camTarget = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._menuTime = 0;

    this._loop = this._loop.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  /* ------------------------------------------------------------------ */
  /* setup                                                               */
  /* ------------------------------------------------------------------ */
  _resolveQuality(setting) {
    if (setting && C.QUALITY[setting]) return setting;
    // 'auto' (or unknown): pick sensibly for the device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if (isMobile) return cores >= 6 && mem >= 4 ? 'high' : 'medium';
    return 'high';
  }

  init() {
    setAnisotropy(this.quality.anisotropy);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // neon look tolerates it; huge mobile win
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(C.COLORS.bg, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this._pixelRatio());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 620);
    this.camera.position.set(0, 3.9, 7.6);
    this.camera.lookAt(0, 1.4, -10);

    this.world = new World(this.scene, this.qualityName);
    this.field = new Field(this.scene, { shards: C.POOL.shard });
    this.player = new Player();
    this.scene.add(this.player.group);

    this.input = new Input(this.canvas, {
      onAction: (a) => this.handleAction(a),
      onPauseKey: () => this.togglePause(),
      onConfirm: () => {
        if (this.state === STATE.OVER) this.startRun();
        else if (this.state === STATE.MENU) this.startRun();
      },
    });
    this.input.attach();

    const padButtons = this.ui.el.touchpad.querySelectorAll('[data-action]');
    this.input.bindButtons(padButtons);

    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    window.visualViewport?.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('blur', this._onBlur);

    this._onResize();
    this._applySettings(this.save.settings);

    this.state = STATE.MENU;
    this.enterMenu();
    this._startLoop();
    return this;
  }

  _pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const q = this.quality;
    const base =
      this.qualityName === 'low' ? Math.min(dpr, 1) :
      this.qualityName === 'medium' ? Math.min(dpr, 1.5) :
      Math.min(dpr * 1.15, 2.2);
    return clamp(base, 0.75, q.maxPixelRatio);
  }

  /* ------------------------------------------------------------------ */
  /* settings / quality                                                  */
  /* ------------------------------------------------------------------ */
  _applySettings(settings) {
    this.settings = settings;
    this.audio.setAudio(settings.audio);
    this.audio.setMusic(settings.music);
    this.ui.updateSettings(settings);
    this.ui.setTouchpad(settings.touchpad && this._isTouch());
  }

  /** Public: apply a settings object (audio/music/haptics/touchpad). */
  applySettings(settings) {
    this.save = { ...this.save, settings };
    this._applySettings(settings);
  }

  _isTouch() {
    return (navigator.maxTouchPoints || 0) > 0 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }

  applyQuality(name) {
    const resolved = name === 'auto' ? this._resolveQuality('auto') : name;
    if (!C.QUALITY[resolved]) return;
    if (resolved === this.qualityName) return;

    this.qualityName = resolved;
    this.quality = C.QUALITY[resolved];

    this.renderer.setPixelRatio(this._pixelRatio());

    // Rebuild the district with the new detail budget (safe: pools & player stay).
    this.world.dispose();
    this.world = new World(this.scene, this.qualityName);
    this.save = saveGame({ settings: { ...this.save.settings, quality: name } });
    this.settings = this.save.settings;
    this.ui.updateSettings(this.save.settings);
  }

  /* ------------------------------------------------------------------ */
  /* states                                                              */
  /* ------------------------------------------------------------------ */
  enterMenu() {
    this.state = STATE.MENU;
    this.field.reset();
    this.player.reset();
    this.speed = 9;
    this.elapsed = 0;
    this._menuTime = 0;
    this.input.setEnabled(false);
    this.ui.showHud(false);
    this.ui.setScreen('menu');
    this.ui.updateMenu(this.save);
    this.audio.stopMusic();
  }

  startRun() {
    this.audio.init(); // user gesture: unlock the audio context
    if (this.audio.audioOn && this.audio.musicOn) this.audio.startMusic();
    this.audio.sfx('start');

    this.state = STATE.PLAYING;
    this.score = 0;
    this.distance = 0;
    this.shards = 0;
    this.elapsed = 0;
    this.runTime = 0;
    this.speed = C.SPEED_START;
    this.difficulty = 0;
    this.shardStreak = 0;
    this.deathTimer = 0;
    this.shake = 0;
    this.lastTime = now();

    this.field.reset();
    this.field.prefill(C.SPEED_START);
    this.player.reset();
    this.player.group.visible = true;

    this.input.setEnabled(true);
    this.ui.setScreen(null);
    this.ui.showHud(true);
    this.ui.updateHud({
      score: 0,
      best: this.best,
      distance: 0,
      shards: 0,
      speed: this.speed / C.SPEED_START,
    });
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.setEnabled(false);
    this.audio.stopMusic();
    this.audio.sfx('paused');
    this.ui.showPause({ score: this.score, distance: this.distance, shards: this.shards });
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    this.lastTime = now();
    this.input.setEnabled(true);
    this.ui.setScreen(null);
    if (this.audio.audioOn && this.audio.musicOn) this.audio.startMusic();
    this.audio.resume();
  }

  togglePause() {
    if (this.state === STATE.PLAYING) this.pause();
    else if (this.state === STATE.PAUSED) this.resume();
  }

  quitToMenu() {
    this.audio.stopMusic();
    this.enterMenu();
    this.best = this.save.best;
  }

  gameOver() {
    if (this.state === STATE.OVER) return;
    this.state = STATE.OVER;
    this.input.setEnabled(false);
    const result = recordRun({
      score: this.score,
      distance: this.distance,
      shards: this.shards,
    });
    this.best = result.best;
    this.save = getSave();
    this.audio.stopMusic();
    this.ui.showHud(false);
    this.ui.showOver({
      score: this.score,
      best: result.best,
      distance: this.distance,
      shards: this.shards,
      isBest: result.isBest,
    });
  }

  /* ------------------------------------------------------------------ */
  /* input                                                               */
  /* ------------------------------------------------------------------ */
  handleAction(action) {
    if (this.state !== STATE.PLAYING) return;
    switch (action) {
      case 'left':
      case 'right': {
        const moved = this.player.moveLane(action === 'left' ? -1 : 1);
        this.audio.sfx('lane');
        if (moved) this.vibrate(8);
        break;
      }
      case 'jump': {
        if (this.player.jump()) {
          this.audio.sfx('jump');
          this.vibrate(10);
        }
        break;
      }
      case 'slide': {
        if (this.player.slide()) {
          this.audio.sfx('slide');
          this.vibrate(10);
        }
        break;
      }
      default:
        break;
    }
  }

  vibrate(ms) {
    if (!this.settings?.haptics) return;
    if (navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* ignore */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* loop                                                                */
  /* ------------------------------------------------------------------ */
  _startLoop() {
    if (this.running) return;
    this.running = true;
    this.lastTime = now();
    this.rafId = requestAnimationFrame(this._loop);
  }

  _stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  _loop(ts) {
    this.rafId = requestAnimationFrame(this._loop);
    const t = typeof ts === 'number' ? ts : now();
    let dt = (t - this.lastTime) / 1000;
    this.lastTime = t;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;

    this.fpsAccum += Math.min(dt, 0.5);
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    // clamp: tab-switch spikes must never teleport the player through obstacles
    dt = Math.min(dt, 1 / 30);

    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    switch (this.state) {
      case STATE.PLAYING:
        this._updatePlaying(dt);
        break;
      case STATE.DYING:
        this._updateDying(dt);
        break;
      case STATE.MENU:
        this._updateMenu(dt);
        break;
      case STATE.PAUSED:
      case STATE.OVER:
      case STATE.BOOT:
      default:
        break;
    }
    this._updateCamera(dt);
  }

  _updatePlaying(dt) {
    this.elapsed += dt;
    this.runTime += dt;

    // Difficulty curve: a gentle ramp that keeps accelerating for minutes.
    const ramp = Math.max(0, this.elapsed - C.SPEED_GRACE);
    const target = clamp(C.SPEED_START + C.SPEED_ACCEL * ramp, C.SPEED_START, C.SPEED_MAX);
    // ~1s of smoothing so every speed step is sub-perceptual (no jolts).
    this.speed = damp(this.speed, target, 1.0, dt);
    this.difficulty = clamp((this.speed - C.SPEED_START) / (C.SPEED_MAX - C.SPEED_START), 0, 1);

    this.distance += this.speed * dt;

    this.player.update(dt, this.speed);
    this.world.update(dt, this.speed, this.elapsed);

    this.field.update(
      dt,
      this.speed,
      this.difficulty,
      this.player,
      {
        onShard: (n) => this._collectShard(n),
        onObstacleHit: (item) => this._hitObstacle(item),
      },
      this.camera.quaternion,
    );

    this.score = Math.floor(this.distance * C.DISTANCE_POINTS + this.shards * C.SHARD_POINTS);

    this.hudAccum += dt;
    if (this.hudAccum > 0.1) {
      this.hudAccum = 0;
      this.ui.updateHud({
        score: this.score,
        best: Math.max(this.best, this.score),
        distance: this.distance,
        shards: this.shards,
        speed: this.speed / C.SPEED_START,
      });
    }
  }

  _updateDying(dt) {
    this.deathTimer -= dt;
    // slow-motion aftermath
    this.speed = damp(this.speed, 0, 3.2, dt);
    this.player.update(dt, this.speed);
    this.world.update(dt, this.speed, this.elapsed);
    this.player.group.rotation.z = damp(this.player.group.rotation.z, 1.15, 4, dt);
    this.player.group.rotation.y = damp(this.player.group.rotation.y, 0.6, 4, dt);
    this.player.group.position.y = damp(this.player.group.position.y, 0.6, 3, dt);
    if (this.deathTimer <= 0) this.gameOver();
  }

  _updateMenu(dt) {
    this._menuTime += dt;
    this.speed = 8.5;
    this.elapsed += dt;
    this.player.update(dt, this.speed);
    this.world.update(dt, this.speed, this.elapsed);
    this.player.group.rotation.z = damp(this.player.group.rotation.z, 0, 8, dt);
    this.player.group.rotation.y = damp(this.player.group.rotation.y, 0, 8, dt);
  }

  _collectShard(n) {
    this.shards += n;
    this.shardStreak++;
    this.audio.sfx('shard', { streak: this.shardStreak % 12 });
    this.vibrate(5);
  }

  _hitObstacle(item) {
    if (this.state !== STATE.PLAYING) return;
    // Detailed record of the fatal contact (used by the fairness audit).
    this.lastHit = item
      ? {
          kind: item.kind,
          lane: item.lane,
          z: +item.z.toFixed(2),
          x: +item.group.position.x.toFixed(2),
          hy: item.hy,
          cy: item.cy,
          playerX: +this.player.x.toFixed(2),
          playerY: +this.player.y.toFixed(2),
          playerState: this.player.state,
          playerLane: this.player.laneIndex,
          score: this.score,
        }
      : null;
    this.state = STATE.DYING;
    this.deathTimer = 0.95;
    this.shake = 1;
    this.player.playDeath();
    this.audio.sfx('hit');
    this.vibrate([0, 40, 30, 60]);
    this.ui.flash(true);
    this.input.setEnabled(false);
  }

  /* ------------------------------------------------------------------ */
  _updateCamera(dt) {
    const cam = this.camera;
    const p = this.player;

    if (this.state === STATE.MENU) {
      const sway = Math.sin(this._menuTime * 0.35) * 1.5;
      this._camTarget.set(sway * 0.5, 4.3 + Math.sin(this._menuTime * 0.5) * 0.25, 8.4);
      cam.position.x = damp(cam.position.x, this._camTarget.x, 2.4, dt);
      cam.position.y = damp(cam.position.y, this._camTarget.y, 2.4, dt);
      cam.position.z = damp(cam.position.z, this._camTarget.z, 2.4, dt);
      this._lookTarget.set(sway * 0.12, 1.5, -12);
      cam.lookAt(this._lookTarget);
      cam.rotation.z = damp(cam.rotation.z, 0, 4, dt);
      this._setFov((this._baseFov || 62) - 2, dt);
      return;
    }

    // follow the player laterally, subtly, to preserve lane readability
    const leadX = p.x * 0.3;
    this._camTarget.set(leadX, 3.85 + p.y * 0.16, 7.4 + this.difficulty * 0.5);
    const rate = this.state === STATE.DYING ? 3 : 7.5;
    cam.position.x = damp(cam.position.x, this._camTarget.x, rate, dt);
    cam.position.y = damp(cam.position.y, this._camTarget.y, rate, dt);
    cam.position.z = damp(cam.position.z, this._camTarget.z, rate, dt);

    // impact shake
    if (this.shake > 0.001) {
      const s = this.shake * 0.32;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake = damp(this.shake, 0, 6, dt);
    }

    this._lookTarget.set(p.x * 0.24, 1.42 + p.y * 0.32, -10);
    cam.lookAt(this._lookTarget);

    // lane lean — a little roll sells the sideways motion
    const lean = clamp((p.targetX - p.x) * 0.055, -0.09, 0.09);
    cam.rotation.z = damp(cam.rotation.z, -lean, 8, dt);

    // FOV opens up with speed
    this._setFov((this._baseFov || 62) + this.difficulty * 10, dt);
  }

  _setFov(target, dt) {
    const cam = this.camera;
    const next = damp(cam.fov, target, 3.5, dt);
    if (Math.abs(next - cam.fov) > 0.005) {
      cam.fov = next;
      cam.updateProjectionMatrix();
    }
  }

  /* ------------------------------------------------------------------ */
  /* platform                                                            */
  /* ------------------------------------------------------------------ */
  _onResize() {
    if (!this.renderer) return;
    const w = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    const h = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    // portrait phones: widen the lens so all three lanes stay visible
    cam.fov = cam.aspect < 0.72 ? 74 : cam.aspect < 1 ? 68 : 62;
    cam.updateProjectionMatrix();
    this._baseFov = cam.fov;
    this.ui.showRotateHint(h > w && h < 520);
  }

  _onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (this.state === STATE.PLAYING) this.pause();
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.lastTime = now();
    }
  }

  _onBlur() {
    if (this.state === STATE.PLAYING) this.pause();
  }

  /* ------------------------------------------------------------------ */
  dispose() {
    this._stopLoop();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    window.visualViewport?.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('blur', this._onBlur);
    this.input.detach();
    this.world?.dispose();
    this.field?.dispose();
    this.player?.dispose();
    this.renderer?.dispose();
  }
}
