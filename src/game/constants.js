/**
 * NIGHTRUN — tuning constants.
 * All gameplay tuning lives here so systems stay modular.
 * World units are treated as metres.
 */

export const LANE_X = [-2.3, 0, 2.3];
export const LANE_COUNT = 3;
export const LANE_SWITCH_RATE = 15; // exponential smoothing toward target lane

export const ROAD_WIDTH = 7.6;
export const ROAD_HALF = ROAD_WIDTH / 2;

/* ------------------------------ speed ------------------------------ */
export const SPEED_START = 15.5;
export const SPEED_MAX = 41;
export const SPEED_ACCEL = 0.28; // m/s gained per second survived
export const SPEED_GRACE = 3; // seconds before the ramp starts

/* ------------------------------ player ----------------------------- */
export const PLAYER_HALF_W = 0.31;
export const PLAYER_DEPTH = 0.62;
export const PLAYER_H = 1.72;
export const SLIDE_H = 0.82;
export const GRAVITY = 54;
export const JUMP_VELOCITY = 16.4;
export const SLIDE_TIME = 0.72;
export const SLIDE_COOLDOWN = 0.16;
export const JUMP_BUFFER = 0.14; // forgiving input buffer
export const COYOTE_TIME = 0.07;

/* ----------------------------- spawning ---------------------------- */
export const SPAWN_Z = -122; // where objects appear (ahead of the player)
export const DESPAWN_Z = 16; // behind the camera -> recycle
export const ROW_PREFILL = 8; // rows already streaming when a run starts
export const MIN_ROW_GAP = 10.5;
export const ROW_GAP_TIME_MIN = 0.9; // seconds of reaction time between rows
export const ROW_GAP_TIME_MAX = 1.35;
export const SHARD_POINTS = 12;
export const DISTANCE_POINTS = 1; // score per metre

/* ---------------------------- collision ---------------------------- */
/** Colliders are slightly forgiving so the game always feels fair. */
export const HITBOX_SHRINK_X = 0.13;
export const HITBOX_SHRINK_Z = 0.1;

/* ------------------------------ pools ------------------------------ */
export const POOL = {
  barrierLow: 8,
  gate: 8,
  block: 8,
  shard: 90,
  sideProp: 26,
  sign: 10,
  arch: 4,
};

/* ----------------------------- quality ----------------------------- */
export const QUALITY = {
  low: {
    label: 'LOW',
    pixelRatio: 1,
    maxPixelRatio: 1.35,
    buildings: 18,
    sideProps: 12,
    fogDensity: 0.018,
    glowSprites: false,
    antialias: false,
    roadSegments: 2,
    anisotropy: 2,
  },
  medium: {
    label: 'MED',
    pixelRatio: 1.35,
    maxPixelRatio: 1.75,
    buildings: 26,
    sideProps: 18,
    fogDensity: 0.0155,
    glowSprites: true,
    antialias: true,
    roadSegments: 3,
    anisotropy: 4,
  },
  high: {
    label: 'HIGH',
    pixelRatio: 2,
    maxPixelRatio: 2.2,
    buildings: 34,
    sideProps: 24,
    fogDensity: 0.0135,
    glowSprites: true,
    antialias: true,
    roadSegments: 3,
    anisotropy: 8,
  },
};

/* ------------------------------ palette ---------------------------- */
export const COLORS = {
  bg: 0x05020a,
  fog: 0x0a0418,
  cyan: 0x45f0ff,
  blue: 0x2f6bff,
  violet: 0xa24bff,
  crimson: 0xff2f6d,
  gold: 0xffcc66,
  asphalt: 0x0b0714,
  concrete: 0x140d24,
  neonWhite: 0xf2eaff,
};
