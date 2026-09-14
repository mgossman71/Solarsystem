import { describe, it, expect } from 'vitest';
import {
  systemPlanetRadius, systemMoonRadius, systemMoonOrbit, systemDisplayName,
} from '../PlanetSystem';
import { planetDisplayRadius, moonDisplayRadius, moonOrbitRadius } from '../scale';
import { getBody, moonsOf } from '../../astronomy/CelestialCatalog';

describe('PlanetSystem pure helpers (deep per-planet view)', () => {
  it('systemPlanetRadius reuses the overview sizing — capped at 16, monotonic', () => {
    // Exact delegation to the shared scale (bit-identical).
    expect(systemPlanetRadius(6371)).toBe(planetDisplayRadius(6371));
    expect(systemPlanetRadius(69911)).toBe(planetDisplayRadius(69911));
    // Within the documented [4, 16] band, capped for the giants.
    expect(systemPlanetRadius(6371)).toBeGreaterThanOrEqual(4);   // Earth
    expect(systemPlanetRadius(6371)).toBeLessThanOrEqual(16);
    expect(systemPlanetRadius(69911)).toBe(16);                    // Jupiter (capped)
    // Monotonic: a bigger planet never renders smaller.
    expect(systemPlanetRadius(69911)).toBeGreaterThanOrEqual(systemPlanetRadius(6371));
  });

  it('systemMoonRadius is small but resolvable (within [1.2, 5])', () => {
    expect(systemMoonRadius(2634.1)).toBe(moonDisplayRadius(2634.1)); // Ganymede
    const r = systemMoonRadius(2634.1);
    expect(r).toBeGreaterThanOrEqual(1.2);
    expect(r).toBeLessThanOrEqual(5);
    expect(systemMoonRadius(1188.3)).toBeLessThanOrEqual(r);          // smaller moon → smaller
  });

  it('systemMoonOrbit orders inner→outer and stays in the 1.6×–3.6× band', () => {
    const planetR = 12;
    const inner = systemMoonOrbit(planetR, 100_000, 500_000);
    const outer = systemMoonOrbit(planetR, 500_000, 500_000);
    expect(outer).toBe(moonOrbitRadius(planetR, 500_000, 500_000));
    expect(outer).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThanOrEqual(planetR * 1.6 - 1e-9);
    expect(outer).toBeLessThanOrEqual(planetR * 3.6 + 1e-9);
  });

  it('systemDisplayName flags Pluto as a dwarf planet; leaves others clean', () => {
    expect(systemDisplayName('pluto')).toContain('Dwarf Planet');
    expect(systemDisplayName('earth')).toBe('Earth');
    expect(systemDisplayName('jupiter')).toBe('Jupiter');
  });

  it('knows which planets own which moons (Mercury/Venus none; Jupiter four)', () => {
    expect(moonsOf('mercury').length).toBe(0);
    expect(moonsOf('venus').length).toBe(0);
    expect(moonsOf('jupiter').map((m) => m.id)).toEqual(
      expect.arrayContaining(['io', 'europa', 'ganymede', 'callisto']),
    );
    expect(getBody('pluto')?.isDwarf).toBe(true);
    // Every Jupiter moon carries real orbital elements (drives the deep view).
    for (const m of moonsOf('jupiter')) {
      expect(m.moon?.semiMajorAxisKm).toBeGreaterThan(0);
      expect(m.moon?.periodDays).toBeGreaterThan(0);
    }
  });
});
