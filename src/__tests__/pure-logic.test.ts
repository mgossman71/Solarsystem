// ============================================================
// PURE-LOGIC UNIT TESTS (run with `npm test`)
// ============================================================
// No scene, no WebGL, no network — just the math and the tier policy,
// so regressions in the lighting constants, scale config, and quality
// detection are caught in CI rather than in a manual visual pass.

import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  QUALITY_PROFILES,
  detectAutoTier,
  nextTierDown,
  resolveProfile,
} from '../core/Quality';
import { STAR_FIELD_RADIUS_MIN, wrapAzimuth } from '../config/sceneScale';
import { sunDirectionFromAzEl, sunDirectionToward } from '../lighting/SunLighting';
import {
  SATURN_MOONS,
  SATURN_POSITION,
  saturnMoonOrbit,
  saturnMoonPeriod,
  saturnMoonRadius,
} from '../saturn/config';

// ---- Vector3 ≈ [x, y, z] helper (keeps the tests readable) ----
const expectVec = (v: THREE.Vector3, x: number, y: number, z: number): void => {
  expect(v.x).toBeCloseTo(x, 9);
  expect(v.y).toBeCloseTo(y, 9);
  expect(v.z).toBeCloseTo(z, 9);
};

// ------------------------------------------------------------
// Azimuth normalization
// ------------------------------------------------------------
describe('wrapAzimuth', () => {
  it('keeps values in -180..180', () => {
    expect(wrapAzimuth(0)).toBe(0);
    expect(wrapAzimuth(180)).toBe(-180);
    expect(wrapAzimuth(190)).toBe(-170);
    expect(wrapAzimuth(-190)).toBe(170);
    expect(wrapAzimuth(360)).toBe(0);
  });

  it('wraps by multiples of 360', () => {
    expect(wrapAzimuth(450)).toBe(wrapAzimuth(90));
    expect(wrapAzimuth(-450)).toBe(wrapAzimuth(-90));
  });
});

// ------------------------------------------------------------
// Sun direction math (single source of truth for all lighting)
// ------------------------------------------------------------
describe('sunDirectionFromAzEl', () => {
  const dir = (az: number, el: number): THREE.Vector3 => {
    const v = new THREE.Vector3();
    return sunDirectionFromAzEl(az, el, v);
  };

  it('maps the cardinal directions correctly', () => {
    expectVec(dir(0, 0), 1, 0, 0);
    expectVec(dir(90, 0), 0, 0, 1);
    expectVec(dir(-90, 0), 0, 0, -1);
    expectVec(dir(180, 0), -1, 0, 0);
    expectVec(dir(0, 90), 0, 1, 0);
  });

  it('always returns a unit vector', () => {
    for (const [az, el] of [[30, 45], [-120, -30], [0, 0], [179, 89]] as const) {
      expect(dir(az, el).length()).toBeCloseTo(1, 10);
    }
  });
});

describe('sunDirectionToward', () => {
  it('points from the object to the Sun', () => {
    const sun = new THREE.Vector3(600, 0, 0);
    const atOrigin = new THREE.Vector3();
    const out = new THREE.Vector3();
    sunDirectionToward(sun, atOrigin, out);
    expectVec(out, 1, 0, 0);

    const shifted = new THREE.Vector3(100, 20, -30);
    sunDirectionToward(sun, shifted, out);
    expect(out.x).toBeGreaterThan(0.99);
    expect(out.length()).toBeCloseTo(1, 10);
  });
});

