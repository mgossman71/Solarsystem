// ============================================================
// ASTRONOMY — REFERENCE FRAMES
// ============================================================
// Documented, fixed mapping between the J2000 ecliptic frame (the frame of the
// orbital elements) and the Three.js scene frame. It is a PURE PROPER ROTATION
// (det = +1): it preserves all angles, distances and relative geometry, so no
// orbital inclination/eccentricity is lost in translation.
//
//   Ecliptic (right-handed):  x_e toward the vernal equinox, y_e prograde,
//                             z_e toward the ecliptic NORTH pole.
//   Scene   (right-handed):  X, Z = the ecliptic plane, Y = up.
//
//   Mapping:  scene.x = +x_e      (ecliptic plane)
//             scene.y = +z_e      (ecliptic north  ->  scene up)
//             scene.z = -y_e      (keeps the frame right-handed)
//
// The inverse is sceneToEcliptic. Both are identity-free linear maps, so the
// round-trip is exact (tested).
// ============================================================

export interface Vec3 { x: number; y: number; z: number }

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Normalize an angle (degrees) into [0, 360). */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Normalize an angle (degrees) into (-180, 180]. */
export function norm180(deg: number): number {
  const a = norm360(deg);
  return a > 180 ? a - 360 : a;
}

/** Map a J2000 ecliptic vector (x_e,y_e,z_e) to the scene frame (north = +Y). */
export function eclipticToScene(e: Vec3, out: Vec3): Vec3 {
  out.x = e.x;
  out.y = e.z;
  out.z = -e.y;
  return out;
}

/** Inverse of {@link eclipticToScene} (scene -> ecliptic). Exact round-trip. */
export function sceneToEcliptic(s: Vec3, out: Vec3): Vec3 {
  out.x = s.x;
  out.y = -s.z;
  out.z = s.y;
  return out;
}

/** Heliocentric ecliptic longitude (deg, 0..360) of a position vector. */
export function eclipticLongitude(e: Vec3): number {
  return norm360(Math.atan2(e.y, e.x) * RAD2DEG);
}

/** Ecliptic latitude (deg) of a position vector (0 at the ecliptic plane). */
export function eclipticLatitude(e: Vec3): number {
  return Math.asin(e.z / (Math.hypot(e.x, e.y, e.z) || 1)) * RAD2DEG;
}
