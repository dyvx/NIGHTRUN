import * as THREE from 'three';
import {
  LANE_X,
  LANE_COUNT,
  SPAWN_Z,
  DESPAWN_Z,
  POOL,
  MIN_ROW_GAP,
  ROW_GAP_TIME_MIN,
  ROW_GAP_TIME_MAX,
  ROW_PREFILL,
  HITBOX_SHRINK_X,
  HITBOX_SHRINK_Z,
  COLORS,
} from './constants.js';
import { rand, randInt, pick, chance, clamp } from './utils.js';
import { glowTexture } from './Textures.js';

export const OBS = { BARRIER: 'barrier', GATE: 'gate', BLOCK: 'block' };

/* ------------------------------------------------------------------------ */
/* Pool                                                                      */
/* ------------------------------------------------------------------------ */
class Pool {
  constructor(size, make) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const item = make(i);
      item.active = false;
      item.group.visible = false;
      this.items.push(item);
    }
  }

  acquire() {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) {
        it.active = true;
        it.group.visible = true;
        return it;
      }
    }
    return null; // pool exhausted (should never happen with our sizes)
  }

  releaseAll() {
    for (const it of this.items) {
      it.active = false;
      it.group.visible = false;
    }
  }

  get activeCount() {
    let n = 0;
    for (const it of this.items) if (it.active) n++;
    return n;
  }
}

/* ------------------------------------------------------------------------ */
/* Field: obstacles + collectibles + fairness-driven spawner                  */
/* ------------------------------------------------------------------------ */
export class Field {
  constructor(scene, quality = {}) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'field';
    scene.add(this.root);

    this.time = 0;
    this.travel = 0;
    this.nextGap = 26;
    this.rowCount = 0;
    this.lastRowFree = [0, 1, 2];
    this.lastRowWasFull = false;
    this.shardStreak = 0;

