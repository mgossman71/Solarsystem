import * as THREE from 'three';

// ============================================================
// CAMERA — free-roam + framing defaults (single source of truth)
// ============================================================
export const CAMERA_FOV = 45; // vertical field of view (degrees)
export const CAMERA_NEAR = 0.01;
export const CAMERA_FAR = 25000; // must clear the far side of the star shell
  // (12000–13000, see sceneScale STAR_FIELD_RADIUS_*) as seen from the
  // OUTERMOST camera — the top-down System zoom-out ceiling (~10000, see
  // SYSTEM_VIEW_MAX_DISTANCE) puts the far shell edge at ~23000, so 25000
  // leaves headroom.

/** EARTH-RELATIVE starting offset (Earth orbits the Sun — add to its live
 *  position; the initial orbit angle places Earth opposite the initial Sun). */
export const INITIAL_CAMERA_POSITION = new THREE.Vector3(0, 0.5, 3.2);

/** SYSTEM (top-down overview) framing — the default starting view. */
export const SYSTEM_VIEW_MIN_DISTANCE = 100; // well above the Sun's corona halo (~7.7)
export const SYSTEM_VIEW_MAX_DISTANCE = 10000; // zoom-out ceiling (star shell 12000–13000 stays in view)
export const SYSTEM_VIEW_MAX_FRAME = 8000; // cap on the fit distance (narrow aspects stay sane/zoomable)

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