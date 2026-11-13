import * as THREE from 'three';
import { COLORS, QUALITY, ROAD_WIDTH, ROAD_HALF, DESPAWN_Z, SPAWN_Z } from './constants.js';
import { rand, randInt, pick, mulberry32, clamp } from './utils.js';
import { roadTexture, facadeTexture, signTexture, glowTexture, bannerTexture, skyTexture } from './Textures.js';

const WORLD_LENGTH = DESPAWN_Z - SPAWN_Z; // wrap-around length
const SIGNS = ['NIGHT CITY', 'NOODLE', '24H', 'SYNTH', 'CLUB 7', 'ARCADE', 'HOTEL', 'KAI-7', 'GRID', 'RAMEN', 'NEO TOKYO'];
const SIGN_HUES = ['cyan', 'violet', 'crimson', 'gold', 'blue'];

/**
 * The neon district: sky, lit road, wrapping skyscrapers, signs, arches,
 * drifting haze and traffic drones. Everything is built from primitives and
 * canvas textures, recycled as the player advances.
 */
export class World {
  constructor(scene, qualityName = 'high') {
    this.scene = scene;
    this.qualityName = QUALITY[qualityName] ? qualityName : 'high';
    this.quality = QUALITY[this.qualityName];

    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);

    this.buildings = [];
    this.signs = [];
    this.arches = [];
    this.drones = [];
    this.mist = [];
    this._tmpColor = new THREE.Color();
    this._disposables = [];

    this.roadOffset = 0;
    this.rnd = mulberry32(20261113);

