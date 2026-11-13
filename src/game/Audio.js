/**
 * NIGHTRUN audio — 100% procedural Web Audio.
 * No mp3/ogg files: the soundtrack and every effect are synthesised on the
 * device, so audio works offline and adds zero bytes to the build.
 */

const BPM = 132;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.18; // seconds scheduled ahead

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.audioOn = true;
    this.musicOn = true;
    this.musicPlaying = false;
    this.step = 0;
    this.nextStepTime = 0;
    this.timer = null;
    this._noise = null;
    this._sfxCount = 0;
    this._sfxWindow = 0;
    this._chords = [
      { root: 45, notes: [0, 3, 7, 10] }, // A minor
      { root: 41, notes: [0, 4, 7, 11] }, // F major 7
      { root: 48, notes: [0, 4, 7, 11] }, // C major 7
      { root: 43, notes: [0, 4, 7, 10] }, // G7
    ];
  }

  /* ------------------------------------------------------------------ */
  init() {
    if (this.ready) {
      this.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        this.ctx = new AC();
      } catch {
        return false;
      }
    }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.audioOn ? 0.9 : 0;
    this.master.connect(ctx.destination);

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 3.2;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.24;
    this.comp.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.comp);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.3 : 0;
    this.musicBus.connect(this.comp);

    // shared noise buffer
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;

    this.ready = true;
    this.resume();
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  setAudio(on) {
    this.audioOn = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.08);
    }
    if (on && this.musicPlaying === false && this.started) this.startMusic();
  }

  /* ------------------------------------------------------------------ */
  /* music                                                              */
  /* ------------------------------------------------------------------ */
  startMusic() {
    if (!this.ready) return;
    this.started = true;
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _schedule() {
    if (!this.ready || !this.musicPlaying || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (this.nextStepTime < now) this.nextStepTime = now + 0.02;
    while (this.nextStepTime < now + LOOKAHEAD) {
      this._playStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % (16 * 4);
      this.nextStepTime += STEP;
    }
  }

  _playStep(step, time) {
    const bar = (step / 16) | 0;
    const s = step % 16;
    const chord = this._chords[bar];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    /* ---- drums ---- */
    if (s % 4 === 0) this._kick(time);
    if (s === 4 || s === 12) this._snare(time);
    if (s % 2 === 1) this._hat(time, s % 4 === 3 ? 0.09 : 0.05);

    /* ---- bass ---- */
    if (s % 2 === 0) {
      const octave = s === 6 || s === 14 ? 12 : 0;
      this._bass(time, mtof(chord.root + octave), s % 4 === 0 ? 0.16 : 0.1);
    }

    /* ---- arp lead (sparse, dreamy) ---- */
    if (s % 2 === 0 || s === 7) {
      const idx = (step * 3) % chord.notes.length;
      const note = chord.root + 24 + chord.notes[idx];
      this._arp(time, mtof(note), 0.055);
    }

    /* ---- pad at bar start ---- */
    if (s === 0) this._pad(time, chord);
  }

  _kick(t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.62, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  _snare(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
  }

  _hat(t, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.08);
  }

  _bass(t, freq, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(320, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.2);
    lp.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(lp).connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  _arp(t, freq, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const delay = ctx.createDelay(0.5);
    const fb = ctx.createGain();
    const wet = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    delay.delayTime.value = STEP * 3;
    fb.gain.value = 0.3;
    wet.gain.value = 0.32;

    osc.connect(lp).connect(g);
    g.connect(this.musicBus);
    g.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.musicBus);

    osc.start(t);
    osc.stop(t + 0.24);
  }

  _pad(t, chord) {
    const ctx = this.ctx;
    for (const note of chord.notes.slice(0, 3)) {
      const freq = 440 * Math.pow(2, (chord.root + 12 + note - 69) / 12);
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc.frequency.value = freq;
      osc2.frequency.value = freq * 1.005;
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      lp.Q.value = 1.2;
      const dur = STEP * 15.4;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.02, t + 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      osc.connect(lp);
      osc2.connect(lp);
      lp.connect(g).connect(this.musicBus);
      osc.start(t);
      osc2.start(t);
      osc.stop(t + dur);
      osc2.stop(t + dur);
    }
  }

  /* ------------------------------------------------------------------ */
  /* sfx                                                                */
  /* ------------------------------------------------------------------ */
  _throttle() {
    const t = this.ctx.currentTime;
    if (t - this._sfxWindow > 0.5) {
      this._sfxWindow = t;
      this._sfxCount = 0;
    }
    if (++this._sfxCount > 14) return false;
    return true;
  }

  sfx(name, opts = {}) {
    if (!this.ready || !this.audioOn || !this.ctx || this.ctx.state !== 'running') return;
    if (!this._throttle()) return;
    const t = this.ctx.currentTime + 0.001;
    switch (name) {
      case 'jump':
        this._tone({ type: 'sine', f0: 300, f1: 760, dur: 0.17, gain: 0.22, t });
        this._tone({ type: 'triangle', f0: 150, f1: 340, dur: 0.12, gain: 0.1, t });
        break;
      case 'slide':
        this._noiseHit({ dur: 0.28, gain: 0.2, type: 'bandpass', f0: 1400, f1: 380, q: 1.4, t });
        break;
      case 'lane':
        this._tone({ type: 'square', f0: 900, f1: 1150, dur: 0.05, gain: 0.05, t });
        break;
      case 'shard': {
        const semis = Math.min(12, opts.streak || 0);
        const f = 880 * Math.pow(2, semis / 24);
        this._tone({ type: 'triangle', f0: f, f1: f * 1.5, dur: 0.1, gain: 0.14, t });
        this._tone({ type: 'sine', f0: f * 2, f1: f * 2.4, dur: 0.07, gain: 0.05, t: t + 0.01 });
        break;
      }
      case 'hit':
        this._tone({ type: 'sawtooth', f0: 220, f1: 42, dur: 0.6, gain: 0.3, t });
        this._noiseHit({ dur: 0.5, gain: 0.3, type: 'lowpass', f0: 2400, f1: 200, q: 0.7, t });
        this._tone({ type: 'sine', f0: 90, f1: 34, dur: 0.5, gain: 0.28, t });
        break;
      case 'ui':
        this._tone({ type: 'triangle', f0: 660, f1: 880, dur: 0.07, gain: 0.08, t });
        break;
      case 'start':
        [0, 4, 7, 12].forEach((semi, i) => {
          this._tone({
            type: 'triangle',
            f0: 440 * Math.pow(2, semi / 12),
            f1: 440 * Math.pow(2, semi / 12) * 1.01,
            dur: 0.16,
            gain: 0.09,
            t: t + i * 0.07,
          });
        });
        break;
      case 'paused':
        this._tone({ type: 'sine', f0: 520, f1: 260, dur: 0.22, gain: 0.1, t });
        break;
      default:
        break;
    }
  }

  _tone({ type = 'sine', f0, f1, dur, gain, t, filter }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq || 2000;
      osc.connect(f).connect(g).connect(this.sfxBus);
    } else {
      osc.connect(g).connect(this.sfxBus);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noiseHit({ dur, gain, type, f0, f1, q = 1, t }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    if (f1) filter.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  /* ------------------------------------------------------------------ */
  dispose() {
    this.stopMusic();
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.ready = false;
  }
}
