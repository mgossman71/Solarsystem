// ============================================================
// ASTRONOMY — ORBITAL ELEMENTS (Kepler problem)
// ============================================================
// Propagates JPL J2000 mean elements to an epoch and solves Kepler's equation
// to yield a heliocentric position in the J2000 ecliptic frame (AU).
//
//   a(t)  = a  + aDot·T        T = days since epoch / 36525 (Julian centuries)
//   M     = L(t) - ϖ(t)        mean anomaly
//   M = E - e·sinE             -> solve for E (Newton–Raphson)
//   ν     = true anomaly      -> r = a(1 - e·cosE)
//   (X,Y) = (r·cosν, r·sinν)  perifocal plane
//   then rotate by (Ω, i, ω) into the ecliptic frame  (Meeus, Astronomical
//   Algorithms; ω = argument of perihelion = ϖ - Ω).
//
// All inputs/outputs are plain numbers / {@link Vec3} — no Three.js — so the
// math is unit-testable in isolation.
// ============================================================

import type { KeplerianElements, MoonOrbitElements } from './types';
import { DEG2RAD, norm180, type Vec3 } from './ReferenceFrames';

const JULEAN_DAYS_PER_CENTURY = 36525;

/** Solve Kepler's equation M = E - e·sinE for E (radians). Newton–Raphson. */
export function solveKepler(M: number, e: number): number {
  return solveKeplerRaw(M, e);
}

/** Internal: Newton–Raphson on Kepler's equation (radians in, radians out). */
function solveKeplerRaw(M: number, e: number): number {
  // Seed: good for all e < 0.8 (Mercury 0.21, Pluto 0.25 are well inside).
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI;
  for (let i = 0; i < 64; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  return E;
}

/** True anomaly ν (radians) from eccentric anomaly E (radians) and e. */
export function trueAnomalyFromEccentric(E: number, e: number): number {
  return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e);
}

/**
 * Heliocentric position of a planet, in the J2000 ecliptic frame, in AU.
 * @param el      JPL J2000 mean elements (+ secular rates).
 * @param tDays   days since the element epoch (0 = J2000.0 for the standard set).
 * @param out     receives the result (ecliptic x,y,z in AU; z_e = north).
 */
export function heliocentricEcliptic(el: KeplerianElements, tDays: number, out: Vec3): Vec3 {
  const T = tDays / JULEAN_DAYS_PER_CENTURY;
  const a = el.a + (el.aDot ?? 0) * T;
  const e = el.e + (el.eDot ?? 0) * T;
  const iDeg = el.i + (el.iDot ?? 0) * T;
  const L = el.L + (el.LDot ?? 0) * T;
  const varpi = el.varpi + (el.varpiDot ?? 0) * T;
  const Omega = el.Omega + (el.OmegaDot ?? 0) * T;

  const M = (norm180(L - varpi)) * DEG2RAD;
  const E = solveKeplerRaw(M, e);
  const nu = trueAnomalyFromEccentric(E, e);
  const r = a * (1 - e * Math.cos(E));

  const X = r * Math.cos(nu);
  const Y = r * Math.sin(nu);

  const omega = (el.varpi - el.Omega) * DEG2RAD; // argument of perihelion
  const i = iDeg * DEG2RAD;
  const OmegaR = Omega * DEG2RAD;

  const cO = Math.cos(OmegaR), sO = Math.sin(OmegaR);
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const ci = Math.cos(i), si = Math.sin(i);

  // Perifocal -> ecliptic (Meeus).
  const px = cO * cw - sO * sw * ci;
  const py = sO * cw + cO * sw * ci;
  const pz = sw * si;
  const qx = cO * sw + sO * cw * ci;
  const qy = sO * sw - cO * cw * ci;
  const qz = cw * si;

  out.x = px * X + qx * Y;
  out.y = py * X + qy * Y;
  out.z = pz * X + qz * Y;
  return out;
}

/**
 * Position of a moon relative to its parent planet, in the ecliptic frame, in km.
 *
 * Simplified circular inclined orbit (mean elements): the in-plane angle is the
 * mean longitude λ(t); the plane is tilted by inclination `i` about a node line
 * at longitude `Ω`. An inclination > 90° (e.g. Triton, 156.8°) naturally encodes
 * a retrograde orbit, so no separate direction flip is needed — the `retrograde`
 * flag is kept in the catalog as descriptive metadata.
 *
 * @param m       moon orbit elements.
 * @param tDays   days since J2000.0 (advance the parent's frame too, in the renderer).
 * @param out     receives the result (km, ecliptic frame).
 */
export function moonLocalPosition(m: MoonOrbitElements, tDays: number, out: Vec3): Vec3 {
  const theta = (m.meanLongitudeDeg + 360 * (tDays / m.periodDays)) * DEG2RAD;
  const i = m.inclinationDeg * DEG2RAD;
  const O = m.nodeDeg * DEG2RAD;
  const cO = Math.cos(O), sO = Math.sin(O);
  const ci = Math.cos(i), si = Math.sin(i);
  const ct = Math.cos(theta), st = Math.sin(theta);
  out.x = m.semiMajorAxisKm * (cO * ct - sO * st * ci);
  out.y = m.semiMajorAxisKm * (sO * ct + cO * st * ci);
  out.z = m.semiMajorAxisKm * (st * si);
  return out;
}

// ---- Barycenter (massive moons: Pluto–Charon) -----------------------------
/**
 * Barycenter mass ratio μ = r_bary / a — the fraction of the moon's orbital
 * radius that the PARENT's centre sits on the far side of the pair's
 * barycentre (Pluto–Charon: 19,102 / 19,596 ≈ 0.975 — the barycentre lies
 * OUTSIDE Pluto's surface, so both bodies genuinely orbit the shared point).
 * Returns 0 for a classic moon (barycenter at the parent's centre), so callers
 * can apply the same code path uniformly.
 */
export function barycenterMu(m: MoonOrbitElements): number {
  const r = m.barycenterKm;
  if (!r || r <= 0 || m.semiMajorAxisKm <= 0) return 0;
  return Math.min(1, r / m.semiMajorAxisKm);
}

/** Moon's position-scale relative to the barycentre: (1 − μ). The parent's
 *  offset is −μ on the same line — together the pair's separation is preserved
 *  exactly (μ + (1−μ) = 1), only the reference point moves. */
export function barycenterMoonScale(m: MoonOrbitElements): number {
  return 1 - barycenterMu(m);
}
