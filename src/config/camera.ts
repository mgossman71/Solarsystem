import * as THREE from 'three';

// ============================================================
// CAMERA — framing + OrbitControls defaults (single source of truth)
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

/** OrbitControls defaults (pan disabled, damped). */
export const CONTROLS = {
  enableDamping: true,
  dampingFactor: 0.05,
  minDistance: 1.3,
  maxDistance: 8,
  enablePan: false,
  rotateSpeed: 0.5,
  zoomSpeed: 0.8,
} as const;

/** SYSTEM (top-down overview) framing — the default starting view. */
export const SYSTEM_VIEW_MIN_DISTANCE = 100; // well above the Sun's corona halo (~7.7)
export const SYSTEM_VIEW_MAX_DISTANCE = 10000; // zoom-out ceiling (star shell 12000–13000 stays in view)
export const SYSTEM_VIEW_MAX_FRAME = 8000; // cap on the fit distance (narrow aspects stay sane/zoomable)

/** Interaction "settling" window (ms) before auto-rotate / reframe resume. */
export const INTERACTION_SETTLE_MS = 2000;
/** Debounce (ms) between orientation change and the reframe check. */
export const ORIENTATION_REFRAME_MS = 250;