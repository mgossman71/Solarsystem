import { describe, it, expect } from 'vitest';
import { eclipticToScene, sceneToEcliptic, type Vec3 } from '../ReferenceFrames';
import { solveKepler, heliocentricEcliptic, moonLocalPosition, barycenterMu, barycenterMoonScale } from '../OrbitalElements';
import { SimulationClock, SPEED_PRESETS } from '../SimulationClock';
import { CATALOG, planets, moonsOf, getBody } from '../CelestialCatalog';

const v = () => ({ x: 0, y: 0, z: 0 }) as Vec3;
const len = (p: Vec3) => Math.hypot(p.x, p.y, p.z);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('ReferenceFrames', () => {
  it('maps ecliptic north to scene +Y and keeps in-plane vectors horizontal', () => {
    const ax = eclipticToScene({ x: 1, y: 0, z: 0 }, v()); // +X unchanged
    expect(ax.x).toBeCloseTo(1, 12); expect(ax.y).toBeCloseTo(0, 12); expect(ax.z).toBeCloseTo(0, 12);
    const north = eclipticToScene({ x: 0, y: 0, z: 1 }, v()); // north -> up
    expect(north.x).toBeCloseTo(0, 12); expect(north.y).toBeCloseTo(1, 12); expect(north.z).toBeCloseTo(0, 12);
    expect(len(eclipticToScene({ x: 0, y: 1, z: 0 }, v()))).toBeCloseTo(1, 12); // in-plane stays in-plane
  });

  it('is an exact round-trip and preserves length', () => {
    const e = { x: 0.3, y: -0.5, z: 0.8 };
    const rt = sceneToEcliptic(eclipticToScene(e, v()), v());
    expect(rt.x).toBeCloseTo(e.x, 12);
    expect(rt.y).toBeCloseTo(e.y, 12);
    expect(rt.z).toBeCloseTo(e.z, 12);
    expect(len(rt)).toBeCloseTo(len(e), 12);
  });
});

describe('OrbitalElements — Kepler solver', () => {
  it('solves M=0 → E=0 and M=π → E=π', () => {
    expect(solveKepler(0, 0.3)).toBeCloseTo(0, 12);
    expect(solveKepler(Math.PI, 0.3)).toBeCloseTo(Math.PI, 9);
  });

  it('returns the mean anomaly for a circular orbit', () => {
    for (const M of [0.3, 1.1, 2.4, 5.5]) expect(solveKepler(M, 0)).toBeCloseTo(M, 9);
  });

  it('leaves the Kepler residual within tolerance for a high-eccentricity orbit', () => {
    const e = 0.9;
    for (const M of [0.2, 1.0, 2.2, 3.9, 5.8]) {
      const E = solveKepler(M, e);
      expect(Math.abs(M - (E - e * Math.sin(E)))).toBeLessThan(1e-9);
    }
  });
});

