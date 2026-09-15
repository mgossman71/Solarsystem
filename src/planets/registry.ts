/**
 * Planet registry — physical constants, scene layout, and asset paths for
 * every explorable planet (Mercury → Pluto) and its focusable moons.
 *
 * World scale: 1 scene unit = 1 EARTH radius (6,371 km) — same convention as
 * `config/sceneScale.ts`, so Earth, Moon, Sun, and every planet share one scale.
 *
 * All figures are NASA/JPL planetary fact-sheet values (as of 2026):
 *   body radii / polar radii (→ oblateness), axial tilts, moon radii,
 *   mean orbital radii, sidereal orbital periods.
 *
 * Scene layout: HELIOCENTRIC — the Sun is the scene centre (origin) and
 * every planet ORBITS it, advanced by the shared OrbitMode clock
 * (`planetOrbitPeriod`, same convention as the moons). Orbital radii are
 * compressed in Exploration mode and expanded in Real Scale — scene-scale
 * throughout (like every other distance here), with the true ORDER
 * Mercury→Pluto preserved around Earth's orbit so disks, moons, and rings
 * never collide at any scale mode. `initialOrbitAngle` is the ecliptic-plane
 * projection of the planet's old apparent direction from Earth, so the t=0
 * sky roughly preserves the legacy composition (orbits: x = R·cos θ,
 * z = −R·sin θ — prograde viewed from the north pole).
 */
import type { Focus, OrbitMode } from '../core/types';

const EARTH_RADIUS_KM = 6371;
/** km per scene unit (shared scale). */
export const KM_PER_UNIT = EARTH_RADIUS_KM;

/** "Visualized" clock: 1 Earth day = 25 s (shared by every planet system). */
export const DAY_SECONDS = 25;

/** Maximum focusable moons per planet (sizes the fixed GLSL uniform arrays). */
export const MAX_MOONS = 7;

// ---------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------

export interface HazeDef {
  /** Atmospheric tint multiplied into the albedo (e.g. Titan's orange). */
  tint: [number, number, number];
  /** Hazy limb-glow color. */
  rim: [number, number, number];
  /** Rendered radius multiplier (atmospheric shell, e.g. 1.04). */
  shell: number;
}

export interface MoonDef {
  id: Focus;                // also the `Focus` value
  name: string;
  radiusKm: number;         // mean radius
  orbitKm: number;          // mean orbital radius (equatorial plane)
  periodDays: number;       // sidereal orbital period
  initialAngle: number;     // rad — staggered so the system never looks aligned
  retrograde?: boolean;     // e.g. Triton
  exploreOrbit: number;     // scene units — compressed orbit in Exploration mode
  keepTrueSize?: boolean;   // explore mode renders at true radius (big moons)
  haze?: HazeDef;           // atmospheric-shell moon (Titan)
}

export interface RingDef {
  inner: number;            // scene units
  outer: number;            // scene units
  texU0: number;            // first non-transparent strip column / width
  texU1: number;            // last non-transparent strip column / width
  texture: string;          // radial alpha strip (1-D profile, V = 0.5)
}

export interface PlanetDef {
  id: Focus;
  name: string;
  radiusKm: number;         // equatorial radius
  oblateness: number;       // polar/equatorial ratio (1 = sphere)
  tiltDeg: number;          // axial tilt (obliquity)
  /** Sidereal orbital period around the Sun (days). */
  orbitPeriodDays: number;
  /** Orbit radius about the Sun (scene units) — Exploration mode. */
  exploreOrbit: number;
  /** Orbit radius about the Sun (scene units) — Real Scale mode. */
  realOrbit: number;
  /** Orbit inclination to the ecliptic, degrees (J2000 value; 0 = in-plane). */
  orbitInclinationDeg?: number;
  /** Longitude of ascending node, degrees (orients the tilt about up). */
  orbitNodeDeg?: number;
  /** rad — starting orbit angle (preserves the legacy composition). */
  initialOrbitAngle: number;
  /** Cosmetic idle spin, rad/s (signed — negative = retrograde spin, Venus). */
  spinRate: number;
  /** Night-side fill (hazy giants ~0.04, bare rock ~0.02). */
  fill: number;
  /** Limb darkening strength (gas giants compress bands at the limb). */
  limb: number;
  /** Placeholder albedo shown until the texture loads (RGB 0–255). */
  placeholder: [number, number, number];
  /** Small-moon floor in Exploration mode (scene units). */
  moonMinRadius: number;
  ring?: RingDef;
  moons: readonly MoonDef[];
  /** Saturn loads its textures at startup (legacy behavior); others on focus. */
  eager?: boolean;
}

