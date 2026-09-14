// ============================================================
// SOLAR — SCALE MODEL (pure math, unit-testable, no Three.js)
// ============================================================
// The Solar System spans 0.39 AU (Mercury) to ~39.5 AU (Pluto). At the true
// 1 AU = 600-unit scene scale that is ~23,700 units — far beyond a readable
// camera, and the planets (Earth = 1 unit) would be sub-pixel at those
// distances. So the Solar System view uses a documented EDUCATIONAL scale that
// keeps every body visible and in order, while preserving each orbit's TRUE
// direction and shape (the ephemeris position is only radially compressed,
// never rotated or re-shaped). This is distinct from the "realistic distance"
// scale, which the same ephemeris supports (set `compression=1`).
//
//   orbitRadius(rAU) = K · rAU^P
//     P < 1 compresses the outer planets so Mercury→Pluto fit in one frame.
//   planetRadius(radiusKm) — exaggerated + capped so every planet is
//     clickable/visible (planets are NOT to true size at these distances).
// ============================================================

export interface ScaleParams {
  /** Distance compression base (units at 1 AU when P=1). */
  base: number;
  /** Distance compression exponent (1 = true relative distances). */
  power: number;
}

/** Default "readable" scale: fits the whole system in one view. */
export const EDUCATIONAL_SCALE: ScaleParams = { base: 398, power: 0.5 };
/** "Realistic distance" scale: true relative AU distances. */
export const REALISTIC_SCALE: ScaleParams = { base: 600, power: 1.0 };

export const EARTH_RADIUS_KM = 6371;

/** Compressed on-scene orbital radius for an instantaneous heliocentric r (AU). */
export function orbitRadius(rAU: number, s: ScaleParams = EDUCATIONAL_SCALE): number {
  return s.base * Math.pow(Math.max(1e-4, rAU), s.power);
}

/** Exaggerated + capped display radius (units) so every planet stays visible. */
export function planetDisplayRadius(radiusKm: number): number {
  const trueR = radiusKm / EARTH_RADIUS_KM;
  return Math.min(4 + trueR * 2.2, 16);
}

/** Moon display radius (units) — small but resolvable. */
export function moonDisplayRadius(radiusKm: number): number {
  return Math.min(1.2 + (radiusKm / EARTH_RADIUS_KM) * 1.4, 5);
}

/**
 * A planet's moon orbits, spaced between ~1.6× and ~3.6× the planet's display
 * radius by their relative semi-major axes (inner → outer), so all are visible
 * and correctly ordered regardless of the huge true km range.
 */
export function moonOrbitRadius(planetR: number, aKm: number, maxAKm: number): number {
  const t = maxAKm > 0 ? aKm / maxAKm : 1;
  return planetR * (1.6 + 2.0 * t);
}
