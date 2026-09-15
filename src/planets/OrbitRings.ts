import * as THREE from 'three';
import { PLANETS, planetOrbitRadius } from './registry';
import { orbitPosition } from './orbital';
import type { ScaleMode } from '../core/types';

/**
 * Faint guide rings showing each planet's orbit, centred on the Sun at the
 * origin — each ring lies in that planet's OWN inclined orbital plane
 * (inclination + ascending node from the registry, PlanetSystem.reposition),
 * built with the same orbitPosition() helper the planet position uses. Their
 * purpose is orientation in the top-down "System" overview, where the
 * true-scale planets are sub-pixel dots: the rings carry the "planets in their
 * respective orbits" structure while the bodies stay small.
 *
 * Deliberately very low opacity and non-additive so they read as subtle guides
 * that never compete with the bodies or the star field.
 */
export const ORBIT_RING_SEGMENTS = 128;
export const ORBIT_RING_OPACITY = 0.3;
export const ORBIT_RING_COLOR = 0x6f86a6;

/**
 * Build the orbit rings for the given scale mode and add them to the scene.
 * Returns a Group (one `LineLoop` per planet) so the caller can dispose and
 * rebuild it when the mode changes — the radii differ between Exploration and
 * Real Scale (e.g. Pluto 2300 → 3100). Rebuild by removing + disposing this
 * group and calling again; `EarthScene.dispose()` also covers it via the
 * scene traverse (it frees every Line's geometry + material).
 */
export function createOrbitRings(scene: THREE.Scene, mode: ScaleMode): THREE.Group {
  const material = new THREE.LineBasicMaterial({
    color: ORBIT_RING_COLOR,
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
    group.add(line);
    return line;
  };

  // Deliberately no Earth ring: Earth's position is not an orbit angle —
  // EarthScene places it at `sun.direction * -EARTH_ORBIT_RADIUS`, and the
  // Sun-elevation slider can move it from the ecliptic plane straight over
  // the Sun, so no static ring could ever stay on it. Its name label
  // (EarthScene.setupPlanetLabels) points at it instead.
  // The eight other planets, each at its mode-specific radius AND its real
  // orbital inclination + ascending node (see registry). Same helper as the
  // planet position, so every planet sits exactly on its ring.
  for (const def of PLANETS) {
    ring(
      planetOrbitRadius(def, mode),
      THREE.MathUtils.degToRad(def.orbitInclinationDeg ?? 0),
      THREE.MathUtils.degToRad(def.orbitNodeDeg ?? 0),
    );
  }

  scene.add(group);
  return group;
}