// ---------------------------------------------------------------------
// PLANETS (in orbit order; Saturn data carried over from src/saturn/config)
// ---------------------------------------------------------------------

export const PLANETS: readonly PlanetDef[] = [
  {
    id: 'mercury', name: 'Mercury',
    radiusKm: 2439.7, oblateness: 1.0, tiltDeg: 0.03,
    orbitPeriodDays: 87.969, exploreOrbit: 40, realOrbit: 60, initialOrbitAngle: 0.3805,
    spinRate: 0.002, fill: 0.02, limb: 0.05,
    placeholder: [128, 120, 113],
    moonMinRadius: 0.12,
    orbitInclinationDeg: 7.005, orbitNodeDeg: 48.331,
    moons: [],
  },
  {
    id: 'venus', name: 'Venus',
    radiusKm: 6051.8, oblateness: 1.0, tiltDeg: 2.64,
    orbitPeriodDays: 224.701, exploreOrbit: 90, realOrbit: 120, initialOrbitAngle: 1.249,
    spinRate: -0.001, fill: 0.04, limb: 0.08,
    placeholder: [216, 190, 150],
    moonMinRadius: 0.12,
    orbitInclinationDeg: 3.395, orbitNodeDeg: 76.680,
    moons: [],
  },
  {
    id: 'mars', name: 'Mars',
    radiusKm: 3389.5, oblateness: 0.997, tiltDeg: 25.19,
    orbitPeriodDays: 686.980, exploreOrbit: 800, realOrbit: 900, initialOrbitAngle: -2.2794,
    spinRate: 0.0025, fill: 0.02, limb: 0.05,
    placeholder: [181, 98, 64],
    moonMinRadius: 0.12,
    orbitInclinationDeg: 1.850, orbitNodeDeg: 49.559,
    moons: [
      { id: 'phobos', name: 'Phobos', radiusKm: 11.265, orbitKm: 9376,   periodDays: 0.3189, initialAngle: 0.4, exploreOrbit: 1.6 },
      { id: 'deimos', name: 'Deimos', radiusKm: 6.2,    orbitKm: 23463,  periodDays: 1.2624, initialAngle: 3.1, exploreOrbit: 2.4 },
    ],
  },
  {
    id: 'jupiter', name: 'Jupiter',
    radiusKm: 69911, oblateness: 66856 / 69911, tiltDeg: 3.13,
    orbitPeriodDays: 4332.59, exploreOrbit: 1050, realOrbit: 1250, initialOrbitAngle: 0.245,
    spinRate: 0.006, fill: 0.04, limb: 0.10,
    placeholder: [196, 162, 128],
    moonMinRadius: 0.35,
    orbitInclinationDeg: 1.303, orbitNodeDeg: 100.464,
    moons: [
      { id: 'io',       name: 'Io',       radiusKm: 1821.6, orbitKm: 421800,  periodDays: 1.7691, initialAngle: 0.9, exploreOrbit: 14 },
      { id: 'europa',   name: 'Europa',   radiusKm: 1560.8, orbitKm: 671100,  periodDays: 3.5512, initialAngle: 2.7, exploreOrbit: 17 },
      { id: 'ganymede', name: 'Ganymede', radiusKm: 2634.1, orbitKm: 1070412, periodDays: 7.1546, initialAngle: 4.4, exploreOrbit: 21, keepTrueSize: true },
      { id: 'callisto', name: 'Callisto', radiusKm: 2410.3, orbitKm: 1882709, periodDays: 16.689, initialAngle: 5.6, exploreOrbit: 26, keepTrueSize: true },
    ],
  },
  {
    id: 'saturn', name: 'Saturn',
    radiusKm: 60268, oblateness: 58350 / 60268, tiltDeg: 26.73,
    orbitPeriodDays: 10759.22, exploreOrbit: 1300, realOrbit: 1600, initialOrbitAngle: 2.6181,
    spinRate: 0.0025, fill: 0.04, limb: 0.10,
    placeholder: [206, 188, 152],
    moonMinRadius: 0.32,
    orbitInclinationDeg: 2.485, orbitNodeDeg: 113.665,
    ring: {
      inner: 88211 / KM_PER_UNIT,     // C-ring inner edge
      outer: 135001 / KM_PER_UNIT,    // A-ring outer edge
      texU0: 114 / 2048, texU1: 2039 / 2048,
      texture: '/assets/saturn/ring-alpha.png',
    },
    moons: [
      { id: 'mimas',     name: 'Mimas',     radiusKm: 198.2,  orbitKm: 185539,  periodDays: 0.942,  initialAngle: 0.4, exploreOrbit: 24 },
      { id: 'enceladus', name: 'Enceladus', radiusKm: 252.1,  orbitKm: 237948,  periodDays: 1.370,  initialAngle: 2.1, exploreOrbit: 27 },
      { id: 'tethys',    name: 'Tethys',    radiusKm: 531.1,  orbitKm: 294660,  periodDays: 1.888,  initialAngle: 4.2, exploreOrbit: 30 },
      { id: 'dione',     name: 'Dione',     radiusKm: 561.4,  orbitKm: 377396,  periodDays: 2.737,  initialAngle: 5.5, exploreOrbit: 33 },
      { id: 'rhea',      name: 'Rhea',      radiusKm: 763.8,  orbitKm: 527108,  periodDays: 4.518,  initialAngle: 1.2, exploreOrbit: 38 },
      { id: 'titan',     name: 'Titan',     radiusKm: 2574.7, orbitKm: 1221870, periodDays: 15.945, initialAngle: 3.4, exploreOrbit: 46, keepTrueSize: true,
        haze: { tint: [1.0, 0.62, 0.40], rim: [1.0, 0.72, 0.45], shell: 1.04 } },
      { id: 'iapetus',   name: 'Iapetus',   radiusKm: 734.5,  orbitKm: 3560820, periodDays: 79.322, initialAngle: 0.9, exploreOrbit: 55, keepTrueSize: true },
    ],
    eager: true,
  },
  {
    id: 'uranus', name: 'Uranus',
    radiusKm: 25362, oblateness: 24973 / 25559, tiltDeg: 97.77,
    orbitPeriodDays: 30688.5, exploreOrbit: 1600, realOrbit: 2400, initialOrbitAngle: -1.4056,
    spinRate: 0.002, fill: 0.04, limb: 0.08,
    placeholder: [150, 199, 213],
    moonMinRadius: 0.18,
    orbitInclinationDeg: 0.773, orbitNodeDeg: 74.006,
    moons: [
      { id: 'miranda',  name: 'Miranda',  radiusKm: 235.8, orbitKm: 129390, periodDays: 1.413,  initialAngle: 1.1, exploreOrbit: 5.5 },
      { id: 'ariel',    name: 'Ariel',    radiusKm: 578.9, orbitKm: 190900, periodDays: 2.520,  initialAngle: 2.9, exploreOrbit: 6.5 },
      { id: 'umbriel',  name: 'Umbriel',  radiusKm: 584.7, orbitKm: 266000, periodDays: 4.140,  initialAngle: 4.0, exploreOrbit: 7.5 },
      { id: 'titania',  name: 'Titania',  radiusKm: 788.5, orbitKm: 435900, periodDays: 8.706,  initialAngle: 5.2, exploreOrbit: 9.0, keepTrueSize: true },
      { id: 'oberon',   name: 'Oberon',   radiusKm: 761.4, orbitKm: 583500, periodDays: 13.460, initialAngle: 0.6, exploreOrbit: 10.5, keepTrueSize: true },
    ],
  },
  {
    id: 'neptune', name: 'Neptune',
    radiusKm: 24622, oblateness: 24341 / 24622, tiltDeg: 28.32,
    orbitPeriodDays: 60182, exploreOrbit: 1950, realOrbit: 2750, initialOrbitAngle: -1.9513,
    spinRate: 0.002, fill: 0.04, limb: 0.08,
    placeholder: [76, 107, 194],
    moonMinRadius: 0.2,
    orbitInclinationDeg: 1.770, orbitNodeDeg: 131.784,
    moons: [
      // Triton: the only large moon on a RETROGRADE orbit.
      { id: 'triton', name: 'Triton', radiusKm: 1353.4, orbitKm: 354800, periodDays: 5.877, initialAngle: 2.2, retrograde: true, exploreOrbit: 5.5, keepTrueSize: true },
    ],
  },
  {
    id: 'pluto', name: 'Pluto',
    radiusKm: 1188.3, oblateness: 1.0, tiltDeg: 122.5,
    orbitPeriodDays: 90560, exploreOrbit: 2300, realOrbit: 3100, initialOrbitAngle: -0.5404,
    spinRate: 0.0012, fill: 0.02, limb: 0.05,
    placeholder: [189, 162, 138],
    moonMinRadius: 0.1,
    orbitInclinationDeg: 17.16, orbitNodeDeg: 110.303,
    moons: [
      // Charon is nearly half Pluto's diameter — the "binary" look is real,
      // so both keep their true sizes in Exploration mode.
      { id: 'charon', name: 'Charon', radiusKm: 606, orbitKm: 19591, periodDays: 6.387, initialAngle: 0.8, exploreOrbit: 0.55, keepTrueSize: true },
    ],
  },
];


