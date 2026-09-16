import * as THREE from 'three';

// ============================================================
// CAMERA — free-roam + framing defaults (single source of truth)
// ============================================================
export const CAMERA_FOV = 45; // vertical field of view (degrees)
export const CAMERA_NEAR = 0.01;
export const CAMERA_FAR = 25000; // must clear the far side of the star shell
  // (12000–13000, see sceneScale STAR_FIELD_RADIUS_*) as seen from the
  // OUTERMOST camera — the tilted System zoom-out ceiling (~8000, see
  // SYSTEM_VIEW_MAX_FRAME) puts the far shell edge at ~21000, so 25000
  // leaves headroom.

/** EARTH-RELATIVE starting offset (Earth orbits the Sun — add to its live
 *  position; the initial orbit angle places Earth opposite the initial Sun). */
export const INITIAL_CAMERA_POSITION = new THREE.Vector3(0, 0.5, 3.2);

/** SYSTEM (overview) framing — the default starting view + what Reset returns to. */
export const SYSTEM_VIEW_MIN_DISTANCE = 100; // well above the Sun's corona halo (~7.7)
export const SYSTEM_VIEW_MAX_DISTANCE = 10000; // zoom-out ceiling (star shell 12000–13000 stays in view)
export const SYSTEM_VIEW_MAX_FRAME = 8000; // cap on the fit distance (narrow aspects stay sane/zoomable)
/** Elevation (deg) of the default System view above the orbital (XZ) plane.
 *  45° = the classic 3/4 "hero" angle: up AND to the side, looking down at the
 *  Sun (at the origin) — NOT a straight-down overhead. See `systemViewPose()`. */
export const SYSTEM_VIEW_ELEVATION_DEG = 45;
/** Azimuth (deg) the default System view sits to one side (90° => along +Z,
 *  the same side the camera traditionally starts from). */
export const SYSTEM_VIEW_AZIMUTH_DEG = 90;

/**
 * Unit direction from the Sun (origin) toward the camera for the default
 * System overview — SYSTEM_VIEW_ELEVATION_DEG above the orbital (XZ) plane,
 * offset to one side by SYSTEM_VIEW_AZIMUTH_DEG. This is the classic 3/4
 * "hero" framing (up AND to the side), NOT a straight-down overhead.
 *
 * Single source of truth for BOTH the initial load (createCamera) and what
 * Reset / the System button fly back to (systemViewPose), so the two can
 * never disagree. Az 90° => the side offset lies along +Z, the same side the
 * camera traditionally started from.
 */
export function systemViewDirection(): THREE.Vector3 {
  const elev = THREE.MathUtils.degToRad(SYSTEM_VIEW_ELEVATION_DEG);
  const az = THREE.MathUtils.degToRad(SYSTEM_VIEW_AZIMUTH_DEG);
  return new THREE.Vector3(
    Math.cos(elev) * Math.sin(az),
    Math.sin(elev),
    Math.cos(elev) * Math.cos(az),
  );
}

/** Interaction "settling" window (ms) before auto-rotate / reframe resume. */
export const INTERACTION_SETTLE_MS = 2000;
/** Debounce (ms) between orientation change and the reframe check. */
export const ORIENTATION_REFRAME_MS = 250;

/**
 * ROAM — free-fly camera defaults (replaces OrbitControls). The camera is an
 * unbound point you drive anywhere in the scene; there is no pivot. Desktop
 * follows the Mac trackpad gesture model:
 *   two-finger up/down (or wheel)  dolly along the view (zoom in / out)
 *   two-finger left/right          rotate (yaw) about world-up
 *   left-drag                      free look (pitch + yaw)
 *   W A S D / Q E                  move, view-relative (Q = down, E = up)
 *   Shift                          boost
 * Mobile: one finger = look, pinch = zoom, two-finger drag = move (up/down).
 *
 * Travel scales with distance to the focused body (see distanceScale) so
 * dolly and WASD feel consistent from a Moon close-up to the System overview.
 * Two safety rails: a soft collider keeps the camera just off every body
 * surface (no tunnelling), and a hard range cap keeps you inside the star
 * shell (12000–13000, see sceneScale STAR_FIELD_RADIUS_*).
 */
export const ROAM = {
  /** Radians of look per pixel of drag (mouse drag / one-finger touch). */
  lookSpeed: 0.0032,
  /** World units of dolly per pixel of vertical wheel, × distance scale. */
  zoomSpeed: 0.025,
  /** World units/s of WASD/QE travel at distance scale 1. */
  moveSpeed: 14,
  /** World units per pixel of two-finger touch drag, × distance scale. */
  touchMoveSpeed: 0.06,
  /** Extra travel multiplier while Shift is held. */
  boost: 3.5,
  /** Distance scale: scale = max(1, distToFocus × distanceScale). */
  distanceScale: 0.02,
  /** Hard cap on |camera − origin| — stays inside the star shell. */
  maxRange: 11500,
  /** Soft collider: keep the camera (radius × (1+frac) + pad) off any body. */
  surfaceMarginFrac: 0.04,
  surfaceMarginPad: 0.02,
  /** Max pitch (rad) — keeps a gap off the poles to avoid the gimbal flip. */
  maxPitch: Math.PI / 2 - 0.02,
  /** Idle window (ms) after the last input before 'end' is emitted. */
  settleMs: 220,
} as const;