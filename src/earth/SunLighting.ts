import * as THREE from 'three';

// ============================================================
// SUN LIGHTING — SINGLE SOURCE OF TRUTH
// ============================================================
// The Sun is infinitely distant for this visualization, so it is modeled as a
// normalized *direction* in world space (parallel rays). Every lighting system
// (Earth surface day/night, city lights, clouds, atmosphere, ocean specular)
// reads its Sun direction from this one shared vector — no layer invents its
// own unrelated lighting direction.
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
 * Authoritative Sun state. `direction` is a persistent, normalized Vector3
 * shared by reference with every shader uniform that needs the Sun. Call
 * `set()` to move the Sun; every consumer sees the change immediately.
 */
export class SunLightingState {
  /** Sun azimuth in degrees, -180..180. */
  azimuth = 0;
  /** Sun elevation in degrees, -90..90. */
  elevation = 0;
  /** Normalized world-space Sun direction (single shared instance). */
  readonly direction = new THREE.Vector3(1, 0, 0);

  constructor(azimuth: number, elevation: number) {
    this.set(azimuth, elevation);
  }

  /** Move the Sun. The shared `direction` vector is updated in place. */
  set(azimuth: number, elevation: number): void {
    this.azimuth = azimuth;
    this.elevation = elevation;
    sunDirectionFromAzEl(azimuth, elevation, this.direction);
  }
}