import { describe, it, expect } from 'vitest';
import {
  EDUCATIONAL_SCALE, REALISTIC_SCALE,
  orbitRadius, planetDisplayRadius, moonDisplayRadius, moonOrbitRadius,
} from '../scale';

describe('Solar System scale model', () => {
  // Semi-major axes (AU) for the nine bodies, inner → outer.
  const AU = { mercury: 0.387, venus: 0.723, earth: 1.0, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48 };

  it('preserves orbital ORDER and is monotonic in both scale models', () => {
    for (const s of [EDUCATIONAL_SCALE, REALISTIC_SCALE]) {
      let prev = -Infinity;
      for (const rAU of [AU.mercury, AU.venus, AU.earth, AU.mars, AU.jupiter, AU.saturn, AU.uranus, AU.neptune, AU.pluto]) {
        const r = orbitRadius(rAU, s);
        expect(r).toBeGreaterThan(prev);
        prev = r;
      }
    }
  });

  it('educational scale fits the whole system in a viewable range', () => {
    const earth = orbitRadius(1.0, EDUCATIONAL_SCALE);
    const pluto = orbitRadius(AU.pluto, EDUCATIONAL_SCALE);
    expect(earth).toBeGreaterThan(100);
    expect(pluto).toBeLessThan(5000); // comfortably within a normal far plane
    // The whole system spans < 15× the Earth orbit (vs ~100× at true scale).
    expect(pluto / earth).toBeLessThan(15);
  });

  it('realistic scale is true relative distance (linear in AU)', () => {
    expect(orbitRadius(1.0, REALISTIC_SCALE)).toBeCloseTo(600, 6);
    expect(orbitRadius(2.0, REALISTIC_SCALE)).toBeCloseTo(1200, 6);
    expect(orbitRadius(AU.mars, REALISTIC_SCALE)).toBeCloseTo(600 * 1.524, 3);
  });

  it('planet radii are visible, ordered, and capped', () => {
    expect(planetDisplayRadius(6371)).toBeGreaterThan(planetDisplayRadius(2439)); // Earth > Mercury
    expect(planetDisplayRadius(69911)).toBe(16); // Jupiter capped
    expect(planetDisplayRadius(2439)).toBeGreaterThanOrEqual(4); // even Mercury is tappable
    // Monotonic non-decreasing.
    expect(planetDisplayRadius(1188) <= planetDisplayRadius(3390) && planetDisplayRadius(3390) <= planetDisplayRadius(6371)).toBe(true);
  });

  it('moon radii are resolvable and ordered', () => {
    expect(moonDisplayRadius(3475)).toBeGreaterThan(moonDisplayRadius(60)); // larger moon > Phobos
    expect(moonDisplayRadius(1737)).toBeGreaterThan(moonDisplayRadius(11)); // Earth Moon > Phobos
    expect(moonDisplayRadius(2574)).toBeLessThanOrEqual(5); // within the safety cap (Titan)
    expect(moonDisplayRadius(60)).toBeGreaterThanOrEqual(1.2);
  });

  it('moon orbits are ordered by semi-major axis and span 1.6×–3.6× the planet', () => {
    const planetR = 10;
    const inner = moonOrbitRadius(planetR, 421700, 1882709); // Io
    const outer = moonOrbitRadius(planetR, 1882709, 1882709); // Callisto
    expect(outer).toBeGreaterThan(inner);
    expect(inner).toBeCloseTo(planetR * 1.6 + 2.0 * (421700 / 1882709) * planetR, 6);
    expect(outer).toBeCloseTo(planetR * 3.6, 6);
  });
});