// ---------------------------------------------------------------------
// LOOKUPS
// ---------------------------------------------------------------------

export const PLANET_BY_ID: Readonly<Record<string, PlanetDef>> = Object.fromEntries(
  PLANETS.map((p) => [p.id, p]),
);

/** moon focus id → owning planet id (all focusable moons). */
export const MOON_OWNER: Readonly<Record<string, Focus>> = Object.fromEntries(
  PLANETS.flatMap((p) => p.moons.map((m) => [m.id, p.id])),
) as Record<string, Focus>;

/** Every planet focus id, in orbit order (Pluto last). */
export const PLANET_FOCUS_IDS: readonly Focus[] = PLANETS.map((p) => p.id);

/** Every moon focus id. */
export const MOON_FOCUS_IDS: readonly Focus[] = PLANETS.flatMap((p) => p.moons.map((m) => m.id));

/** Scene radius of a planet body. */
export function planetRadius(def: PlanetDef): number {
  return def.radiusKm / KM_PER_UNIT;
}

/** Radius used to frame a planet (ring outer edge when it has rings). */
export function planetFrameRadius(def: PlanetDef): number {
  return def.ring ? def.ring.outer : planetRadius(def) * 1.6;
}

// ---------------------------------------------------------------------
// MOON SCALE / CLOCK (same convention as the old Saturn config:
// real values in 'real' mode, compressed in 'explore')
// ---------------------------------------------------------------------

