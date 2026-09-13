/**
 * Saturn system — physical constants, scene scale, and asset paths.
 *
 * World scale: 1 scene unit = 1 EARTH radius (6,371 km) — same convention as
 * `config/sceneScale.ts`, so Earth, Moon, and Saturn all share one scale.
 *
 * All figures are NASA/JPL planetary data (fact sheet values as of 2026):
 *   Saturn equatorial radius      60,268 km  (polar 58,350 km → oblateness)
 *   Axial tilt (obliquity)       26.73°
 *   Equatorial rotation period   10.656 h (cosmetic idle spin used instead)
 *   C-ring inner edge            ~88,211 km from centre
 *   A-ring outer edge            ~135,001 km from centre
 *   Moon radii/orbits/periods    standard values (see `SATURN_MOONS`)
 */
import * as THREE from 'three';
import type { OrbitMode } from '../core/types';

const EARTH_RADIUS_KM = 6371;
const KM_PER_UNIT = EARTH_RADIUS_KM;

/** Saturn equatorial radius, scene units (9.4597). */
export const SATURN_RADIUS = 60268 / KM_PER_UNIT;

/** Polar/equatorial radius ratio (0.96817) — baked into the planet geometry
 *  (non-uniform vertex scale) so normals and shader math stay well-conditioned. */
export const SATURN_OBLATENESS = 58350 / 60268;

/** Axial tilt, radians (26.73°). Tilt axis points toward +X (away from Earth). */
export const SATURN_TILT = (26.73 * Math.PI) / 180;

/**
 * Saturn's fixed world position. ~304 scene units from Earth (the real mean
 * distance is 4×10⁹ km — compressed into the same scene, like the Sun);
 * well beyond the Moon (10–60) and Sun corona (14.1) so it never collides.
 */
export const SATURN_POSITION = new THREE.Vector3(-260, 26, -150);

/** Idle spin (auto-rotate) — a gentle cosmetic rate, not the 10.656 h true
 *  period (imperceptible at these distances anyway). rad/s. */
export const SATURN_SPIN_RATE = 0.0025;

// ---------------------------------------------------------------------
// RINGS — geometry calibrated against the `ring-alpha.png` strip
// ---------------------------------------------------------------------

/** C-ring inner edge, scene units (88,211 km / 6,371 km). */
export const RING_INNER = 88211 / KM_PER_UNIT;   // 13.846 = 1.4637 R_S
/** A-ring outer edge, scene units (135,001 km / 6,371 km). */
export const RING_OUTER = 135001 / KM_PER_UNIT;  // 21.19  = 2.2401 R_S

/**
 * Texture coverage of the 2048px ring strip (measured: first non-transparent
 * column 114, last 2039; Cassini division at px 1357 → 122,107 km, Encke gap
 * at px 2024 → 134,600 km — both within ~1 km of their true radii). The
 * shaders sample at v = 0.5 (the strip is a 1-D radial profile); U maps
 * linearly from RING_INNER → RING_OUTER over this pixel range.
 */
export const RING_TEX_U0 = 114 / 2048;
export const RING_TEX_U1 = 2039 / 2048;

/** Annulus tessellation (constant across quality tiers — a flat 256-gon). */
export const RING_SEGMENTS = 256;

// ---------------------------------------------------------------------
// MOONS
// ---------------------------------------------------------------------

export interface SaturnMoonDef {
  id: string;              // also the `Focus` value
  name: string;
  radiusKm: number;        // mean radius
  orbitKm: number;         // mean orbital radius (equatorial plane)
  periodDays: number;      // sidereal orbital period
  initialAngle: number;    // rad — staggered so the system never looks aligned
}

export const SATURN_MOONS: readonly SaturnMoonDef[] = [
  { id: 'mimas',     name: 'Mimas',     radiusKm: 198.2,  orbitKm: 185539,   periodDays: 0.942,  initialAngle: 0.4 },
  { id: 'enceladus', name: 'Enceladus', radiusKm: 252.1,  orbitKm: 237948,   periodDays: 1.370,  initialAngle: 2.1 },
  { id: 'tethys',    name: 'Tethys',    radiusKm: 531.1,  orbitKm: 294660,   periodDays: 1.888,  initialAngle: 4.2 },
  { id: 'dione',     name: 'Dione',     radiusKm: 561.4,  orbitKm: 377396,   periodDays: 2.737,  initialAngle: 5.5 },
  { id: 'rhea',      name: 'Rhea',      radiusKm: 763.8,  orbitKm: 527108,   periodDays: 4.518,  initialAngle: 1.2 },
  { id: 'titan',     name: 'Titan',     radiusKm: 2574.7, orbitKm: 1221870,  periodDays: 15.945, initialAngle: 3.4 },
  { id: 'iapetus',   name: 'Iapetus',   radiusKm: 734.5,  orbitKm: 3560820,  periodDays: 79.322, initialAngle: 0.9 },
];

/**
 * "Exploration" mode orbits (scene units): compressed so all seven read at
 * once around the planet (the ring outer edge is 21.2). Order and spacing
 * follow the real orbits (Mimas innermost … Iapetus outermost).
 */
export const SATURN_ORBIT_EXPLORE: Record<string, number> = {
  mimas: 24,
  enceladus: 27,
  tethys: 30,
  dione: 33,
  rhea: 38,
  titan: 46,
  iapetus: 55,
};

/**
 * Smallest rendered moon radius in Exploration mode (scene units) — the true
 * radii (0.031–0.12) are sub-pixel from the Saturn view; 0.32 stays clearly
 * smaller than Saturn (9.46) and reads as "small moon". Titan (true 0.404)
 * and Iapetus keep their true sizes.
 */
export const SATURN_MOON_MIN_RADIUS = 0.32;

/** Exploration-mode radius clamp (Titan/Iapetus render at true size). */
export function saturnMoonRadius(def: SaturnMoonDef, scaleMode: 'explore' | 'real'): number {
  const trueR = def.radiusKm / KM_PER_UNIT;
  if (scaleMode === 'real') return trueR;
  return def.id === 'titan' || def.id === 'iapetus'
    ? Math.max(trueR, SATURN_MOON_MIN_RADIUS)
    : SATURN_MOON_MIN_RADIUS;
}

/** Exploration-mode orbit radius (see SATURN_ORBIT_EXPLORE). */
export function saturnMoonOrbit(def: SaturnMoonDef, scaleMode: 'explore' | 'real'): number {
  if (scaleMode === 'real') return def.orbitKm / KM_PER_UNIT;
  return SATURN_ORBIT_EXPLORE[def.id] ?? 40;
}

/** "Visualized" clock: 1 Earth day = 25 s (Mimas orbits in ~24 s, Titan ~6.6 min). */
export const SATURN_DAY_SECONDS = 25;

/** Orbital period in real seconds for the shared clock mode (Infinity = paused). */
export function saturnMoonPeriod(def: SaturnMoonDef, orbitMode: OrbitMode): number {
  if (orbitMode === 'paused') return Infinity;
  if (orbitMode === 'realtime') return def.periodDays * 86400;
  return def.periodDays * SATURN_DAY_SECONDS;
}

// ---------------------------------------------------------------------
// ASSETS (single texture set — identical on every quality tier)
// ---------------------------------------------------------------------

export const SATURN_TEXTURES = {
  body: '/assets/saturn/saturn.jpg',
  rings: '/assets/saturn/ring-alpha.png',
  titan: '/assets/saturn/titan.jpg',
  moon: (id: string) => `/assets/saturn/moons/${id}.jpg`,
} as const;