// ------------------------------------------------------------
// Saturn system config invariants
// ------------------------------------------------------------
describe('Saturn moon config', () => {
  it('lists moons in increasing orbit radius (Mimas innermost, Iapetus outermost)', () => {
    const orbits = SATURN_MOONS.map((m) => m.orbitKm);
    for (let i = 1; i < orbits.length; i++) {
      expect(orbits[i]).toBeGreaterThan(orbits[i - 1]);
    }
  });

  it('keeps exploration orbits between the rings and within a sane band', () => {
    for (const m of SATURN_MOONS) {
      const explore = saturnMoonOrbit(m, 'explore');
      expect(explore).toBeGreaterThan(21.2); // outside the A-ring (21.19)
      expect(explore).toBeLessThanOrEqual(55);
      // Real scale = the true distance in Earth-radius units.
      expect(saturnMoonOrbit(m, 'real')).toBeCloseTo(m.orbitKm / 6371, 6);
    }
  });

  it('never renders a moon bigger than Saturn, and floors small moons in explore mode', () => {
    for (const m of SATURN_MOONS) {
      expect(saturnMoonRadius(m, 'real')).toBeLessThan(9.46);
      // The five small moons are floored to 0.32 in explore mode…
      if (m.id !== 'titan' && m.id !== 'iapetus') {
        expect(saturnMoonRadius(m, 'explore')).toBe(0.32);
      }
    }
  });

  it('derives periods from the sidereal values in the active clock mode', () => {
    const mimas = SATURN_MOONS[0];
    expect(saturnMoonPeriod(mimas, 'paused')).toBe(Infinity);
    expect(saturnMoonPeriod(mimas, 'realtime')).toBeCloseTo(mimas.periodDays * 86400, 6);
    expect(saturnMoonPeriod(mimas, 'visualized')).toBeCloseTo(mimas.periodDays * 25, 6);
  });

  it('keeps the star shell behind the farthest real-scale body (Iapetus)', () => {
    // The shell is the background layer: it must sit beyond EVERY body in BOTH
    // scale modes, else additive stars (which never write depth) render in
    // front of the outer moons. The farthest body is Iapetus in Real scale —
    // Saturn's centre (|SATURN_POSITION|) plus its true orbit — so the shell's
    // inner edge must clear that distance.
    const iapetus = SATURN_MOONS[SATURN_MOONS.length - 1];
    const farthestReal = SATURN_POSITION.length() + saturnMoonOrbit(iapetus, 'real');
    expect(STAR_FIELD_RADIUS_MIN).toBeGreaterThan(farthestReal);
  });
});

// ------------------------------------------------------------
// Quality tiers
// ------------------------------------------------------------
describe('quality tiers', () => {
  // jsdom has no canvas — let the probe return null (gpuRendererString
  // already handles it) instead of spewing "not implemented" on stderr.
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  it('steps down the ladder exactly once per tier, stopping at performance', () => {
    expect(nextTierDown('high')).toBe('balanced');
    expect(nextTierDown('balanced')).toBe('performance');
    expect(nextTierDown('performance')).toBeNull();
  });

  it('resolves explicit settings to the matching profile', () => {
    for (const tier of ['high', 'balanced', 'performance'] as const) {
      expect(resolveProfile(tier)).toBe(QUALITY_PROFILES[tier]);
    }
  });

  it('keeps cost monotonic down the tiers', () => {
    const [high, balanced, perf] = [QUALITY_PROFILES.high, QUALITY_PROFILES.balanced, QUALITY_PROFILES.performance];
    expect(high.pixelRatioCap).toBeGreaterThanOrEqual(balanced.pixelRatioCap);
    expect(balanced.pixelRatioCap).toBeGreaterThanOrEqual(perf.pixelRatioCap);
    expect(high.starCount).toBeGreaterThan(balanced.starCount);
    expect(balanced.starCount).toBeGreaterThan(perf.starCount);
    expect(high.bloom.enabled).toBe(true);
    expect(perf.bloom.enabled).toBe(false);
    expect(high.msaaSamples).toBeGreaterThan(0);
    expect(perf.msaaSamples).toBe(0);
  });

  // ---- detectAutoTier (jsdom; canvas has no WebGL → empty GPU string) ----
  const setNav = (props: Record<string, number>): void => {
    for (const [k, v] of Object.entries(props)) {
      Object.defineProperty(navigator, k, { value: v, configurable: true });
    }
  };

  it('does NOT downgrade a modern iPad-class device (M3/M4 "Apple GPU" regression)', () => {
    // Touch device, ≤1024px short edge → isMobile; but 9 cores / 8 GB and an
    // unidentifiable Apple GPU string → balanced, never performance.
    setNav({ maxTouchPoints: 5, hardwareConcurrency: 9, deviceMemory: 8 });
    expect(detectAutoTier()).toBe('balanced');
  });

  it('downgrades genuinely low-end touch hardware', () => {
    setNav({ maxTouchPoints: 1, hardwareConcurrency: 3, deviceMemory: 2 });
    expect(detectAutoTier()).toBe('performance');
  });

  it('gives desktops the high tier', () => {
    setNav({ maxTouchPoints: 0, hardwareConcurrency: 16, deviceMemory: 16 });
    expect(detectAutoTier()).toBe('high');
  });
});