/** Rendered moon radius in the given scale mode. */
export function planetMoonRadius(def: MoonDef, planet: PlanetDef, scaleMode: 'explore' | 'real'): number {
  const trueR = def.radiusKm / KM_PER_UNIT;
  if (scaleMode === 'real') return trueR;
  return def.keepTrueSize ? Math.max(trueR, planet.moonMinRadius) : planet.moonMinRadius;
}

/** Rendered radius incl. any atmospheric shell (e.g. Titan +4%). */
export function planetMoonRenderRadius(def: MoonDef, planet: PlanetDef, scaleMode: 'explore' | 'real' = 'explore'): number {
  return planetMoonRadius(def, planet, scaleMode) * (def.haze?.shell ?? 1);
}

/** Orbit radius in the given scale mode. */
export function planetMoonOrbit(def: MoonDef, scaleMode: 'explore' | 'real'): number {
  return scaleMode === 'real' ? def.orbitKm / KM_PER_UNIT : def.exploreOrbit;
}

/** Orbital period in real seconds (Infinity = paused). */
export function moonPeriod(def: MoonDef, orbitMode: OrbitMode): number {
  if (orbitMode === 'paused') return Infinity;
  if (orbitMode === 'realtime') return def.periodDays * 86400;
  return def.periodDays * DAY_SECONDS;
}

/** Orbit radius about the Sun (scene units) in the given scale mode. */
export function planetOrbitRadius(def: PlanetDef, scaleMode: 'explore' | 'real'): number {
  return scaleMode === 'real' ? def.realOrbit : def.exploreOrbit;
}

/** Sidereal orbital period about the Sun in real seconds (Infinity = paused). */
export function planetOrbitPeriod(def: PlanetDef, orbitMode: OrbitMode): number {
  if (orbitMode === 'paused') return Infinity;
  if (orbitMode === 'realtime') return def.orbitPeriodDays * 86400;
  return def.orbitPeriodDays * DAY_SECONDS;
}

/** Spin direction — Triton's retrograde orbit is the one exception. */
export function moonSpinSign(def: MoonDef): 1 | -1 {
  return def.retrograde ? -1 : 1;
}

// ---------------------------------------------------------------------
// ASSETS (single texture set — identical on every quality tier)
// ---------------------------------------------------------------------

export function planetBodyTexture(planetId: string): string {
  return `/assets/${planetId}/${planetId}.jpg`;
}

/** Moon texture path — Titan's map lives one level up (legacy layout). */
export function planetMoonTexture(planetId: string, moonId: string): string {
  if (planetId === 'saturn' && moonId === 'titan') return '/assets/saturn/titan.jpg';
  return `/assets/${planetId}/moons/${moonId}.jpg`;
}


