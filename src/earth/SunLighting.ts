import * as THREE from 'three';

// ============================================================
// SUN LIGHTING — SINGLE SOURCE OF TRUTH
// ============================================================
// The Sun is a REAL SCENE OBJECT at `sunWorldPos` (see EarthScene). For
// lighting we compute a direction PER BODY from that one world position:
//
//   sunDirectionForEarth = normalize(sunWorldPos - earthWorldPos)
//   sunDirectionForMoon  = normalize(sunWorldPos - moonWorldPos)
//
// (For a finite-distance Sun the rays are strictly point-source rays; at the
// scene distances involved the per-body directions differ by at most the
// Earth–Moon baseline, which is exactly what produces true lunar phases.)
//
// `SunLightingState` stores the Sun's position RELATIVE TO EARTH as azimuth /
// elevation (the control-panel state). Because the Sun is a fixed scene object
// and the Earth-Moon system moves around it, "moving the Sun" = repositioning
// the Earth-Moon system to the opposite side — the relative direction is what
// every lighting consumer ultimately needs.
//
// Azimuth is measured from +X toward +Z (az=+90 => toward the default camera
// at +Z, az=-90 => away => backlit). Elevation is the angle above the
// equatorial (XZ) plane.

const DEG2RAD = Math.PI / 180;

export function sunDirectionFromAzEl(
  azDeg: number,
  elDeg: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const az = azDeg * DEG2RAD;
  const el = elDeg * DEG2RAD;
  return out
    .set(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    )
    .normalize();
}

/**
 * Sun world position from its Earth-relative direction and the scene's
 * Earth-Sun distance (one of two scale modes: Exploration or Real).
 */
export function sunWorldPositionFromAzEl(
  azDeg: number,
  elDeg: number,
  distance: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  return sunDirectionFromAzEl(azDeg, elDeg, out).multiplyScalar(distance);
}

/**
 * Direction from `objectPos` toward the Sun's world position (normalized).
 * This is the ONLY way a lighting direction is derived when the Sun is
 * present — no unrelated fake directional vectors.
 */
export function sunDirectionToward(
  sunWorldPos: THREE.Vector3,
  objectPos: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.copy(sunWorldPos).sub(objectPos).normalize();
}

/**
 * Authoritative Sun state (Earth-relative position). `direction` is the
 * normalized Earth→Sun vector in world space — identical to
 * `sunDirectionToward(sunPos, earthPos)` for the current geometry, kept as a
 * cheap shared instance for the UI ray and readouts.
 */
export class SunLightingState {
  /** Sun azimuth in degrees, -180..180 (relative to Earth). */
  azimuth = 0;
  /** Sun elevation in degrees, -90..90 (relative to Earth). */
  elevation = 0;
  /** Normalized Earth→Sun world-space direction (persistent instance). */
  readonly direction = new THREE.Vector3(1, 0, 0);

  constructor(azimuth: number, elevation: number) {
    this.set(azimuth, elevation);
  }

  /** Move the Sun (relative to Earth). The shared vector is updated in place. */
  set(azimuth: number, elevation: number): void {
    this.azimuth = azimuth;
    this.elevation = elevation;
    sunDirectionFromAzEl(azimuth, elevation, this.direction);
  }
}