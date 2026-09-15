import * as THREE from 'three';

/**
 * Circular-orbit position in a scene where the ecliptic is the XZ plane
 * (up = +Y) and the Sun sits at the origin.
 *
 * The orbit is a circle of `radius` in a plane inclined to the ecliptic by
 * `inclinationRad`; the tilt axis is the line of nodes, itself rotated about
 * the up axis by `ascendingNodeRad`. `angleRad` is measured along the orbit
 * from the ascending node.
 *
 * When both `inclinationRad` and `ascendingNodeRad` are 0 the result reduces
 * to the pre-existing flat convention used everywhere else in the scene:
 *   (r·cos a, 0, -r·sin a)
 *
 * `out` is written in place and returned — pass a scratch vector for hot
 * per-frame calls (PlanetSystem.reposition) to avoid GC pressure.
 *
 * Both PlanetSystem (planet position) and OrbitRings (the visible guide
 * circle) MUST call this — that shared helper is what keeps the planet on
 * its ring at every angle.
 */
export function orbitPosition(
  angleRad: number,
  radius: number,
  inclinationRad: number,
  ascendingNodeRad: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  // In-plane circle, node line along +X (up = +Y, ecliptic = XZ).
  const x0 = radius * ca;
  const y0 = radius * sa * Math.sin(inclinationRad);
  const z0 = -radius * sa * Math.cos(inclinationRad);
  // Rotate the node line into place about up (+Y) by the ascending node.
  const co = Math.cos(ascendingNodeRad);
  const so = Math.sin(ascendingNodeRad);
  return out.set(
    x0 * co + z0 * so,
    y0,
    -x0 * so + z0 * co,
  );
}
