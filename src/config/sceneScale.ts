// ============================================================
// SCENE SCALE — single source of truth for sizes/distances
// ============================================================
// The scene is normalized to EARTH_RADIUS = 1 scene unit. Every other body's
// size and every distance is expressed relative to that, so a change to
// relative scale never requires touching rendering internals.

export const EARTH_RADIUS = 1;

// ---- Sun & Earth's orbit (heliocentric core) ----
// The layout is HELIOCENTRIC: the Sun is a real scene object at the SYSTEM
// CENTRE (origin), Earth orbits it at EARTH_ORBIT_RADIUS, and every planet
// orbits beyond Earth (see planets/registry.ts). That Earth–Sun distance
// calibrates the Sun's apparent size: radius 2.8 at 600 gives ~0.53° from
// Earth (2·atan(2.8/600)) — the true solar angular diameter — and ≫ the Moon
// orbit (≤ 60.3), so its light behaves like a distant point source with
// physically correct parallax. The star shell sits BEYOND every body
// (STAR_FIELD_RADIUS_*): the skybox is the farthest layer, so the Sun
// (at the centre) occludes stars behind it instead of stars painting over
// the bright disk.
export const SUN_RADIUS = 2.8;
/** Earth–Sun distance = Earth's orbital radius about the Sun (BOTH scale
 *  modes — the calibration distance for the Sun's true apparent size). */
export const EARTH_ORBIT_RADIUS = 600;
/** Earth's sidereal year (days) — feeds the shared orbit clock (DAY_SECONDS). */
export const EARTH_ORBIT_PERIOD_DAYS = 365.256;

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

// ---- Star field backdrop ----
// The shell must sit BEHIND every body the camera looks past, in BOTH scale
// modes — stars between the camera and a body composite over transparent
// areas (additive points never write depth → "stars through the rings"). The
// farthest body is Pluto in Real scale: its orbit (3100) plus Charon (0.55)
// ≈ 3100.5 from the Sun at the origin, so the shell's inner edge clears that.
// (Per-star pixel size tracks the shell depth via StarField's `uScale`, and
// star COUNT is radius-independent for a centred camera — so neither needs
// changing when the band moves.)
export const STAR_FIELD_RADIUS_MIN = 3300;
export const STAR_FIELD_RADIUS_SPAN = 150; // radius = MIN + rand() * SPAN (3300–3450)

/** Wrap an azimuth in degrees into the -180..180 range. */
export function wrapAzimuth(deg: number): number {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}