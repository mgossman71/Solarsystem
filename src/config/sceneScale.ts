// ============================================================
// SCENE SCALE — single source of truth for sizes/distances
// ============================================================
// The scene is normalized to EARTH_RADIUS = 1 scene unit. Every other body's
// size and every distance is expressed relative to that, so a change to
// relative scale never requires touching rendering internals.

export const EARTH_RADIUS = 1;

// ---- Sun (a real scene object, not a fake directional light) ----
// Radius 2.8 at distance 600 gives an apparent size of ~0.53° from Earth
// (2·atan(2.8/600)) — the true solar angular diameter — and ≫ the Moon orbit
// (≤ 60.3), so its light behaves like a distant point source with physically
// correct parallax. The star shell sits BEYOND the Sun (STAR_FIELD_RADIUS_*):
// the skybox is the farthest layer, so the Sun occludes stars behind it
// instead of stars painting over the bright disk.
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

// ---- Star field backdrop ----
// The shell must sit BEHIND every body the camera looks past, in BOTH scale
// modes — stars between the camera and a body composite over transparent
// areas (additive points never write depth → "stars through the rings"). The
// farthest body is Iapetus in Real scale: Saturn's centre (|r| ≈ 301) plus its
// true orbit (~559) ≈ 860 from the origin, so the shell's inner edge clears
// that. 1000–1150 also sits beyond the Sun (600): the skybox is the farthest
// layer, so the Sun correctly occludes stars behind it. (Per-star pixel size
// tracks the shell depth via StarField's `uScale`, and star COUNT is
// radius-independent for a centred camera — so neither needs changing when the
// band moves.)
export const STAR_FIELD_RADIUS_MIN = 1000;
export const STAR_FIELD_RADIUS_SPAN = 150; // radius = MIN + rand() * SPAN (1000–1150)

/** Wrap an azimuth in degrees into the -180..180 range. */
export function wrapAzimuth(deg: number): number {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}