describe('OrbitalElements — heliocentric positions (J2000 sanity)', () => {
  const pos = (id: string, tDays: number) => heliocentricEcliptic(getBody(id)!.elements!, tDays, v());

  it('places Earth at ~1 AU and Jupiter at ~5.2 AU at the J2000 epoch', () => {
    const rEarth = len(pos('earth', 0));
    const rJupiter = len(pos('jupiter', 0));
    expect(rEarth).toBeGreaterThan(0.98);
    expect(rEarth).toBeLessThan(1.02);
    expect(rJupiter).toBeGreaterThan(4.9);
    expect(rJupiter).toBeLessThan(5.5);
  });

  it('returns to the starting point after one full orbital period (Mars)', () => {
    const el = getBody('mars')!.elements!;
    const T = (36525 * 360) / el.LDot!; // one mean year in days
    expect(dist(pos('mars', 0), pos('mars', T))).toBeLessThan(0.05);
  });

  it('keeps low-inclination planets near the ecliptic plane', () => {
    const p = pos('venus', 0);
    expect(Math.abs(p.z) / len(p)).toBeLessThan(0.06); // ~3.4° inclination
  });

  it('keeps a moon at its semi-major axis (Io)', () => {
    const m = getBody('io')!.moon!;
    expect(len(moonLocalPosition(m, 123, v()))).toBeCloseTo(m.semiMajorAxisKm, 3);
  });

  it('returns to the start after one full lunar period (Io)', () => {
    const m = getBody('io')!.moon!;
    expect(dist(moonLocalPosition(m, 0, v()), moonLocalPosition(m, m.periodDays, v()))).toBeLessThan(1e-3);
  });
});
describe('OrbitalElements — barycenter (massive moons)', () => {
  it('returns 0 / 1.0 for a classic moon (no barycenterKm → barycentre at the parent)', () => {
    const io = getBody('io')!.moon!;
    expect(io.barycenterKm).toBeUndefined();
    expect(barycenterMu(io)).toBe(0);
    expect(barycenterMoonScale(io)).toBe(1);
  });

  it('Pluto–Charon: μ ≈ 0.975 (barycentre OUTSIDE Pluto), moon scales to 1−μ, separation preserved', () => {
    const charon = getBody('charon')!.moon!;
    const mu = barycenterMu(charon);
    expect(mu).toBeCloseTo(19102 / 19596, 9); // ≈ 0.9748
    expect(mu).toBeGreaterThan(0.9);
    expect(barycenterMoonScale(charon)).toBeCloseTo(1 - mu, 12);
    // The pair's centre-to-centre separation is invariant: μ + (1−μ) = 1.
    expect(mu + barycenterMoonScale(charon)).toBeCloseTo(1, 12);
  });
});
describe('SimulationClock', () => {
  it('starts at the J2000 epoch and advances by rate × real delta', () => {
    const c = new SimulationClock(); // default: visualized @ 1 day/s
    expect(c.epochDays).toBe(0);
    c.advance(1.5);
    expect(c.epochDays).toBeCloseTo(1.5, 12);
  });

  it('freezes while paused', () => {
    const c = new SimulationClock();
    c.advance(2);
    c.setMode('paused');
    expect(c.getDaysPerSecond()).toBe(0);
    const before = c.epochDays;
    c.advance(1000);
    expect(c.epochDays).toBe(before);
    c.setMode('visualized');
    c.setVisualizedRate(1);
    c.advance(1);
    expect(c.epochDays).toBe(before + 1);
  });

  it('offers a true-rate preset and accelerated presets', () => {
    const byId = (id: string) => SPEED_PRESETS.find((p) => p.id === id)!;
    expect(byId('realtime').daysPerSecond).toBeCloseTo(1 / 86400, 12);
    expect(byId('1year').daysPerSecond).toBeGreaterThan(byId('1day').daysPerSecond);
  });

  it('applies a preset and resets to J2000', () => {
    const c = new SimulationClock();
    c.applyPreset(SPEED_PRESETS.find((p) => p.id === '1year')!);
    expect(c.getDaysPerSecond()).toBeCloseTo(365.25, 6);
    c.advance(10);
    expect(c.epochDays).toBeGreaterThan(0);
    c.reset();
    expect(c.epochDays).toBe(0);
  });
});

describe('CelestialCatalog', () => {
  it('has all 9 planets in orbital order with valid elements', () => {
    expect(planets().map((p) => p.id)).toEqual([
      'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
    ]);
    for (const p of planets()) {
      expect(p.elements, `${p.id} should have elements`).toBeTruthy();
      expect(p.elements!.a).toBeGreaterThan(0);
      expect(p.elements!.e).toBeGreaterThanOrEqual(0);
      expect(p.elements!.e).toBeLessThan(1);
    }
  });

  it('gives each planet the correct number of major moons', () => {
    expect(moonsOf('mercury').length).toBe(0);
    expect(moonsOf('venus').length).toBe(0);
    expect(moonsOf('earth').length).toBe(1);
    expect(moonsOf('mars').length).toBe(2);
    expect(moonsOf('jupiter').length).toBe(4);
    expect(moonsOf('saturn').length).toBe(7);
    expect(moonsOf('uranus').length).toBe(5);
    expect(moonsOf('neptune').length).toBe(1);
    expect(moonsOf('pluto').length).toBe(5);
  });

  it('parents every moon to an existing planet (never the Sun)', () => {
    for (const b of CATALOG) {
      if (b.parent) expect(CATALOG.some((c) => c.id === b.parent), `${b.id} parent exists`).toBe(true);
      if (b.moon) expect(b.parent).not.toBe('sun');
    }
  });

  it('encodes known special properties', () => {
    expect(getBody('triton')!.moon!.retrograde).toBe(true);
    expect(getBody('charon')!.moon!.tidallyLocked).toBe(true);
    expect(getBody('pluto')!.isDwarf).toBe(true);
    expect(getBody('earth')!.rotation.periodHours).toBeCloseTo(23.934, 2);
    expect(getBody('uranus')!.rotation.obliquityDeg).toBeGreaterThan(90);
  });
});