    this._buildScene();
  }

  /* ------------------------------------------------------------------ */
  _disposable(obj) {
    this._disposables.push(obj);
    return obj;
  }

  _buildScene() {
    const { scene } = this;
    const q = this.quality;

    scene.background = new THREE.Color(COLORS.bg);
    scene.fog = new THREE.FogExp2(COLORS.fog, q.fogDensity);

    /* ----------------------------- sky ----------------------------- */
    const skyGeo = new THREE.SphereGeometry(520, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTexture(),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.name = 'sky';
    this.root.add(sky);
    this.sky = sky;
    this._disposable(skyGeo);
    this._disposable(skyMat);

    // moon / city glow disc
    const moonMat = new THREE.MeshBasicMaterial({
      map: glowTexture('#ff5c8a'),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), moonMat);
    moon.position.set(-90, 95, -430);
    this.root.add(moon);
    this._disposable(moon.geometry);
    this._disposable(moonMat);

    /* ---------------------------- lights --------------------------- */
    // Deliberately cheap: no shadow maps, no light-heavy look. Neon comes from
    // emissive materials, which cost nothing on mobile GPUs.
    this.hemi = new THREE.HemisphereLight(0x6a3cff, 0x120820, 1.15);
    scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0x9fd8ff, 1.35);
    this.key.position.set(-4, 9, 6);
    scene.add(this.key);

    this.rim = new THREE.DirectionalLight(0xff2f6d, 0.85);
    this.rim.position.set(6, 3, -8);
    scene.add(this.rim);

    this.fill = new THREE.PointLight(0x45f0ff, 14, 26, 2);
    this.fill.position.set(0, 2.4, -4);
    scene.add(this.fill);

    /* ----------------------------- road ---------------------------- */
    const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, WORLD_LENGTH + 60);
    const roadTex = roadTexture().clone();
    roadTex.needsUpdate = true;
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.anisotropy = q.anisotropy;
    roadTex.repeat.set(1, (WORLD_LENGTH + 60) / 22);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      color: 0x9a8fbf,
      roughness: 0.38,
      metalness: 0.55,
      emissive: 0x180a2e,
      emissiveIntensity: 0.7,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, (SPAWN_Z + DESPAWN_Z) / 2);
    road.name = 'road';
    this.root.add(road);
    this.road = road;
    this.roadTex = roadTex;
    this._disposable(roadGeo);
    this._disposable(roadMat);

    // side walkways
    const walkGeo = new THREE.PlaneGeometry(9, WORLD_LENGTH + 60);
    const walkMat = new THREE.MeshStandardMaterial({
      color: 0x120b22,
      roughness: 0.72,
      metalness: 0.25,
      emissive: 0x0a0418,
    });
    for (const sx of [-1, 1]) {
      const walk = new THREE.Mesh(walkGeo, walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(sx * (ROAD_HALF + 4.4), -0.01, (SPAWN_Z + DESPAWN_Z) / 2);
      this.root.add(walk);
    }
    this._disposable(walkGeo);
    this._disposable(walkMat);

    // glowing curbs (the "illuminated road" edge)
    const curbGeo = new THREE.BoxGeometry(0.16, 0.2, WORLD_LENGTH + 60);
    const curbMatA = new THREE.MeshBasicMaterial({ color: COLORS.cyan });
    const curbMatB = new THREE.MeshBasicMaterial({ color: COLORS.crimson });
    const curbL = new THREE.Mesh(curbGeo, curbMatA);
    curbL.position.set(-ROAD_HALF - 0.08, 0.05, road.position.z);
    const curbR = new THREE.Mesh(curbGeo, curbMatB);
    curbR.position.set(ROAD_HALF + 0.08, 0.05, road.position.z);
    this.root.add(curbL, curbR);
    this._disposable(curbGeo);
    this._disposable(curbMatA);
    this._disposable(curbMatB);

    // centre glow strip so the horizon reads as a runway
    const stripMat = new THREE.MeshBasicMaterial({
      color: COLORS.violet,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH * 0.96, WORLD_LENGTH + 60), stripMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.012, road.position.z);
    this.root.add(strip);
    this._disposable(strip.geometry);
    this._disposable(stripMat);

    /* --------------------------- skyline --------------------------- */
    this._buildSkyline();
    this._buildBuildings();
    this._buildArches();
    this._buildLamps();
    this._buildDrones();
    this._buildHorizonGlow();
    this._buildMist();
  }

  _buildSkyline() {
    // Far silhouettes — flat, no fog interaction, read as depth.
    const group = new THREE.Group();
    const rnd = mulberry32(7);
    const mat = new THREE.MeshBasicMaterial({
      map: facadeTexture(2),
      color: 0x3a2a63,
      fog: false,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < 26; i++) {
      const h = 30 + rnd() * 110;
      const w = 10 + rnd() * 26;
      const geo = new THREE.PlaneGeometry(w, h);
      const m = new THREE.Mesh(geo, mat);
      const side = i % 2 === 0 ? -1 : 1;
      m.position.set(side * (26 + rnd() * 120), h * 0.42, -340 - rnd() * 110);
      group.add(m);
      this._disposable(geo);
    }
    this._disposable(mat);
    this.root.add(group);
  }

  _buildBuildings() {
    const q = this.quality;
    const rnd = this.rnd;
    const facades = [0, 1, 2, 3].map((v) => facadeTexture(v));
    this.facadeMats = facades.map((tex) => {
      const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
      this._disposable(mat);
      return mat;
    });

    const edgeMat = new THREE.MeshBasicMaterial({
      color: COLORS.cyan,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.edgeMat = edgeMat;
    this._disposable(edgeMat);

    const count = q.buildings;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this._disposable(boxGeo);
    this.buildingGeo = boxGeo;

    const signGeo = new THREE.PlaneGeometry(1, 1);
    this._disposable(signGeo);
    this.signGeo = signGeo;

    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const h = rand(14, 46);
      const w = rand(5, 11);
      const d = rand(6, 14);
      const mesh = new THREE.Mesh(boxGeo, this.facadeMats[randInt(0, 3)]);
      mesh.scale.set(w, h, d);
      const group = new THREE.Group();
      group.add(mesh);

      // neon edge bar on the street-facing side
      if (i % 3 === 0) {
        const edge = new THREE.Mesh(boxGeo, edgeMat);
        edge.scale.set(0.09, h * 0.94, 0.09);
        edge.position.set(side * (w / 2 + 0.05), 0, d / 2 + 0.06);
        group.add(edge);
      }

      const obj = {
        group,
        mesh,
        edge: group.children[1] || null,
        side,
        width: w,
        depth: d,
        height: h,
        x: side * (ROAD_HALF + 5.4 + rnd() * 16 + w * 0.4),
        z: SPAWN_Z + rnd() * WORLD_LENGTH,
      };
      group.position.set(obj.x, h / 2, obj.z);
      group.rotation.y = side > 0 ? -0.06 : 0.06;
      this.root.add(group);
      this.buildings.push(obj);

      // ---- neon sign on some buildings ----
      if (i % 2 === 0) {
        const vertical = rnd() > 0.55;
        const label = pick(SIGNS);
        const hue = pick(SIGN_HUES);
        const tex = signTexture(label, hue, vertical);
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          opacity: 0.96,
        });
        this._disposable(mat);
        const mesh2 = new THREE.Mesh(signGeo, mat);
        const sw = vertical ? 1.9 : 5.2;
        const sh = vertical ? 6.4 : 1.95;
        mesh2.scale.set(sw, sh, 1);
        const signGroup = new THREE.Group();
        signGroup.add(mesh2);
        signGroup.position.set(
          side * (ROAD_HALF + 4.2 + rnd() * 5),
          rand(4, Math.max(6, h * 0.72)),
          obj.z + rand(-3, 3),
        );
        signGroup.rotation.y = side > 0 ? -0.35 : 0.35;
        this.root.add(signGroup);
        this.signs.push({ group: signGroup, mesh: mesh2, z: signGroup.position.z, baseY: signGroup.position.y, phase: rnd() * 6.28 });
      }
    }
  }

  _buildLamps() {
    // Street lighting doubles as a speed cue: posts whip past the camera.
    const postGeo = new THREE.BoxGeometry(0.14, 5.4, 0.14);
    const armGeo = new THREE.BoxGeometry(1.7, 0.1, 0.1);
    const headGeo = new THREE.BoxGeometry(0.62, 0.1, 0.24);
    const postMat = new THREE.MeshBasicMaterial({ color: 0x241a3d });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, fog: false });
    const lampGlowMat = new THREE.MeshBasicMaterial({
      map: glowTexture('#7fe9ff'),
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this._disposable(postGeo);
    this._disposable(armGeo);
    this._disposable(headGeo);
    this._disposable(postMat);
    this._disposable(lampMat);
    this._disposable(lampGlowMat);

    const glowGeo = new THREE.PlaneGeometry(3.2, 3.2);
    this._disposable(glowGeo);
    this.lamps = [];
    const spacing = 24;
    const count = 11;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const group = new THREE.Group();
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = 2.7;
      group.add(post);
      const arm = new THREE.Mesh(armGeo, postMat);
      arm.position.set(-side * 0.85, 5.3, 0);
      group.add(arm);
      const head = new THREE.Mesh(headGeo, lampMat);
      head.position.set(-side * 1.62, 5.22, 0);
      group.add(head);
      const glow = new THREE.Mesh(glowGeo, lampGlowMat);
      glow.position.set(-side * 1.62, 5.05, 0);
      group.add(glow);

      const x = side * (ROAD_HALF + 1.35);
      const z = SPAWN_Z + 6 + i * spacing;
      group.position.set(x, 0, z);
      this.root.add(group);
      this.lamps.push({ group, z, side });
    }
  }

  _buildHorizonGlow() {
    // A soft bloom at the vanishing point — sells "distance" without post-fx.
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture('#8a3cff'),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const geo = new THREE.PlaneGeometry(210, 70);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 12, SPAWN_Z - 150);
    this.root.add(mesh);
    this.horizonGlow = mesh;
    this._disposable(mat);
    this._disposable(geo);
  }

  _buildArches() {
    const beamGeo = new THREE.BoxGeometry(1, 1, 1);
    this._disposable(beamGeo);
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x2a1550 });
    this._disposable(frameMat);
    const glowMat = new THREE.MeshBasicMaterial({
      color: COLORS.cyan,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._disposable(glowMat);
    const bannerMat = new THREE.MeshBasicMaterial({
      map: bannerTexture('NIGHTRUN'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._disposable(bannerMat);

    const spans = 3;
    for (let i = 0; i < spans; i++) {
      const group = new THREE.Group();
      const z = SPAWN_Z + 30 + i * (WORLD_LENGTH / spans);

      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(beamGeo, frameMat);
        post.scale.set(0.5, 13, 0.5);
        post.position.set(sx * (ROAD_HALF + 1.4), 6.5, 0);
        group.add(post);
        const glowStrip = new THREE.Mesh(beamGeo, glowMat);
        glowStrip.scale.set(0.11, 12.4, 0.11);
        glowStrip.position.set(sx * (ROAD_HALF + 1.15), 6.5, 0);
        group.add(glowStrip);
      }
      const top = new THREE.Mesh(beamGeo, frameMat);
      top.scale.set(ROAD_WIDTH + 3.4, 0.7, 0.7);
      top.position.set(0, 13, 0);
      group.add(top);
      const topGlow = new THREE.Mesh(beamGeo, glowMat);
      topGlow.scale.set(ROAD_WIDTH + 2.4, 0.14, 0.14);
      topGlow.position.set(0, 12.62, 0);
      group.add(topGlow);

      const banner = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH + 1, 1.6), bannerMat);
      banner.position.set(0, 11.4, 0);
      group.add(banner);
      this._disposable(banner.geometry);

      group.position.z = z;
      this.root.add(group);
      this.arches.push({ group, z });
    }
  }

  _buildDrones() {
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.crimson });
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture('#ff2f6d'),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._disposable(mat);
    this._disposable(glowMat);
    const geo = new THREE.SphereGeometry(0.28, 8, 6);
    this._disposable(geo);
    const glowGeo = new THREE.PlaneGeometry(3.4, 3.4);
    this._disposable(glowGeo);

    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(geo, mat);
      g.add(body);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      g.add(glow);
      g.position.set(rand(-14, 14), rand(6, 16), rand(SPAWN_Z * 0.7, -30));
      this.root.add(g);
      this.drones.push({
        group: g,
        glow,
        baseY: g.position.y,
        speedX: rand(-2.4, 2.4),
        phase: rand(0, 6.28),
      });
    }
  }

  _buildMist() {
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture('#7b3cff'),
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this._disposable(mat);
    const geo = new THREE.PlaneGeometry(46, 16);
    this._disposable(geo);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.35 + i * 0.12, SPAWN_Z + i * (WORLD_LENGTH / 3));
      this.root.add(m);
      this.mist.push({ mesh: m, z: m.position.z });
    }
  }

  /* ------------------------------------------------------------------ */
  /* update                                                              */
  /* ------------------------------------------------------------------ */
  update(dt, speed, elapsed) {
    // road texture scroll gives the illusion of motion under the feet
    this.roadTex.offset.y -= (speed * dt) / 22;

    // wrap buildings
    for (const b of this.buildings) {
      b.z += speed * dt;
      if (b.z > DESPAWN_Z + b.depth) {
        b.z -= WORLD_LENGTH;
        // re-randomise so the district never repeats visibly
        const h = rand(14, 46);
        b.height = h;
        b.mesh.scale.y = h;
        b.group.position.y = h / 2;
        if (b.edge) b.edge.scale.y = h * 0.94;
        b.group.position.x = b.side * (ROAD_HALF + 5.4 + this.rnd() * 16 + b.width * 0.4);
      }
      b.group.position.z = b.z;
    }

    // wrap signs + gentle neon flicker
    for (const s of this.signs) {
      s.z += speed * dt;
      if (s.z > DESPAWN_Z) s.z -= WORLD_LENGTH;
      s.group.position.z = s.z;
      const flick = 0.9 + Math.sin(elapsed * 3.1 + s.phase) * 0.06 + (Math.sin(elapsed * 11 + s.phase) > 0.96 ? -0.22 : 0);
      s.mesh.material.opacity = clamp(flick, 0.4, 1);
    }

    // arches
    for (const a of this.arches) {
      a.z += speed * dt;
      if (a.z > DESPAWN_Z) a.z -= WORLD_LENGTH;
      a.group.position.z = a.z;
    }

    // lamps
    for (const l of this.lamps) {
      l.z += speed * dt;
      if (l.z > DESPAWN_Z + 4) l.z -= 11 * 24;
      l.group.position.z = l.z;
    }

    // mist
    for (const m of this.mist) {
      m.z += speed * dt;
      if (m.z > DESPAWN_Z) m.z -= WORLD_LENGTH;
      m.mesh.position.z = m.z;
    }

    // drones drift sideways, slowly approaching then wrapping
    for (const d of this.drones) {
      d.group.position.x += d.speedX * dt;
      if (Math.abs(d.group.position.x) > 22) d.speedX *= -1;
      d.group.position.y = d.baseY + Math.sin(elapsed * 0.8 + d.phase) * 1.2;
      d.group.position.z += speed * dt * 0.92;
      if (d.group.position.z > DESPAWN_Z) d.group.position.z -= WORLD_LENGTH;
      d.glow.lookAt(this.scene.position.x, d.group.position.y, 0);
    }

    // sky + lights follow the camera so the horizon never breaks
    this.sky.position.set(0, 0, 0);

    // flicker the street fill light for atmosphere
    this.fill.intensity = 12 + Math.sin(elapsed * 5.3) * 2.2;
  }

  /* ------------------------------------------------------------------ */
  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const d of this._disposables) d?.dispose?.();
    if (this.roadTex) this.roadTex.dispose();
    this.scene.remove(this.hemi, this.key, this.rim, this.fill);
    this.buildings.length = 0;
    this.lamps.length = 0;
    this.signs.length = 0;
    this.arches.length = 0;
    this.drones.length = 0;
    this.mist.length = 0;
  }
}
