// ============================================================
// ASTRONOMY — CELESTIAL CATALOG (single source of truth for body data)
// ============================================================
// The full hierarchical body tree the app renders and navigates. Everything
// here is data (no Three.js) so it is unit-testable and can drive UI, ephemeris
// and scale models without importing a renderer.
//
//   Sun ─┬─ Mercury
//        ├─ Venus
//        ├─ Earth ─ Moon
//        ├─ Mars ─ Phobos, Deimos
//        ├─ Jupiter ─ Io, Europa, Ganymede, Callisto
//        ├─ Saturn ─ Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Iapetus
//        ├─ Uranus ─ Miranda, Ariel, Umbriel, Titania, Oberon
//        ├─ Neptune ─ Triton
//        └─ Pluto ─ Charon, Styx, Nix, Kerberos, Hydra
//
// Planet orbital elements: JPL "Keplerian Elements for Approximate Positions of
// the Major Planets" (J2000.0 mean elements + secular rates per century).
// Radii / obliquities / rotation periods: NASA planetary fact-sheet values.
// Moons: NASA/JPL mean orbital elements (semi-major axis, inclination, period).
// ============================================================

import type { CelestialBody } from './types';

// ---- JPL J2000 mean elements (value + rate-per-century) --------------------
const jpl = {
  mercury: { a: 0.38709927, e: 0.20563593, i: 7.00497902, L: 252.2503235, varpi: 77.45779628, Omega: 48.33076593,
             aDot: 0.00000037, eDot: 0.00001906, iDot: -0.00594749, LDot: 149472.67411175, varpiDot: 0.16047689, OmegaDot: -0.12534081 },
  venus:   { a: 0.72333566, e: 0.00677672, i: 3.39467605, L: 181.9790995, varpi: 131.60246718, Omega: 76.67984255,
             aDot: 0.0000039, eDot: -0.00004107, iDot: -0.0129426, LDot: 58517.81538729, varpiDot: 0.00268329, OmegaDot: -0.27769418 },
  earth:   { a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166, varpi: 102.93768193, Omega: 0.0,
             aDot: 0.00000562, eDot: -0.00004392, iDot: -0.01294668, LDot: 35999.37244981, varpiDot: 0.32327364, OmegaDot: 0.0 },
  mars:    { a: 1.52371034, e: 0.0933941, i: 1.84969142, L: -4.55343205, varpi: -23.94362959, Omega: 49.55953891,
             aDot: 0.00001847, eDot: 0.00007882, iDot: -0.00813131, LDot: 19140.30268499, varpiDot: 0.44441088, OmegaDot: -0.29257343 },
  jupiter: { a: 5.202887, e: 0.04838624, i: 1.30439695, L: 34.39644051, varpi: 14.72847983, Omega: 100.47390909,
             aDot: -0.00011657, eDot: -0.00013253, iDot: -0.00183714, LDot: 3034.74612775, varpiDot: 0.21252668, OmegaDot: 0.20469106 },
  saturn:  { a: 9.53667594, e: 0.5386179e-1, i: 2.48599187, L: 49.95424423, varpi: 92.59887831, Omega: 113.66242448,
             aDot: -0.0012506, eDot: -0.00050991, iDot: 0.0053559, LDot: 1554.5245304, varpiDot: -0.41897216, OmegaDot: -0.28867794 },
  uranus:  { a: 19.18916464, e: 0.04725744, i: 0.77263783, L: 313.23810451, varpi: 170.9542763, Omega: 74.01692503,
             aDot: -0.00196176, eDot: -0.00004397, iDot: 0.00297532, LDot: 720.72925148, varpiDot: 0.40805271, OmegaDot: 0.04237578 },
  neptune: { a: 30.06992276, e: 0.00859048, i: 1.77004347, L: -55.12002969, varpi: 44.96476227, Omega: 131.78422574,
             aDot: 0.00026291, eDot: 0.00005105, iDot: 0.00035372, LDot: 468.04416643, varpiDot: -0.27522573, OmegaDot: -0.00508664 },
  pluto:   { a: 39.48168677, e: 0.2488273, i: 17.14001206, L: 238.92903733, varpi: 224.06846148, Omega: 110.30350583,
             aDot: -0.00031596, eDot: 0.00006282, iDot: 0.00005801, LDot: 153.2381443, varpiDot: -0.04392276, OmegaDot: -0.01159841 },
} as const;

