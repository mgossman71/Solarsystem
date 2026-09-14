// ============================================================
// ASTRONOMY — SHARED TYPES
// ============================================================
// Single source of truth for the shapes that describe a celestial body and its
// orbit. Every orbital/rotational constant for the Solar System lives in
// `CelestialCatalog.ts`; the scene code consumes these, never literals.
//
// Reference frame (documented, do not mix silently):
//   • Orbital elements use the J2000 mean ecliptic (JPL "Keplerian Elements
//     for Approximate Positions of the Major Planets"), epoch J2000.0.
//   • `ReferenceFrames.ts` maps that ecliptic frame (north = +z_ecl) onto the
//     Three.js scene (north = +Y) via a proper rotation (det = +1), preserving
//     all angles and relative geometry. The Solar System is heliocentric:
//     the Sun is at the origin and every planet position is derived from it.
// ============================================================

/** Broad physical class of a body (drives rendering strategy + UI labels). */
export type BodyKind =
  | 'star'          // the Sun
  | 'terrestrial'   // rocky planets (Mercury, Venus, Earth, Mars)
  | 'gas'           // gas giants (Jupiter, Saturn)
  | 'ice'           // ice giants (Uranus, Neptune)
  | 'dwarf';        // dwarf planets (Pluto)

/**
 * JPL J2000 mean orbital elements (ecliptic of J2000) for a planet's orbit
 * around the Sun. `a` in astronomical units; angles in degrees. The `*Dot`
 * fields are the secular rates per Julian century used to propagate the
 * elements to a different epoch (JPL publishes both the value and its rate).
 */
export interface KeplerianElements {
  a: number;       // semi-major axis (AU)
  e: number;       // eccentricity
  i: number;       // inclination (deg)
  L: number;       // mean longitude (deg)
  varpi: number;   // longitude of perihelion (deg)  (ρ̄)
  Omega: number;   // longitude of ascending node (deg) (Ω)
  aDot?: number;   // d(a)/dT per century
  eDot?: number;   // d(e)/dT per century
  iDot?: number;   // d(i)/dT per century
  LDot?: number;   // d(L)/dT per century (= mean motion n)
  varpiDot?: number;
  OmegaDot?: number;
}

/**
 * Simplified circular-orbit elements for a moon around its parent planet.
 * Distances in kilometres (converted to scene units by the scale model),
 * angles in degrees. `nodeDeg` is the longitude of the ascending node
 * measured in the parent's equatorial plane.
 */
export interface MoonOrbitElements {
  semiMajorAxisKm: number;   // mean orbital radius
  inclinationDeg: number;    // tilt of the orbit
  nodeDeg: number;           // longitude of ascending node (parent equator)
  periodDays: number;        // sidereal orbital period
  meanLongitudeDeg: number;  // reference phase (stagger so the system never aligns)
  tidallyLocked: boolean;    // same face to the parent
  retrograde: boolean;       // orbit direction (e.g. Triton)
  radiusKm: number;          // moon mean radius
}

/** Rotation / axial orientation of a body (drives the tilt + spin direction). */
export interface RotationModel {
  obliquityDeg: number;              // axial tilt (Uranus ~97.8°, Pluto ~122°)
  periodHours: number;               // sidereal rotation; SIGN = direction (− retrograde)
  direction: 'prograde' | 'retrograde'; // explicit for readability/testing
}

/** Equirectangular (2:1, north-up) texture set for a body. */
export interface BodyTextures {
  body: string;
  night?: string;
  clouds?: string;
  ring?: string;
}

/** A single celestial body in the catalog. */
export interface CelestialBody {
  id: string;                    // stable key (also a `Focus` value)
  name: string;                  // display name
  kind: BodyKind;
  isDwarf?: boolean;             // UI: label "… — Dwarf Planet"
  parent: string | null;         // 'sun' for planets · planet id for moons · null for the Sun
  radiusKm: number;              // mean radius
  equatorialRadiusKm?: number;   // if oblate (gas/ice giants, Saturn)
  polarRadiusKm?: number;
  rotation: RotationModel;
  /** Planet orbit around the Sun (JPL J2000). Null for the Sun and for moons. */
  elements: KeplerianElements | null;
  /** Moon orbit around the parent. Null for planets and the Sun. */
  moon: MoonOrbitElements | null;
  /** Epoch of the elements, days since J2000.0 (0 for the standard J2000 set). */
  epochDays: number;
  textures?: BodyTextures;
  /** True if the body has a ring system (Saturn, Uranus, Neptune, Jupiter). */
  hasRings?: boolean;
  notes?: string;
}
