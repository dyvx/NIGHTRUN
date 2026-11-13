import * as THREE from 'three';
import {
  GRAVITY,
  JUMP_VELOCITY,
  LANE_X,
  LANE_SWITCH_RATE,
  PLAYER_H,
  PLAYER_HALF_W,
  PLAYER_DEPTH,
  SLIDE_H,
  SLIDE_TIME,
  SLIDE_COOLDOWN,
  JUMP_BUFFER,
  COYOTE_TIME,
} from './constants.js';
import { clamp, damp } from './utils.js';
import { glowTexture } from './Textures.js';

/**
 * KAI-7 — the courier. An original anime-styled runner built entirely from
 * primitives (no model downloads) and animated procedurally.
 */
export class Player {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'player';

    this.laneIndex = 1;
    this.targetX = LANE_X[1];
    this.x = LANE_X[1];
    this.y = 0;
    this.vy = 0;
    this.state = 'run'; // 'run' | 'air' | 'slide'
    this.slideTimer = 0;
    this.slideCooldown = 0;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.runPhase = 0;
    this.leanZ = 0;
    this.airTime = 0;
    this.landSquash = 0;
    this.alive = true;

    this._materials = [];
    this._buildModel();
    this.reset();
  }

  /* ------------------------------------------------------------------ */
  /* model                                                               */
  /* ------------------------------------------------------------------ */
  _mat(color, { emissive = 0x000000, intensity = 0, rough = 0.55, metal = 0.25 } = {}) {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: intensity,
      roughness: rough,
      metalness: metal,
    });
    this._materials.push(m);
    return m;
  }

  _buildModel() {
    const M = {
      suit: this._mat(0x140b26, { rough: 0.6, metal: 0.35 }),
      jacket: this._mat(0xff2f6d, { emissive: 0xff2f6d, intensity: 0.34, rough: 0.45 }),
      trim: this._mat(0x45f0ff, { emissive: 0x45f0ff, intensity: 1.5, rough: 0.3 }),
      skin: this._mat(0xf3cfc0, { rough: 0.72, metal: 0.02 }),
      hair: this._mat(0xa24bff, { emissive: 0x7a1fff, intensity: 0.45, rough: 0.55 }),
      visor: this._mat(0x45f0ff, { emissive: 0x45f0ff, intensity: 2.2, rough: 0.2, metal: 0.6 }),
      boot: this._mat(0x1b1030, { rough: 0.6 }),
      gold: this._mat(0xffcc66, { emissive: 0xffcc66, intensity: 1.1, rough: 0.35 }),
    };
    this.mats = M;

    const body = new THREE.Group();
    body.position.y = 0.94;
    this.body = body;
    this.group.add(body);

    /* ---------------- torso ---------------- */
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.215, 0.36, 4, 12), M.suit);
    torso.position.y = 0.28;
    torso.scale.set(1.06, 1, 0.78);
    body.add(torso);

    const jacket = new THREE.Mesh(new THREE.CapsuleGeometry(0.235, 0.26, 4, 12), M.jacket);
    jacket.position.y = 0.36;
    jacket.scale.set(1.02, 1, 0.82);
    body.add(jacket);

    // chest emitter
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.03), M.trim);
    chest.position.set(0, 0.4, 0.19);
    body.add(chest);

    // back thruster housing
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.14), M.boot);
    pack.position.set(0, 0.36, -0.2);
    body.add(pack);
    for (const sx of [-0.1, 0.1]) {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 8), M.trim);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(sx, 0.28, -0.28);
      body.add(noz);
    }

    /* ---------------- head ---------------- */
    const head = new THREE.Group();
    head.position.y = 0.78;
    body.add(head);
    this.head = head;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 14), M.skin);
    skull.scale.set(1, 1.06, 0.96);
    head.add(skull);

    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.178, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), M.hair);
    hairBack.position.y = 0.02;
    hairBack.rotation.x = -0.24;
    head.add(hairBack);

    // spiky anime hair — instanced cones would be cheaper, but it's 6 meshes total
    const spikeGeo = new THREE.ConeGeometry(0.062, 0.3, 6);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(spikeGeo, M.hair);
      const a = -0.75 + i * 0.3;
      spike.position.set(Math.sin(a) * 0.1, 0.13 - Math.abs(a) * 0.02, -0.03 - Math.cos(a) * 0.07);
      spike.rotation.set(-0.5 - Math.random() * 0.25, 0, a * 0.8);
      spike.scale.setScalar(0.85 + Math.random() * 0.35);
      head.add(spike);
    }
    // forehead fringe
    const fringe = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 5), M.hair);
    fringe.position.set(-0.06, 0.12, 0.1);
    fringe.rotation.set(0.35, 0, 0.6);
    head.add(fringe);

    // visor
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.075, 0.06), M.visor);
    visor.position.set(0, 0.02, 0.14);
    visor.rotation.x = 0.06;
    head.add(visor);
    const visorGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshBasicMaterial({
      map: glowTexture('#45f0ff'),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    visorGlow.position.set(0, 0.02, 0.19);
    head.add(visorGlow);

    // ear pods
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), M.gold);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(sx * 0.16, 0.01, 0);
      head.add(pod);
    }

    /* ---------------- arms ---------------- */
    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.25, 0.42, 0);
      body.add(shoulder);

      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.22, 3, 8), M.jacket);
      upper.position.y = -0.14;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      shoulder.add(elbow);

      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.2, 3, 8), M.suit);
      fore.position.y = -0.12;
      elbow.add(fore);

      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.035, 8), M.trim);
      cuff.position.y = -0.24;
      elbow.add(cuff);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), M.skin);
      hand.position.y = -0.29;
      hand.scale.set(0.85, 1.1, 0.85);
      elbow.add(hand);

      this.arms.push({ side, shoulder, elbow });
    }

    /* ---------------- legs ---------------- */
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.115, -0.04, 0);
      body.add(hip);

      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.3, 3, 10), M.suit);
      thigh.position.y = -0.2;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);

      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.28, 3, 10), M.suit);
      shin.position.y = -0.18;
      knee.add(shin);

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.27), M.boot);
      boot.position.set(0, -0.36, 0.05);
      knee.add(boot);

      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.028, 0.28), M.trim);
      sole.position.set(0, -0.42, 0.05);
      knee.add(sole);

      this.legs.push({ side, hip, knee });
    }

    /* ---------------- scarf / trail ---------------- */
    this.scarf = [];
    const scarfGeo = new THREE.BoxGeometry(0.11, 0.03, 0.26);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(scarfGeo, this._mat(0xff2f6d, { emissive: 0xff2f6d, intensity: 0.7, rough: 0.5 }));
      seg.position.set(0, 0.62 - i * 0.02, -0.18 - i * 0.2);
      seg.scale.setScalar(1 - i * 0.14);
      body.add(seg);
      this.scarf.push(seg);
    }

    /* ---------------- engine glow ---------------- */
    const jetGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({
        map: glowTexture('#45f0ff'),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    jetGlow.position.set(0, 0.3, -0.36);
    body.add(jetGlow);
    this.jetGlow = jetGlow;

    /* ---------------- ground shadow ---------------- */
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.7),
      new THREE.MeshBasicMaterial({
        map: glowTexture('#000000'),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        color: 0x000000,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.group.add(this.shadow);
  }

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  reset() {
    this.laneIndex = 1;
    this.x = LANE_X[1];
    this.targetX = LANE_X[1];
    this.y = 0;
    this.vy = 0;
    this.state = 'run';
    this.slideTimer = 0;
    this.slideCooldown = 0;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.runPhase = 0;
    this.leanZ = 0;
    this.airTime = 0;
    this.landSquash = 0;
    this.alive = true;
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0.94;
    this.group.rotation.set(0, 0, 0);
    this.group.position.set(this.x, 0, 0);
    this.group.visible = true;
    this.shadow.visible = true;
    this.head.rotation.set(0, 0, 0);
  }

  get height() {
    return this.state === 'slide' ? SLIDE_H : PLAYER_H;
  }

  /** AABB used for collision. Reuses the provided object (no allocation). */
  getCollider(out) {
    const h = this.height;
    out.cx = this.x;
    out.cy = this.y + h * 0.5;
    out.cz = 0;
    out.hx = PLAYER_HALF_W;
    out.hy = h * 0.5;
    out.hz = PLAYER_DEPTH * 0.5;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* input intents                                                       */
  /* ------------------------------------------------------------------ */
  moveLane(dir) {
    const next = clamp(this.laneIndex + dir, 0, LANE_X.length - 1);
    if (next === this.laneIndex) {
      // nudge feedback: a tiny lean even at the walls
      this.leanZ = -dir * 0.16;
      return false;
    }
    this.laneIndex = next;
    this.targetX = LANE_X[next];
    this.leanZ = -dir * 0.42;
    return true;
  }

  jump() {
    if (this.state === 'air') {
      this.jumpBuffer = JUMP_BUFFER;
      return false;
    }
    this._startJump();
    return true;
  }

  _startJump() {
    this.vy = JUMP_VELOCITY;
    this.state = 'air';
    this.slideTimer = 0;
    this.airTime = 0;
    this.jumpBuffer = 0;
  }

  slide() {
    if (this.state === 'air') {
      // fast-fall into a slide — feels great and rescues late inputs
      this.vy = Math.min(this.vy, -GRAVITY * 0.22);
      this.jumpBuffer = 0;
      this.state = 'air';
      this.slideTimer = SLIDE_TIME;
      this._slideQueued = true;
      return true;
    }
    if (this.slideCooldown > 0 && this.state === 'slide') return false;
    this.state = 'slide';
    this.slideTimer = SLIDE_TIME;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* update                                                              */
  /* ------------------------------------------------------------------ */
  update(dt, speed) {
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // ---- horizontal lane motion (exponential smoothing) ----
    this.x = damp(this.x, this.targetX, LANE_SWITCH_RATE, dt);
    if (Math.abs(this.x - this.targetX) < 0.002) this.x = this.targetX;
    this.leanZ = damp(this.leanZ, 0, 9, dt);

    // ---- vertical ----
    if (this.state === 'air') {
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.landSquash = 1;
        if (this._slideQueued) {
          this._slideQueued = false;
          this.state = 'slide';
          this.slideTimer = Math.max(0.18, this.slideTimer);
        } else {
          this.state = 'run';
          if (this.jumpBuffer > 0) this._startJump();
        }
      }
    } else if (this.state === 'slide') {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.state = 'run';
        this.slideCooldown = SLIDE_COOLDOWN;
      }
    }

    this.landSquash = Math.max(0, this.landSquash - dt * 5);

    // ---- animation ----
    this._animate(dt, speed);

    this.group.position.x = this.x;
    this.group.position.y = this.y;

    // ground shadow: shrinks + fades with altitude
    const t = clamp(this.y / 2.4, 0, 1);
    this.shadow.position.y = 0.02 - this.y + 0.001;
    this.shadow.scale.setScalar(1 - t * 0.45);
    this.shadow.material.opacity = 0.55 * (1 - t * 0.7);
  }

  _animate(dt, speed) {
    const rate = 3.4 + speed * 0.42;
    this.runPhase += dt * rate;
    const p = this.runPhase;
    const body = this.body;

    const speedNorm = clamp((speed - 15) / 26, 0, 1);

    if (this.state === 'air') {
      const tuck = clamp(this.airTime * 6, 0, 1);
      // legs tucked, arms swept back
      this.legs[0].hip.rotation.x = -0.95 * tuck;
      this.legs[0].knee.rotation.x = 1.25 * tuck;
      this.legs[1].hip.rotation.x = 0.45 * tuck;
      this.legs[1].knee.rotation.x = 0.5 * tuck;
      this.arms[0].shoulder.rotation.x = -1.5 * tuck;
      this.arms[0].shoulder.rotation.z = -0.35 * tuck;
      this.arms[1].shoulder.rotation.x = -1.2 * tuck;
      this.arms[1].shoulder.rotation.z = 0.35 * tuck;
      this.arms[0].elbow.rotation.x = 0.5;
      this.arms[1].elbow.rotation.x = 0.5;
      body.position.y = 0.94;
      body.rotation.x = damp(body.rotation.x, -0.16 + this.vy * 0.008, 8, dt);
      body.rotation.z = damp(body.rotation.z, this.leanZ * 0.5, 10, dt);
    } else if (this.state === 'slide') {
      const k = clamp(1 - this.slideTimer / SLIDE_TIME, 0, 1);
      const ease = Math.min(1, k * 6);
      this.legs[0].hip.rotation.x = -1.28 * ease;
      this.legs[0].knee.rotation.x = 0.28 * ease;
      this.legs[1].hip.rotation.x = -0.55 * ease;
      this.legs[1].knee.rotation.x = 1.55 * ease;
      this.arms[0].shoulder.rotation.x = 0.7 * ease;
      this.arms[1].shoulder.rotation.x = -0.5 * ease;
      this.arms[0].elbow.rotation.x = 0.9;
      this.arms[1].elbow.rotation.x = 1.1;
      body.rotation.x = damp(body.rotation.x, -1.02 * ease, 18, dt);
      body.rotation.z = damp(body.rotation.z, this.leanZ * 0.35, 10, dt);
      body.position.y = damp(body.position.y, 0.94 - 0.1 * ease, 18, dt);
    } else {
      // running
      const swing = 0.86 + speedNorm * 0.22;
      this.legs[0].hip.rotation.x = Math.sin(p) * swing;
      this.legs[1].hip.rotation.x = Math.sin(p + Math.PI) * swing;
      this.legs[0].knee.rotation.x = Math.max(0, Math.sin(p + 1.9)) * 1.5 + 0.12;
      this.legs[1].knee.rotation.x = Math.max(0, Math.sin(p + 1.9 + Math.PI)) * 1.5 + 0.12;

      this.arms[0].shoulder.rotation.x = Math.sin(p + Math.PI) * (0.7 + speedNorm * 0.3);
      this.arms[1].shoulder.rotation.x = Math.sin(p) * (0.7 + speedNorm * 0.3);
      this.arms[0].shoulder.rotation.z = -0.16;
      this.arms[1].shoulder.rotation.z = 0.16;
      this.arms[0].elbow.rotation.x = 0.75 + Math.sin(p) * 0.28;
      this.arms[1].elbow.rotation.x = 0.75 + Math.sin(p + Math.PI) * 0.28;

      const bob = Math.sin(p * 2) * 0.035 + Math.abs(Math.sin(p)) * 0.02;
      body.position.y = damp(body.position.y, 0.94 + bob - this.landSquash * 0.09, 20, dt);
      body.rotation.x = damp(body.rotation.x, 0.1 + speedNorm * 0.14 + this.landSquash * 0.14, 12, dt);
      body.rotation.z = damp(body.rotation.z, this.leanZ, 12, dt);
      // head counter-rotation keeps the visor level
      this.head.rotation.x = -body.rotation.x * 0.55;
      this.head.rotation.z = -body.rotation.z * 0.4;
    }

    // scarf flutter
    const flut = Math.sin(p * 1.6) * 0.16 + Math.sin(p * 2.7) * 0.07;
    for (let i = 0; i < this.scarf.length; i++) {
      const s = this.scarf[i];
      s.rotation.x = 0.34 + flut * (0.5 + i * 0.35);
      s.position.z = -0.2 - i * 0.19;
      s.position.x = flut * (0.02 + i * 0.03);
    }

    // thruster pulse
    const pulse = 0.34 + Math.sin(p * 3) * 0.08 + speedNorm * 0.24;
    this.jetGlow.material.opacity = pulse;
    this.jetGlow.scale.setScalar(0.8 + speedNorm * 0.5 + Math.sin(p * 3) * 0.06);
  }

  /* ------------------------------------------------------------------ */
  /* death / teardown                                                    */
  /* ------------------------------------------------------------------ */
  playDeath() {
    this.alive = false;
    this.state = 'air';
    this.vy = 5.5;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // materials are shared within the player and disposed once below
    });
    for (const m of this._materials) m.dispose();
    this.shadow.material.dispose();
    this.jetGlow.material.dispose();
    for (const s of this.scarf) s.material.dispose?.();
  }
}
