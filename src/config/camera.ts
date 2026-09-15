import * as THREE from 'three';

// ============================================================
// CAMERA — framing + OrbitControls defaults (single source of truth)
// ============================================================
export const CAMERA_FOV = 45; // vertical field of view (degrees)
export const CAMERA_NEAR = 0.01;
export const CAMERA_FAR = 7000; // covers Real-Scale Pluto (~3100) + star shell (3300–3450)
// from the OUTERMOST camera: a Pluto focus sees the far side of the shell
// at ~6550, so 7000 leaves headroom for the focus offset.

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

/** Interaction "settling" window (ms) before auto-rotate / reframe resume. */
export const INTERACTION_SETTLE_MS = 2000;
/** Debounce (ms) between orientation change and the reframe check. */
export const ORIENTATION_REFRAME_MS = 250;