export const CATALOG: readonly CelestialBody[] = [
  {
    id: 'sun', name: 'Sun', kind: 'star', parent: null, radiusKm: 695700,
    rotation: { obliquityDeg: 7.25, periodHours: 609.12, direction: 'prograde' },
    elements: null, moon: null, epochDays: 0,
    notes: 'G2V star; the single authoritative light source and origin of the scene.',
  },
  {
    id: 'mercury', name: 'Mercury', kind: 'terrestrial', parent: 'sun', radiusKm: 2439.7,
    rotation: { obliquityDeg: 0.034, periodHours: 1407.6, direction: 'prograde' },
    elements: { ...jpl.mercury }, moon: null, epochDays: 0,
    textures: { body: '/assets/mercury/mercury.jpg' },
    notes: 'Cratered, airless; no moons; fast inner orbit (period 88 d).',
  },
  {
    id: 'venus', name: 'Venus', kind: 'terrestrial', parent: 'sun', radiusKm: 6051.8,
    rotation: { obliquityDeg: 177.36, periodHours: -5832.5, direction: 'retrograde' },
    elements: { ...jpl.venus }, moon: null, epochDays: 0,
    textures: { body: '/assets/venus/venus.jpg', surface: '/assets/venus/venus-surface.jpg' },
    notes: 'Thick CO2 atmosphere, pale yellow-white clouds; retrograde rotation; no moons. Two real map layers: cloud deck + radar surface.',
  },
  {
    id: 'earth', name: 'Earth', kind: 'terrestrial', parent: 'sun', radiusKm: 6371,
    rotation: { obliquityDeg: 23.44, periodHours: 23.934, direction: 'prograde' },
    elements: { ...jpl.earth }, moon: null, epochDays: 0,
    textures: { body: '/assets/earth/earth-day-albedo.jpg', night: '/assets/earth/earth-night.jpg', clouds: '/assets/earth/earth-clouds.png' },
    notes: 'The detailed cinematic Earth (existing experience). One natural satellite.',
  },
  {
    id: 'mars', name: 'Mars', kind: 'terrestrial', parent: 'sun', radiusKm: 3389.5,
    rotation: { obliquityDeg: 25.19, periodHours: 24.623, direction: 'prograde' },
    elements: { ...jpl.mars }, moon: null, epochDays: 0,
    textures: { body: '/assets/mars/mars.jpg' },
    notes: 'Iron-oxide surface, thin CO2 atmosphere, polar caps; two small irregular moons.',
  },
  {
    id: 'jupiter', name: 'Jupiter', kind: 'gas', parent: 'sun',
    radiusKm: 69911, equatorialRadiusKm: 71492, polarRadiusKm: 66854,
    rotation: { obliquityDeg: 3.13, periodHours: 9.925, direction: 'prograde' },
    elements: { ...jpl.jupiter }, moon: null, epochDays: 0, hasRings: true,
    textures: { body: '/assets/jupiter/jupiter.jpg' },
    notes: 'Oblate gas giant; banded atmosphere; faint ring system; four Galilean moons.',
  },
  {
    id: 'saturn', name: 'Saturn', kind: 'gas', parent: 'sun',
    radiusKm: 60268, equatorialRadiusKm: 60268, polarRadiusKm: 54364,
    rotation: { obliquityDeg: 26.73, periodHours: 10.656, direction: 'prograde' },
    elements: { ...jpl.saturn }, moon: null, epochDays: 0, hasRings: true,
    textures: { body: '/assets/saturn/saturn.jpg', ring: '/assets/saturn/ring-alpha.png' },
    notes: 'Prominent A/B/C ring system with Cassini division; seven major moons (existing system).',
  },
  {
    id: 'uranus', name: 'Uranus', kind: 'ice', parent: 'sun',
    radiusKm: 25559, equatorialRadiusKm: 25559, polarRadiusKm: 24973,
    rotation: { obliquityDeg: 97.77, periodHours: -17.24, direction: 'retrograde' },
    elements: { ...jpl.uranus }, moon: null, epochDays: 0, hasRings: true,
    textures: { body: '/assets/uranus/uranus.jpg' },
    notes: 'Extreme axial tilt (~98°) — rolls on its side; thin ring system (procedural); five major moons.',
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'ice', parent: 'sun',
    radiusKm: 24764, equatorialRadiusKm: 24764, polarRadiusKm: 24341,
    rotation: { obliquityDeg: 28.32, periodHours: 16.11, direction: 'prograde' },
    elements: { ...jpl.neptune }, moon: null, epochDays: 0, hasRings: true,
    textures: { body: '/assets/neptune/neptune.jpg' },
    notes: 'Deep-blue methane ice giant; faint ring arcs (procedural); large retrograde moon Triton.',
  },
  {
    id: 'pluto', name: 'Pluto', kind: 'dwarf', parent: 'sun', isDwarf: true, radiusKm: 1188.3,
    rotation: { obliquityDeg: 120.0, periodHours: -153.29, direction: 'retrograde' },
    elements: { ...jpl.pluto }, moon: null, epochDays: 0,
    textures: { body: '/assets/pluto/pluto.jpg' },
    notes: 'Dwarf planet; highly eccentric + inclined orbit; large binary partner Charon; four small moons.',
  },
  { id: 'moon', name: 'Moon', kind: 'terrestrial', parent: 'earth', radiusKm: 1737.4,
    rotation: { obliquityDeg: 6.68, periodHours: 655.7, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/moon/moon-day-2k.jpg' },
    moon: { semiMajorAxisKm: 384400, inclinationDeg: 5.145, nodeDeg: 125.08, periodDays: 27.322, meanLongitudeDeg: -60, tidallyLocked: true, retrograde: false, radiusKm: 1737.4 },
  },
  { id: 'phobos', name: 'Phobos', kind: 'terrestrial', parent: 'mars', radiusKm: 11.26,
    rotation: { obliquityDeg: 0, periodHours: 7.66, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/mars/moons/phobos.jpg' },
    moon: { semiMajorAxisKm: 9376, inclinationDeg: 1.08, nodeDeg: 318, periodDays: 0.3189, meanLongitudeDeg: 30, tidallyLocked: true, retrograde: false, radiusKm: 11.26 },
  },
  { id: 'deimos', name: 'Deimos', kind: 'terrestrial', parent: 'mars', radiusKm: 6.2,
    rotation: { obliquityDeg: 0, periodHours: 30.3, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/mars/moons/deimos.jpg' },
    moon: { semiMajorAxisKm: 23459, inclinationDeg: 1.79, nodeDeg: 306, periodDays: 1.2624, meanLongitudeDeg: 150, tidallyLocked: true, retrograde: false, radiusKm: 6.2 },
  },
  { id: 'io', name: 'Io', kind: 'terrestrial', parent: 'jupiter', radiusKm: 1821.6,
    rotation: { obliquityDeg: 0, periodHours: 42.5, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/jupiter/moons/io.jpg' },
    moon: { semiMajorAxisKm: 421700, inclinationDeg: 0.04, nodeDeg: 15, periodDays: 1.769, meanLongitudeDeg: 20, tidallyLocked: true, retrograde: false, radiusKm: 1821.6 },
  },
  { id: 'europa', name: 'Europa', kind: 'terrestrial', parent: 'jupiter', radiusKm: 1560.8,
    rotation: { obliquityDeg: 0, periodHours: 85.2, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/jupiter/moons/europa.jpg' },
    moon: { semiMajorAxisKm: 671034, inclinationDeg: 0.47, nodeDeg: 313, periodDays: 3.551, meanLongitudeDeg: 140, tidallyLocked: true, retrograde: false, radiusKm: 1560.8 },
  },
  { id: 'ganymede', name: 'Ganymede', kind: 'terrestrial', parent: 'jupiter', radiusKm: 2634.1,
    rotation: { obliquityDeg: 0, periodHours: 171.7, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/jupiter/moons/ganymede.jpg' },
    moon: { semiMajorAxisKm: 1070412, inclinationDeg: 0.2, nodeDeg: 246, periodDays: 7.155, meanLongitudeDeg: 260, tidallyLocked: true, retrograde: false, radiusKm: 2634.1 },
  },
  { id: 'callisto', name: 'Callisto', kind: 'terrestrial', parent: 'jupiter', radiusKm: 2410.3,
    rotation: { obliquityDeg: 0, periodHours: 400.6, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/jupiter/moons/callisto.jpg' },
    moon: { semiMajorAxisKm: 1882709, inclinationDeg: 0.79, nodeDeg: 96, periodDays: 16.689, meanLongitudeDeg: 200, tidallyLocked: true, retrograde: false, radiusKm: 2410.3 },
  },
  { id: 'mimas', name: 'Mimas', kind: 'terrestrial', parent: 'saturn', radiusKm: 198.2,
    rotation: { obliquityDeg: 0, periodHours: 22.6, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/saturn/moons/mimas.jpg' },
    moon: { semiMajorAxisKm: 185539, inclinationDeg: 0.01, nodeDeg: 170, periodDays: 0.942, meanLongitudeDeg: 23, tidallyLocked: true, retrograde: false, radiusKm: 198.2 },
  },
  { id: 'enceladus', name: 'Enceladus', kind: 'terrestrial', parent: 'saturn', radiusKm: 252.1,
    rotation: { obliquityDeg: 0, periodHours: 32.9, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/saturn/moons/enceladus.jpg' },
    moon: { semiMajorAxisKm: 237948, inclinationDeg: 0.01, nodeDeg: 270, periodDays: 1.37, meanLongitudeDeg: 120, tidallyLocked: true, retrograde: false, radiusKm: 252.1 },
  },
  { id: 'tethys', name: 'Tethys', kind: 'terrestrial', parent: 'saturn', radiusKm: 531.1,
    rotation: { obliquityDeg: 0, periodHours: 45.3, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/saturn/moons/tethys.jpg' },
    moon: { semiMajorAxisKm: 294660, inclinationDeg: 1.1, nodeDeg: 98, periodDays: 1.888, meanLongitudeDeg: 240, tidallyLocked: true, retrograde: false, radiusKm: 531.1 },
  },
  { id: 'dione', name: 'Dione', kind: 'terrestrial', parent: 'saturn', radiusKm: 561.4,
    rotation: { obliquityDeg: 0, periodHours: 65.7, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/saturn/moons/dione.jpg' },
    moon: { semiMajorAxisKm: 377396, inclinationDeg: 0.02, nodeDeg: 142, periodDays: 2.737, meanLongitudeDeg: 315, tidallyLocked: true, retrograde: false, radiusKm: 561.4 },
  },
  { id: 'rhea', name: 'Rhea', kind: 'terrestrial', parent: 'saturn', radiusKm: 763.8,
    rotation: { obliquityDeg: 0, periodHours: 108.4, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/saturn/moons/rhea.jpg' },
    moon: { semiMajorAxisKm: 527108, inclinationDeg: 0.35, nodeDeg: 333, periodDays: 4.518, meanLongitudeDeg: 70, tidallyLocked: true, retrograde: false, radiusKm: 763.8 },
  },
  { id: 'titan', name: 'Titan', kind: 'terrestrial', parent: 'saturn', radiusKm: 2574.7,
    rotation: { obliquityDeg: 0, periodHours: 382.7, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/saturn/titan.jpg' },
    moon: { semiMajorAxisKm: 1221870, inclinationDeg: 0.35, nodeDeg: 123, periodDays: 15.945, meanLongitudeDeg: 195, tidallyLocked: true, retrograde: false, radiusKm: 2574.7 },
  },
  { id: 'iapetus', name: 'Iapetus', kind: 'terrestrial', parent: 'saturn', radiusKm: 734.5,
    rotation: { obliquityDeg: 0, periodHours: 1904, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/saturn/moons/iapetus.jpg' },
    moon: { semiMajorAxisKm: 3560820, inclinationDeg: 15.76, nodeDeg: 66, periodDays: 79.322, meanLongitudeDeg: 51, tidallyLocked: true, retrograde: false, radiusKm: 734.5 },
  },
  { id: 'miranda', name: 'Miranda', kind: 'terrestrial', parent: 'uranus', radiusKm: 235.8,
    rotation: { obliquityDeg: 0, periodHours: 33.9, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/uranus/moons/miranda.jpg' },
    moon: { semiMajorAxisKm: 129390, inclinationDeg: 4.21, nodeDeg: 165, periodDays: 1.413, meanLongitudeDeg: 40, tidallyLocked: true, retrograde: false, radiusKm: 235.8 },
  },
  { id: 'ariel', name: 'Ariel', kind: 'terrestrial', parent: 'uranus', radiusKm: 578.9,
    rotation: { obliquityDeg: 0, periodHours: 60.5, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/uranus/moons/ariel.jpg' },
    moon: { semiMajorAxisKm: 190900, inclinationDeg: 0.26, nodeDeg: 172, periodDays: 2.52, meanLongitudeDeg: 160, tidallyLocked: true, retrograde: false, radiusKm: 578.9 },
  },
  { id: 'umbriel', name: 'Umbriel', kind: 'terrestrial', parent: 'uranus', radiusKm: 584.7,
    rotation: { obliquityDeg: 0, periodHours: 99.5, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/uranus/moons/umbriel.jpg' },
    moon: { semiMajorAxisKm: 266300, inclinationDeg: 0.12, nodeDeg: 30, periodDays: 4.144, meanLongitudeDeg: 280, tidallyLocked: true, retrograde: false, radiusKm: 584.7 },
  },
  { id: 'titania', name: 'Titania', kind: 'terrestrial', parent: 'uranus', radiusKm: 788.4,
    rotation: { obliquityDeg: 0, periodHours: 208.9, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/uranus/moons/titania.jpg' },
    moon: { semiMajorAxisKm: 435900, inclinationDeg: 0.34, nodeDeg: 79, periodDays: 8.706, meanLongitudeDeg: 100, tidallyLocked: true, retrograde: false, radiusKm: 788.4 },
  },
  { id: 'oberon', name: 'Oberon', kind: 'terrestrial', parent: 'uranus', radiusKm: 761.4,
    rotation: { obliquityDeg: 0, periodHours: 323.4, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/uranus/moons/oberon.jpg' },
    moon: { semiMajorAxisKm: 583500, inclinationDeg: 0.07, nodeDeg: 173, periodDays: 13.459, meanLongitudeDeg: 220, tidallyLocked: true, retrograde: false, radiusKm: 761.4 },
  },
  { id: 'triton', name: 'Triton', kind: 'terrestrial', parent: 'neptune', radiusKm: 1353.4,
    rotation: { obliquityDeg: 0, periodHours: 141.0, direction: 'retrograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/neptune/moons/triton.jpg' },
    moon: { semiMajorAxisKm: 354759, inclinationDeg: 156.8, nodeDeg: 30, periodDays: 5.877, meanLongitudeDeg: 90, tidallyLocked: true, retrograde: true, radiusKm: 1353.4 },
    notes: 'Largest Neptune moon; captured Kuiper-belt object on a retrograde orbit.',
  },
  { id: 'charon', name: 'Charon', kind: 'terrestrial', parent: 'pluto', radiusKm: 606,
    rotation: { obliquityDeg: 0, periodHours: 153.3, direction: 'prograde' },
    elements: null, epochDays: 0, textures: { body: '/assets/pluto/moons/charon.jpg' },
    moon: { semiMajorAxisKm: 19596, inclinationDeg: 0.0, nodeDeg: 0, periodDays: 6.387, meanLongitudeDeg: 0, tidallyLocked: true, retrograde: false, radiusKm: 606, barycenterKm: 19102 },
    notes: 'Binary partner; Pluto–Charon orbit their shared barycenter (see Ephemeris).',
  },
  { id: 'styx', name: 'Styx', kind: 'terrestrial', parent: 'pluto', radiusKm: 5.5,
    rotation: { obliquityDeg: 0, periodHours: 483.8, direction: 'prograde' },
    elements: null, epochDays: 0,
    // No authoritative equirectangular map exists for these sub-10 km moonlets
    // (in New Horizons imagery they are 2–5 pixel smudges) → honest flat albedo.
    notes: 'Irregular moonlet; rendered flat (no real texture available).',
    moon: { semiMajorAxisKm: 42102, inclinationDeg: 8.0, nodeDeg: 15, periodDays: 20.16, meanLongitudeDeg: 60, tidallyLocked: true, retrograde: false, radiusKm: 5.5 },
  },
  { id: 'nix', name: 'Nix', kind: 'terrestrial', parent: 'pluto', radiusKm: 10,
    rotation: { obliquityDeg: 0, periodHours: 596.4, direction: 'prograde' },
    elements: null, epochDays: 0,
    moon: { semiMajorAxisKm: 48694, inclinationDeg: 31.5, nodeDeg: 160, periodDays: 24.85, meanLongitudeDeg: 180, tidallyLocked: true, retrograde: false, radiusKm: 10 },
  },
  { id: 'kerberos', name: 'Kerberos', kind: 'terrestrial', parent: 'pluto', radiusKm: 8.5,
    rotation: { obliquityDeg: 0, periodHours: 775.9, direction: 'prograde' },
    elements: null, epochDays: 0,
    moon: { semiMajorAxisKm: 57783, inclinationDeg: 26.2, nodeDeg: 175, periodDays: 32.33, meanLongitudeDeg: 300, tidallyLocked: true, retrograde: false, radiusKm: 8.5 },
  },
  { id: 'hydra', name: 'Hydra', kind: 'terrestrial', parent: 'pluto', radiusKm: 8.5,
    rotation: { obliquityDeg: 0, periodHours: 944.6, direction: 'prograde' },
    elements: null, epochDays: 0,
    moon: { semiMajorAxisKm: 64912, inclinationDeg: 28.9, nodeDeg: 88, periodDays: 39.36, meanLongitudeDeg: 240, tidallyLocked: true, retrograde: false, radiusKm: 8.5 },
  },
];
// ---- Accessors (drive UI + ephemeris; the hierarchy is data, not hard-coded) ----

const BY_ID = new Map<string, CelestialBody>(CATALOG.map((b) => [b.id, b]));

export function getBody(id: string): CelestialBody | undefined {
  return BY_ID.get(id);
}

/** All planets (parent === 'sun'), in orbital order (Mercury → Pluto). */
export function planets(): CelestialBody[] {
  const order = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  return order.map((id) => BY_ID.get(id)!).filter(Boolean);
}

/** The moons of a parent body, in orbital order as stored in the catalog. */
export function moonsOf(parentId: string): CelestialBody[] {
  return CATALOG.filter((b) => b.parent === parentId && b.moon);
}

/** True if a parent body has at least one moon (for the contextual moon selector). */
export function planetHasMoons(id: string): boolean {
  return moonsOf(id).length > 0;
}
