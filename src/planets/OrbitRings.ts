import * as THREE from 'three';
import { PLANETS, planetOrbitRadius } from './registry';
import { orbitPosition } from './orbital';
import { EARTH_ORBIT_RADIUS } from '../config/sceneScale';
import type { ScaleMode } from '../core/types';

/**
 * Faint guide rings showing Earth's orbit and each planet's orbit, centred on
 * the Sun at the origin — each planet ring lies in that planet's OWN inclined
 * orbital plane (inclination + ascending node from the registry,
 * PlanetSystem.reposition), built with the same orbitPosition() helper the
 * planet position uses. Earth's ring is the flat ecliptic reference circle at
 * EARTH_ORBIT_RADIUS. Their purpose is orientation in the "System"
 * overview (45°-tilted, side-offset), where the true-scale planets are
 * sub-pixel dots: the rings carry
 * the "planets in their respective orbits" structure while the bodies stay small.
 *
 * Deliberately very low opacity and non-additive so they read as subtle guides
 * that never compete with the bodies or the star field.
 */
export const ORBIT_RING_SEGMENTS = 128;
export const ORBIT_RING_OPACITY = 0.3;
export const ORBIT_RING_COLOR = 0x6f86a6;

/**
 * Brightness of the guide rings, expressed as a multiplier on ORBIT_RING_COLOR.
 * Opacity stays fixed at ORBIT_RING_OPACITY — "brightness" here means colour
 * intensity (dark→bright), not alpha. 1.0 reproduces the original look exactly,
 * 0 is invisible (black) and 2.5 is near-white.
 */
export const ORBIT_RING_BRIGHTNESS_MIN = 0;
export const ORBIT_RING_BRIGHTNESS_MAX = 2.5;
// Default = full brightness, so the slider starts at the far right.
export const ORBIT_RING_BRIGHTNESS_DEFAULT = ORBIT_RING_BRIGHTNESS_MAX;

// Built once at module load; ringColor() below only ever clones it.
const ORBIT_RING_BASE_COLOR = new THREE.Color(ORBIT_RING_COLOR);

/** The ring colour for a brightness value, clamped to the supported range. */
export function ringColor(brightness: number): THREE.Color {
  const b = THREE.MathUtils.clamp(brightness, ORBIT_RING_BRIGHTNESS_MIN, ORBIT_RING_BRIGHTNESS_MAX);
  return ORBIT_RING_BASE_COLOR.clone().multiplyScalar(b);
}

/** Unit normal of the ecliptic (XZ) plane — the base orientation of Earth's ring. */
const ECLIPTIC_NORMAL = new THREE.Vector3(0, 1, 0);

/**
 * Minimal rotation that tips a ring's plane (normal `planeNormal`) so the
 * plane CONTAINS the body at `bodyPos` — after the rotation,
 * `rotatedNormal · bodyPos = 0`, i.e. the body lies on the ring.
 *
 * Derived from Rodrigues: rotating n about axis (n × b) by
 * θ = −asin( (n·b)/|b| ) gives n'·b = 0 exactly. The axis is radial
 * (⊥ b), so the body's distance from the ring centre is unchanged —
 * a ring of radius |b| still passes through it.
 * The sign of `planeNormal` is irrelevant (axis and angle both flip →
 * same rotation). Returns identity when the body is already in the plane
 * (or the inputs are degenerate); the body-∥-normal case falls back to a
 * horizontal axis. Pure — writes `out` in place and returns it.
 */
export function ringPlaneCorrection(
  planeNormal: THREE.Vector3,
  bodyPos: THREE.Vector3,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const nLen = Math.sqrt(planeNormal.lengthSq());
  const bLen = bodyPos.length();
  if (nLen < 1e-12 || bLen < 1e-9) return out.identity();
  const s = planeNormal.dot(bodyPos) / nLen; // n·b with n normalized
  const theta = -Math.asin(THREE.MathUtils.clamp(s / bLen, -1, 1));
  if (Math.abs(theta) < 1e-9) return out.identity();
  const axis = new THREE.Vector3().crossVectors(planeNormal, bodyPos);
  if (axis.lengthSq() < 1e-12) {
    // Body (anti-)parallel to the normal — n × b is zero; any axis ⊥ n works.
    axis.set(planeNormal.z, 0, -planeNormal.x);
    if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0);
  }
  return out.setFromAxisAngle(axis.normalize(), theta);
}

// Module-level scratch for orientOrbitRings (one call per frame — avoid GC).
const ORIENT_NORMAL = new THREE.Vector3();
const ORIENT_CORRECTION = new THREE.Quaternion();

/**
 * Per-frame alignment: rotates each ring in `group` (children order) about
 * the scene origin so its plane passes THROUGH the matching body's current
 * world position (`bodyPositions[i]` ↔ `group.children[i]`).
 *
 * This is what pins Earth's ring to Earth: Earth's orbit point is
 * Sun-direction driven (azimuth + elevation), so it leaves the flat
 * ecliptic whenever the Sun's elevation ≠ 0 and the ring must follow. For
 * the eight planet rings — built from the same orbitPosition() math that
 * places their planets — the correction is a no-op in steady state, and it
 * self-corrects if a position ever drifts off its nominal plane.
 *
 * Rings live at the scene origin with an identity parent transform, so a
 * local rotation IS the world rotation (hence `premultiply`). Each ring's
 * base plane normal was stored in `userData.baseNormal` at build time; the
 * accumulated quaternion keeps corrections composable frame to frame.
 */
