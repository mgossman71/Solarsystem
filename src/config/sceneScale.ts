// ============================================================
// SCENE SCALE — single source of truth for sizes/distances
// ============================================================
// The scene is normalized to EARTH_RADIUS = 1 scene unit. Every other body's
// size and every distance is expressed relative to that, so a change to
// relative scale never requires touching rendering internals.

export const EARTH_RADIUS = 1;

// ---- Sun (a real scene object, not a fake directional light) ----
// Radius 2.8 at distance 600 gives an apparent size of ~0.53° from Earth
// (2·atan(2.8/600)) — the true solar angular diameter — while 600 sits well
// outside the star field (200–350) and ≫ the Moon orbit (≤ 60.3), so its light
// behaves like a distant point source with physically correct parallax.
export const SUN_RADIUS = 2.8;
export const SUN_DISTANCE = 600;

// Initial Earth-relative Sun direction (azimuth/elevation, degrees).
export const INITIAL_SUN_AZIMUTH = 150; // -180..180 (az=+90 => toward default cam at +Z)
export const INITIAL_SUN_ELEVATION = 18; // -90..90 (above the equatorial plane)

// ---- Moon (relative to Earth radius = 1) ----
export const MOON_RADIUS = 0.2727; // 1737.4 / 6371 km (exact size ratio)
export const MOON_ORBIT_EXPLORE = 10; // Exploration scale, center-to-center
export const MOON_ORBIT_REAL = 60.3; // true mean distance, in Earth radii
export const MOON_ORBIT_INCLINATION = (5.145 * Math.PI) / 180; // real mean tilt
export const INITIAL_MOON_ANGLE = (-60 * Math.PI) / 180; // starts right of Earth
export const MOON_ORBIT_PERIOD_VISUAL = 60; // s per orbit, "Visualized" mode
export const MOON_ORBIT_PERIOD_REALTIME = 27.32 * 24 * 3600; // sidereal month, s

// ---- Star field backdrop (kept beyond the Real-Scale Moon orbit) ----
export const STAR_FIELD_RADIUS_MIN = 200;
export const STAR_FIELD_RADIUS_SPAN = 150; // radius = MIN + rand() * SPAN (200–350)

/** Wrap an azimuth in degrees into the -180..180 range. */
export function wrapAzimuth(deg: number): number {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}