    this._buildObstacles();
    this._buildShards(quality);
  }

  /* ------------------------------------------------------------------ */
  _buildObstacles() {
    const darkMetal = new THREE.MeshStandardMaterial({
      color: 0x241638,
      roughness: 0.4,
      metalness: 0.7,
      emissive: 0x2a1147,
      emissiveIntensity: 1.5,
    });
    // Neon parts ignore fog so obstacles stay readable at speed.
    const neon = (color) => new THREE.MeshBasicMaterial({ color, fog: false });
    const crimsonGlow = neon(COLORS.crimson);
    const cyanGlow = neon(COLORS.cyan);
    const violetGlow = neon(COLORS.violet);
    const blueGlow = neon(COLORS.blue);
    const goldGlow = neon(COLORS.gold);
    this.materials = { darkMetal, crimsonGlow, cyanGlow, violetGlow, blueGlow, goldGlow };

    const glowPlane = new THREE.PlaneGeometry(1, 1);
    this.geometries = [glowPlane];

    /* ---------------- BARRIER (jump) ---------------- */
    const barrierBody = new THREE.BoxGeometry(1.88, 0.62, 0.3);
    const barrierBar = new THREE.BoxGeometry(2.0, 0.1, 0.36);
    const barrierPost = new THREE.BoxGeometry(0.1, 0.66, 0.1);
    this.geometries.push(barrierBody, barrierBar, barrierPost);

    const makeBarrier = () => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(barrierBody, darkMetal);
      body.position.y = 0.3;
      group.add(body);
      const bar = new THREE.Mesh(barrierBar, crimsonGlow);
      bar.position.y = 0.58;
      group.add(bar);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(barrierPost, darkMetal);
        post.position.set(sx * 0.9, 0.31, 0);
        group.add(post);
      }
      // glow halo so it reads at distance
      const haloMat = new THREE.MeshBasicMaterial({
        map: glowTexture('#ff2f6d'),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const halo = new THREE.Mesh(glowPlane, haloMat);
      halo.scale.set(3.4, 1.9, 1);
      halo.position.set(0, 0.45, -0.05);
      group.add(halo);
      return {
        group,
        kind: OBS.BARRIER,
        hx: 0.93,
        hy: 0.31,
        hz: 0.15,
        cy: 0.31,
        halo,
      };
    };

    /* ---------------- GATE (slide) ---------------- */
    const gatePost = new THREE.BoxGeometry(0.17, 3.24, 0.17);
    const gateBeam = new THREE.BoxGeometry(2.24, 1.42, 0.3);
    const gateLaser = new THREE.BoxGeometry(2.14, 0.07, 0.08);
    const gateEdge = new THREE.BoxGeometry(2.2, 0.1, 0.34);
    const gateStrip = new THREE.BoxGeometry(0.06, 3.1, 0.06);
    const gateCurtain = new THREE.BoxGeometry(0.05, 0.6, 0.05);
    this.geometries.push(gatePost, gateBeam, gateLaser, gateEdge, gateStrip, gateCurtain);

    const makeGate = () => {
      const group = new THREE.Group();
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(gatePost, darkMetal);
        post.position.set(sx * 1.08, 1.62, 0);
        group.add(post);
        // inner violet rails make the frame read instantly at speed
        for (const dz of [-0.11, 0.11]) {
          const strip = new THREE.Mesh(gateStrip, violetGlow);
          strip.position.set(sx * 1.08, 1.62, dz);
          group.add(strip);
        }
      }
      // solid upper block — there is no jumping over a gate, only sliding under
      const beam = new THREE.Mesh(gateBeam, darkMetal);
      beam.position.y = 2.33;
      group.add(beam);
      // the kill line: a hot crimson bar at the bottom edge of the block
      const underEdge = new THREE.Mesh(gateEdge, crimsonGlow);
      underEdge.position.set(0, 1.57, 0);
      group.add(underEdge);
      // laser curtain hanging from the block — unmistakably "slide under me"
      for (let i = -3; i <= 3; i++) {
        const strip = new THREE.Mesh(gateCurtain, crimsonGlow);
        strip.position.set(i * 0.29, 1.88, 0.03);
        group.add(strip);
      }
      // top highlight
      const topEdge = new THREE.Mesh(gateEdge, violetGlow);
      topEdge.position.set(0, 3.03, 0);
      topEdge.scale.set(1, 0.7, 1);
      group.add(topEdge);
      // the kill line you have to get under
      const laser = new THREE.Mesh(gateLaser, crimsonGlow);
      laser.position.set(0, 1.47, 0);
      group.add(laser);
      const laser2 = new THREE.Mesh(gateLaser, crimsonGlow);
      laser2.position.set(0, 1.53, 0.02);
      laser2.scale.set(1, 0.7, 1);
      group.add(laser2);
      const haloMat = new THREE.MeshBasicMaterial({
        map: glowTexture('#ff2f6d'),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const halo = new THREE.Mesh(glowPlane, haloMat);
      halo.scale.set(4.0, 1.1, 1);
      halo.position.set(0, 1.5, -0.02);
      group.add(halo);
      return {
        group,
        kind: OBS.GATE,
        hx: 1.06,
        hy: 0.86,
        hz: 0.14,
        cy: 2.32,
        halo,
      };
    };

    /* ---------------- BLOCK (dodge) ---------------- */
    const blockBody = new THREE.BoxGeometry(1.92, 2.86, 1.14);
    const blockEdge = new THREE.BoxGeometry(1.96, 0.1, 1.18);
    const blockBand = new THREE.BoxGeometry(1.94, 0.16, 1.16);
    this.geometries.push(blockBody, blockEdge, blockBand);

    const makeBlock = () => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(blockBody, darkMetal);
      body.position.y = 1.43;
      group.add(body);
      const edgeTop = new THREE.Mesh(blockEdge, cyanGlow);
      edgeTop.position.y = 2.86;
      group.add(edgeTop);
      const edgeBottom = new THREE.Mesh(blockEdge, cyanGlow);
      edgeBottom.position.y = 0.06;
      group.add(edgeBottom);
      const band = new THREE.Mesh(blockBand, blueGlow);
      band.position.y = 1.5;
      group.add(band);
      const haloMat = new THREE.MeshBasicMaterial({
        map: glowTexture('#2f6bff'),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const halo = new THREE.Mesh(glowPlane, haloMat);
      halo.scale.set(4.2, 5.2, 1);
      halo.position.set(0, 1.5, -0.6);
      group.add(halo);
      return {
        group,
        kind: OBS.BLOCK,
        hx: 0.96,
        hy: 1.43,
        hz: 0.57,
        cy: 1.43,
        halo,
      };
    };

    this.barriers = new Pool(POOL.barrierLow, makeBarrier);
    this.gates = new Pool(POOL.gate, makeGate);
    this.blocks = new Pool(POOL.block, makeBlock);
    this.pools = { [OBS.BARRIER]: this.barriers, [OBS.GATE]: this.gates, [OBS.BLOCK]: this.blocks };

    for (const pool of [this.barriers, this.gates, this.blocks]) {
      for (const it of pool.items) this.root.add(it.group);
    }
  }

  /* ------------------------------------------------------------------ */
  _buildShards(quality) {
    const geo = new THREE.OctahedronGeometry(0.23, 0);
    const coreGeo = new THREE.OctahedronGeometry(0.11, 0);
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.gold, fog: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false });
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture('#ffcc66'),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glowGeo = new THREE.PlaneGeometry(1.25, 1.25);
    this.geometries.push(geo, coreGeo, glowGeo);
    this.shardMaterials = [mat, coreMat, glowMat];

    const count = quality.shards || POOL.shard;
    this.shards = new Pool(count, () => {
      const group = new THREE.Group();
      const halo = new THREE.Mesh(glowGeo, glowMat);
      group.add(halo);
      const m = new THREE.Mesh(geo, mat);
      group.add(m);
      const core = new THREE.Mesh(coreGeo, coreMat);
      group.add(core);
      return { group, kind: 'shard', spin: rand(0.6, 1.4), halo };
    });
    for (const s of this.shards.items) this.root.add(s.group);
  }

  /* ------------------------------------------------------------------ */
  reset() {
    for (const pool of [this.barriers, this.gates, this.blocks, this.shards]) pool.releaseAll();
    this.time = 0;
    this.travel = 0;
    this.rowCount = 0;
    this.nextGap = 18; // calm opening
    this.lastRowFree = [0, 1, 2];
    this.lastRowWasFull = false;
    this.shardStreak = 0;
  }

  /* ------------------------------------------------------------------ */
  /* spawning                                                            */
  /* ------------------------------------------------------------------ */
  _place(kind, lane, z, extra = {}) {
    const pool = this.pools[kind];
    const item = pool.acquire();
    if (!item) return null;
    item.lane = lane;
    item.x = LANE_X[lane];
    item.z = z;
    // Critical: a recycled obstacle must not keep the sweep position from its
    // previous life, or the swept collision test would fire instantly.
    item.prevZ = z;
    item.group.position.set(item.x, 0, z);
    item.group.rotation.set(0, 0, 0);
    if (kind === OBS.GATE) item.group.rotation.y = 0;
    if (extra.rotation) item.group.rotation.y = extra.rotation;
    return item;
  }

  _spawnShard(x, y, z) {
    const s = this.shards.acquire();
    if (!s) return;
    s.z = z;
    s.prevZ = z;
    s.group.position.set(x, y, z);
    s.baseY = y;
    s.phase = rand(0, 6.28);
  }

  /**
   * One row of obstacles. Guarantees:
   *  - at least one lane is ALWAYS completely free (except rare, well-telegraphed
   *    full-gate rows where sliding is the only answer and there is extra space)
   *  - a jump never has to be cancelled right after it starts
   *  - free lanes overlap with the previous row's free lanes, so a continuous
   *    safe path always exists.
   */
  _spawnRow(speed, difficulty, z = SPAWN_Z, gapToNext = MIN_ROW_GAP) {
    const maxLanes = difficulty > 0.32 && chance(0.62) ? 2 : 1;

    // rare, fully readable "slide or die" row at higher speed
    const fullGate =
      difficulty > 0.55 && !this.lastRowWasFull && this.rowCount > 6 && chance(0.09);

    if (fullGate) {
      for (let lane = 0; lane < LANE_COUNT; lane++) this._place(OBS.GATE, lane, z);
      this.lastRowFree = [];
      this.lastRowWasFull = true;
      this.rowCount++;
      return;
    }

    // choose lanes to occupy, biased so the previous safe lanes stay usable
    const occupied = [];
    if (maxLanes >= 2 && chance(0.55)) {
      // block two lanes, keep one — prefer keeping a previously-free lane
      const keep = pick(this.lastRowFree.length ? this.lastRowFree : [0, 1, 2]);
      for (let lane = 0; lane < LANE_COUNT; lane++) if (lane !== keep) occupied.push(lane);
    } else {
      // single obstacle: prefer a lane that is not the newest safe lane
      const candidates = [0, 1, 2].filter((l) => l !== this.lastRowFree[0] || chance(0.3));
      occupied.push(pick(candidates.length ? candidates : [0, 1, 2]));
    }

    const free = [0, 1, 2].filter((l) => !occupied.includes(l));
    if (free.length === 0) {
      // safety net — never allow a fully blocked row here
      occupied.pop();
      free.push(2);
    }

    // what kind? jump-friendly barriers, slide-friendly gates, dodge blocks
    const roll = Math.random();
    let kind;
    if (roll < 0.4) kind = OBS.BARRIER;
    else if (roll < 0.76) kind = OBS.GATE;
    else kind = OBS.BLOCK;

    // at very low difficulty, prefer simple dodge blocks (pure lane switching)
    if (difficulty < 0.08) kind = chance(0.7) ? OBS.BLOCK : OBS.GATE;

    for (const lane of occupied) this._place(kind, lane, z);

    this.lastRowFree = free;
    this.lastRowWasFull = false;
    this.rowCount++;

    // ---- reward trail through the open lane ----
    if (chance(0.72)) {
      const lane = pick(free);
      // trail lives between this row and (safely before) the next one
      const span = clamp(gapToNext - 10, 3, 12);
      const n = randInt(3, 6);
      const startZ = z + 5;
      for (let i = 0; i < n; i++) {
        this._spawnShard(LANE_X[lane], 1.05 + Math.sin(i * 0.9) * 0.16, startZ + (i * span) / n);
      }
      // sometimes a shard arc rewards a jump over a barrier
      if (kind === OBS.BARRIER && chance(0.5)) {
        const lane2 = occupied[0];
        for (let i = 0; i < 5; i++) {
          const t = i / 4;
          this._spawnShard(LANE_X[lane2], 0.9 + Math.sin(t * Math.PI) * 1.75, z + 4.6 - t * 2.4);
        }
      }
    }
  }

  _chooseGap(speed, difficulty) {
    // reaction window shrinks with difficulty but keeps a hard floor
    // Reaction time per row: ~0.9s at the start, ~0.66s at max speed.
    const tMin = clamp(ROW_GAP_TIME_MIN - difficulty * 0.24, 0.66, ROW_GAP_TIME_MIN);
    const tMax = clamp(ROW_GAP_TIME_MAX - difficulty * 0.3, 1.05, ROW_GAP_TIME_MAX);
    const gap = speed * rand(tMin, tMax);
    // after a "must react" row give extra room
    const pad = this.lastRowWasFull ? 10 : 0;
    return clamp(Math.max(MIN_ROW_GAP, gap) + pad, MIN_ROW_GAP, 30);
  }

  /**
   * Fill the road ahead so a run starts in the middle of the action instead of
   * on an empty street. The first row sits far enough out to be a fair warning.
   */
  prefill(speed) {
    let z = -34;
    for (let i = 0; i < ROW_PREFILL && z > SPAWN_Z; i++) {
      const step = rand(13, 19);
      this._spawnRow(speed, 0, z, step);
      z -= step;
    }
    this.nextGap = rand(16, 22);
  }

  /* ------------------------------------------------------------------ */
  /* update                                                              */
  /* ------------------------------------------------------------------ */
  /**
   * @param {number} dt
   * @param {number} speed    current world speed (m/s)
   * @param {number} difficulty 0..1
   * @param {object} player   Player instance
   * @param {object} events   { onObstacleHit(item), onShard(count) }
   */
  update(dt, speed, difficulty, player, events, cameraQuat) {
    this.time += dt;
    const dz = speed * dt;

    /* ---------- move + recycle obstacles ---------- */
    for (const kind of [OBS.BARRIER, OBS.GATE, OBS.BLOCK]) {
      const pool = this.pools[kind];
      for (const it of pool.items) {
        if (!it.active) continue;
        it.prevZ = it.z;
        it.z += dz;
        it.group.position.z = it.z;
        // laser pulse for gates
        if (kind === OBS.GATE && it.halo) {
          it.halo.material.opacity = 0.32 + Math.sin(this.time * 9 + it.lane) * 0.12;
        }
        if (it.z > DESPAWN_Z) {
          it.active = false;
          it.group.visible = false;
        }
      }
    }

    /* ---------- move + collect shards ---------- */
    const py = player.y;
    const ph = player.height;
    const collectTop = py + ph + 0.55;
    const collectBottom = py - 0.25;
    const px = player.x;

    for (const s of this.shards.items) {
      if (!s.active) continue;
      const prevZ = s.z;
      s.z += dz;
      s.group.position.z = s.z;
      s.group.rotation.y += dt * 2.6 * s.spin;
      s.group.rotation.x = Math.sin(this.time * 2 + s.phase) * 0.3;
      if (s.halo && cameraQuat) s.halo.quaternion.copy(cameraQuat);
      s.group.position.y = s.baseY + Math.sin(this.time * 2.4 + s.phase) * 0.09;

      if (s.z > DESPAWN_Z - 2) {
        s.active = false;
        s.group.visible = false;
        continue;
      }
      // collection test (player occupies z ~ 0). Swept so fast frames and
      // high speeds can never skip past a shard.
      if (prevZ - 0.75 <= 0 && s.z + 0.75 >= 0) {
        const dx = Math.abs(s.group.position.x - px);
        if (dx < 0.72) {
          const sy = s.group.position.y;
          if (sy > collectBottom && sy < collectTop) {
            s.active = false;
            s.group.visible = false;
            events.onShard(1);
          }
        }
      }
    }

    /* ---------- spawn ---------- */
    this.travel += dz;
    if (this.travel >= this.nextGap) {
      this.travel -= this.nextGap;
      // Pick the gap first: a row needs to know how much room follows it so
      // collectible trails never intrude on the next row.
      const gap = this._chooseGap(speed, difficulty);
      this._spawnRow(speed, difficulty, SPAWN_Z, gap);
      this.nextGap = gap;
    }

    /* ---------- collisions ---------- */
    if (player.alive) {
      const pcx = px;
      const pcy = py + ph * 0.5;
      const phy = ph * 0.5;
      const phz = 0.31 - HITBOX_SHRINK_Z;

      for (const kind of [OBS.BARRIER, OBS.GATE, OBS.BLOCK]) {
        const pool = this.pools[kind];
        for (const it of pool.items) {
          if (!it.active) continue;
          // Swept test along z: did this obstacle cross the player's slab
          // during this frame? (prevents tunnelling at 40 m/s / 30 fps)
          const halfZ = it.hz + phz;
          const zFrom = it.prevZ !== undefined ? it.prevZ : it.z;
          const nz = Math.min(zFrom, it.z);
          const fz = Math.max(zFrom, it.z);
          if (fz < -halfZ || nz > halfZ) continue;
          if (Math.abs(pcx - it.x) > it.hx - HITBOX_SHRINK_X) continue;
          if (Math.abs(pcy - it.cy) > it.hy + phy) continue;
          events.onObstacleHit(it);
          return;
        }
      }
    }
  }

  get activeObstacles() {
    return this.barriers.activeCount + this.gates.activeCount + this.blocks.activeCount;
  }

  /* ------------------------------------------------------------------ */
  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      // textures are cached & shared globally — only geometry is ours to free
      if (o.geometry) o.geometry.dispose();
    });
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    for (const m of this.shardMaterials) m.dispose();
  }
}