export function orientOrbitRings(
  group: THREE.Group,
  bodyPositions: readonly THREE.Vector3[],
): void {
  for (let i = 0; i < group.children.length && i < bodyPositions.length; i++) {
    const ring = group.children[i] as THREE.Line;
    const base = (ring.userData.baseNormal as THREE.Vector3 | undefined) ?? ECLIPTIC_NORMAL;
    ORIENT_NORMAL.copy(base).applyQuaternion(ring.quaternion);
    ringPlaneCorrection(ORIENT_NORMAL, bodyPositions[i], ORIENT_CORRECTION);
    ring.quaternion.premultiply(ORIENT_CORRECTION);
  }
}

/**
 * Build the orbit rings for the given scale mode and add them to the scene.
 * Returns a Group (Earth's ecliptic ring first, then one `LineLoop` per
 * registry planet) so the caller can dispose and rebuild it when the mode
 * changes — the radii differ between Exploration and Real Scale
 * (e.g. Pluto 2300 → 3100); Earth's stays at EARTH_ORBIT_RADIUS in both.
 * Rebuild by removing + disposing this group and calling again;
 * `EarthScene.dispose()` also covers it via the scene traverse (it frees
 * every Line's geometry + material).
 *
 * `earthBodyPos` (optional) is Earth's CURRENT world position: when given,
 * the group is pre-oriented so Earth's ring already passes through Earth on
 * the very first frame (see orientOrbitRings — EarthScene re-applies it
 * every frame because Earth's orbit point is Sun-direction driven).
 */
export function createOrbitRings(
  scene: THREE.Scene,
  mode: ScaleMode,
  brightness: number = ORBIT_RING_BRIGHTNESS_DEFAULT,
  earthBodyPos?: THREE.Vector3,
): THREE.Group {
  const material = new THREE.LineBasicMaterial({
    color: ringColor(brightness),
    transparent: true,
    opacity: ORBIT_RING_OPACITY,
    depthWrite: false, // don't write depth; the opaque bodies/rings occlude correctly
    depthTest: true, // so rings pass "behind" the Sun disc
    toneMapped: false,
  });

  const group = new THREE.Group();
  group.name = 'orbitRings';

  const ring = (radius: number, inclRad: number, nodeRad: number): THREE.LineLoop => {
    const points: THREE.Vector3[] = [];
    const scratch = new THREE.Vector3();
    for (let i = 0; i < ORBIT_RING_SEGMENTS; i++) {
      const a = (i / ORBIT_RING_SEGMENTS) * Math.PI * 2;
      orbitPosition(a, radius, inclRad, nodeRad, scratch);
      points.push(scratch.clone());
    }
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      material, // shared: one material to dispose for every ring
    );
    // renderOrder must be set on the RENDERED object — three.js does not
    // inherit it from the parent group. 1 = after the star field (0).
    line.renderOrder = 1;
    // Base plane normal (from two points 90° apart on the circle) — used by
    // orientOrbitRings() to compute each frame's alignment correction.
    line.userData.baseNormal = new THREE.Vector3()
      .crossVectors(points[0], points[ORBIT_RING_SEGMENTS >> 2])
      .normalize();
    group.add(line);
    return line;
  };

  // Earth: built as the flat ecliptic circle at EARTH_ORBIT_RADIUS, then
  // oriented per frame (orientOrbitRings) so it always passes through
  // Earth's live orbit point. EarthScene places Earth at
  // `-sun.direction * EARTH_ORBIT_RADIUS` — Sun azimuth/elevation driven —
  // so Earth sits on a sphere of radius EARTH_ORBIT_RADIUS, not in the
  // ecliptic plane: the ring's PLANE tilts to contain Earth's current
  // position in all three Sun modes (Manual, Auto Sun, Full Daylight).
  // The radius is identical in BOTH scale modes: EARTH_ORBIT_RADIUS is the
  // Sun-calibration distance (sceneScale.ts), never rescaled.
  ring(EARTH_ORBIT_RADIUS, 0, 0);

  // The eight other planets, each at its mode-specific radius AND its real
  // orbital inclination + ascending node (see registry). Same helper as the
  // planet position, so every planet sits exactly on its ring; the per-frame
  // orientOrbitRings pass is a no-op for them in steady state (and a
  // self-correction if anything ever drifts off the plane).
  for (const def of PLANETS) {
    ring(
      planetOrbitRadius(def, mode),
      THREE.MathUtils.degToRad(def.orbitInclinationDeg ?? 0),
      THREE.MathUtils.degToRad(def.orbitNodeDeg ?? 0),
    );
  }

  // Pre-orient from the bodies' starting positions so the very first frame
  // already shows every ring through its body (only Earth's ring actually
  // rotates — the planet rings are exact by construction).
  if (earthBodyPos) {
    const tmp = new THREE.Vector3();
    const bodies: THREE.Vector3[] = [earthBodyPos.clone()];
    for (const def of PLANETS) {
      orbitPosition(
        def.initialOrbitAngle,
        planetOrbitRadius(def, mode),
        THREE.MathUtils.degToRad(def.orbitInclinationDeg ?? 0),
        THREE.MathUtils.degToRad(def.orbitNodeDeg ?? 0),
        tmp,
      );
      bodies.push(tmp.clone());
    }
    orientOrbitRings(group, bodies);
  }

  scene.add(group);
  return group;
}

/**
 * Live-update the brightness of an already-built ring group without rebuilding
 * its geometry. All rings in the group share one material (see
 * createOrbitRings), so a single colour write covers every ring — cheap enough
 * to run on each slider tick. Opacity is intentionally left untouched.
 */
export function setRingBrightness(group: THREE.Group, brightness: number): void {
  const line = group.children[0] as THREE.Line | undefined;
  const mat = line?.material;
  if (!mat) return;
  const color = ringColor(brightness);
  if (Array.isArray(mat)) {
    for (const m of mat) (m as THREE.LineBasicMaterial).color.copy(color);
  } else {
    (mat as THREE.LineBasicMaterial).color.copy(color);
  }
}
