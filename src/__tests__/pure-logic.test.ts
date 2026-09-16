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
import { EARTH_ORBIT_RADIUS, STAR_FIELD_RADIUS_MIN, wrapAzimuth } from '../config/sceneScale';
import {
  SYSTEM_VIEW_AZIMUTH_DEG,
  SYSTEM_VIEW_ELEVATION_DEG,
  systemViewDirection,
} from '../config/camera';
import { sunDirectionFromAzEl, sunDirectionToward } from '../lighting/SunLighting';
import {
  KM_PER_UNIT,
  MOON_OWNER,
  PLANETS,
  planetMoonOrbit,
  planetMoonRadius,
  planetOrbitPeriod,
  planetOrbitRadius,
  planetRadius,
  moonPeriod,
} from '../planets/registry';
import { orbitPosition } from '../planets/orbital';
import { createOrbitRings, orientOrbitRings, ringPlaneCorrection } from '../planets/OrbitRings';

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
// System view direction — the single source of truth for the
// default load (createCamera) AND what Reset / the System button
// fly back to (systemViewPose), so the two can never disagree.
// ------------------------------------------------------------
describe('systemViewDirection (default view + Reset framing)', () => {
  const dir = systemViewDirection();
  const elev = THREE.MathUtils.degToRad(SYSTEM_VIEW_ELEVATION_DEG);
  const az = THREE.MathUtils.degToRad(SYSTEM_VIEW_AZIMUTH_DEG);
  const expected = new THREE.Vector3(
    Math.cos(elev) * Math.sin(az),
    Math.sin(elev),
    Math.cos(elev) * Math.cos(az),
  );

  it('is a unit vector at the expected 3/4 hero angle', () => {
    expect(dir.length()).toBeCloseTo(1, 9);
    expect(dir.x).toBeCloseTo(expected.x, 9);
    expect(dir.y).toBeCloseTo(expected.y, 9);
    expect(dir.z).toBeCloseTo(expected.z, 9);
  });

  it('sits at SYSTEM_VIEW_ELEVATION_DEG above the orbital plane', () => {
    // Elevation of a unit direction = asin(y), measured from the XZ plane.
    expect((Math.asin(dir.y) * 180) / Math.PI).toBeCloseTo(SYSTEM_VIEW_ELEVATION_DEG, 9);
  });

  it('is a SIDE-OFFSET tilt, not the old straight-down overhead (0,1,0)', () => {
    // The regression the user hit: Reset must never fall back to top-down.
    expect(dir.equals(new THREE.Vector3(0, 1, 0))).toBe(false);
    // It must carry a real horizontal (side) component, not just height.
    expect(Math.sqrt(dir.x * dir.x + dir.z * dir.z)).toBeGreaterThan(0.5);
    // And it must sit ABOVE the plane (y > 0) looking down at the origin.
    expect(dir.y).toBeGreaterThan(0);
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
// Planet registry invariants
// ------------------------------------------------------------
describe('planet registry', () => {
  it('lists eight planets in orbit order with positive radii and orbits', () => {
    expect(PLANETS.map((p) => p.id).join(','))
      .toBe('mercury,venus,mars,jupiter,saturn,uranus,neptune,pluto');
    for (const p of PLANETS) {
      expect(planetRadius(p)).toBeGreaterThan(0);
      // Heliocentric: every planet orbits the Sun (origin) at a radius that
      // clears its own disk in BOTH scale modes.
      expect(planetOrbitRadius(p, 'explore')).toBeGreaterThan(planetRadius(p));
      expect(planetOrbitRadius(p, 'real')).toBeGreaterThan(planetRadius(p));
      expect(Number.isFinite(p.initialOrbitAngle)).toBe(true);
    }
  });

  it('maps every moon to its owning planet', () => {
    for (const p of PLANETS) {
      for (const m of p.moons) {
        expect(MOON_OWNER[m.id]).toBe(p.id);
      }
    }
  });

  it('lists each planet’s moons in increasing orbit radius', () => {
    for (const p of PLANETS) {
      const orbits = p.moons.map((m) => m.orbitKm);
      for (let i = 1; i < orbits.length; i++) {
        expect(orbits[i]).toBeGreaterThan(orbits[i - 1]);
      }
    }
  });

  it('keeps exploration orbits outside the parent body and within a sane band', () => {
    for (const p of PLANETS) {
      for (const m of p.moons) {
        const explore = planetMoonOrbit(m, 'explore');
        expect(explore).toBeGreaterThan(planetRadius(p) * 1.2);
        expect(explore).toBeLessThanOrEqual(55);
        // Real scale = the true distance in Earth-radius units.
        expect(planetMoonOrbit(m, 'real')).toBeCloseTo(m.orbitKm / KM_PER_UNIT, 6);
      }
    }
    // Saturn-specific: all exploration orbits sit OUTSIDE the A-ring.
    const saturn = PLANETS.find((p) => p.id === 'saturn')!;
    for (const m of saturn.moons) {
      expect(planetMoonOrbit(m, 'explore')).toBeGreaterThan(saturn.ring!.outer);
    }
  });

  it('never renders a moon bigger than its planet, and floors small moons in explore mode', () => {
    for (const p of PLANETS) {
      for (const m of p.moons) {
        expect(planetMoonRadius(m, p, 'real')).toBeLessThan(planetRadius(p));
        if (m.keepTrueSize) {
          // True size, but still floored at the planet's small-moon minimum
          // (e.g. Iapetus on Saturn renders at the 0.32 floor).
          expect(planetMoonRadius(m, p, 'explore'))
            .toBeCloseTo(Math.max(m.radiusKm / KM_PER_UNIT, p.moonMinRadius), 6);
        } else {
          expect(planetMoonRadius(m, p, 'explore')).toBe(p.moonMinRadius);
        }
      }
    }
  });

  it('derives periods from the sidereal values in the active clock mode', () => {
    const phobos = PLANETS.find((p) => p.id === 'mars')!.moons[0];
    expect(moonPeriod(phobos, 'paused')).toBe(Infinity);
    expect(moonPeriod(phobos, 'realtime')).toBeCloseTo(phobos.periodDays * 86400, 6);
    expect(moonPeriod(phobos, 'visualized')).toBeCloseTo(phobos.periodDays * 25, 6);

    // Planets orbit the Sun the same way: sidereal period, clock-mode scaled.
    const mercury = PLANETS.find((p) => p.id === 'mercury')!;
    expect(planetOrbitPeriod(mercury, 'paused')).toBe(Infinity);
    expect(planetOrbitPeriod(mercury, 'realtime')).toBeCloseTo(mercury.orbitPeriodDays * 86400, 5);
    expect(planetOrbitPeriod(mercury, 'visualized')).toBeLessThan(planetOrbitPeriod(mercury, 'realtime'));
    // Kepler ordering: with the real orbit radius sorted descending, the
    // period shrinks with it.
    const byRadius = [...PLANETS].sort((a, b) => b.realOrbit - a.realOrbit);
    for (let i = 1; i < byRadius.length; i++) {
      expect(planetOrbitPeriod(byRadius[i], 'realtime'))
        .toBeLessThan(planetOrbitPeriod(byRadius[i - 1], 'realtime'));
    }
  });

  it('keeps the star shell behind the farthest real-scale body', () => {
    // The shell is the background layer: it must sit beyond EVERY body in BOTH
    // scale modes, else additive stars (which never write depth) render in
    // front of the outer moons.
    let farthestReal = 0;
    for (const p of PLANETS) {
      const orbit = planetOrbitRadius(p, 'real');
      const outerMoon = p.moons.reduce((a, m) => Math.max(a, planetMoonOrbit(m, 'real')), 0);
      const span = p.ring ? p.ring.outer : 0;
      farthestReal = Math.max(farthestReal, orbit + Math.max(outerMoon, span));
    }
    expect(STAR_FIELD_RADIUS_MIN).toBeGreaterThan(farthestReal);
  });
});

// ------------------------------------------------------------
// Orbital-plane math (inclination + ascending node)
// ------------------------------------------------------------
describe('orbitPosition', () => {
  const out = new THREE.Vector3();

  it('reduces to the legacy flat ecliptic when inclination and node are zero', () => {
    // The pre-existing convention: (r·cos a, 0, -r·sin a) in the XZ plane.
    const cases: Array<[number, [number, number, number]]> = [
      [0.0, [100, 0, 0]],
      [0.7, [100 * Math.cos(0.7), 0, -100 * Math.sin(0.7)]],
      [Math.PI / 2, [0, 0, -100]],
      [Math.PI, [-100, 0, 0]],
    ];
    for (const [a, [x, y, z]] of cases) {
      orbitPosition(a, 100, 0, 0, out);
      expectVec(out, x, y, z);
    }
  });

  it('keeps the orbit a circle of the given radius for any plane', () => {
    // A rigid rotation of a circle must preserve |p| == radius at every angle.
    for (const a of [0, 0.4, 1.1, 2.3, 3.7, 5.9]) {
      orbitPosition(a, 137, 0.12, 1.7, out);
      expect(out.length()).toBeCloseTo(137, 9);
    }
  });

  it('peaks at y = r·sin(inclination), independent of the ascending node', () => {
    const incl = 15 * (Math.PI / 180);
    orbitPosition(Math.PI / 2, 100, incl, 40 * (Math.PI / 180), out);
    expect(out.y).toBeCloseTo(100 * Math.sin(incl), 9);
    expect(out.length()).toBeCloseTo(100, 9);
  });

  it('matches the value used for the planet AND its orbit ring at the same angle', () => {
    // Same helper drives both — assert the shared math for a couple of the
    // real planet planes (degrees → radians, as the call sites do).
    const d2r = (d: number): number => (d * Math.PI) / 180;
    for (const [r, inclDeg, nodeDeg, a] of [
      [40, 7.005, 48.331, 0.3805],   // Mercury
      [2300, 17.16, 110.303, -0.5404], // Pluto (steepest)
    ] as const) {
      orbitPosition(a, r, d2r(inclDeg), d2r(nodeDeg), out);
      expect(out.length()).toBeCloseTo(r, 8);
      // Peak height of THIS plane is r·sin(incl), reached at a = π/2.
      orbitPosition(Math.PI / 2, r, d2r(inclDeg), d2r(nodeDeg), out);
      expect(out.y).toBeCloseTo(r * Math.sin(d2r(inclDeg)), 8);
    }
  });
});

// ------------------------------------------------------------
// Orbit rings (guide geometry)
// ------------------------------------------------------------
describe('orbit rings', () => {
  // computeBoundingSphere() has small numerical error that scales with the
  // radius (~float precision), so compare RELATIVELY — works for every ring.
  const expectRadiusNear = (line: THREE.LineLoop, expected: number): void => {
    line.geometry.computeBoundingSphere();
    expect(line.geometry.boundingSphere?.radius).not.toBeNull();
    expect(Math.abs((line.geometry.boundingSphere?.radius ?? NaN) - expected))
      .toBeLessThan(expected * 1e-6);
  };

  it('includes Earth\'s ecliptic ring plus one ring per registry planet', () => {
    for (const mode of ['explore', 'real'] as const) {
      const group = createOrbitRings(new THREE.Scene(), mode);
      expect(group.name).toBe('orbitRings');
      expect(group.children.length).toBe(PLANETS.length + 1);
      // Earth's ring is the flat ecliptic at EARTH_ORBIT_RADIUS in BOTH modes.
      expectRadiusNear(group.children[0] as THREE.LineLoop, EARTH_ORBIT_RADIUS);
      // Every planet ring has the radius its registry entry defines for the
      // mode, so the planet always sits exactly on its ring.
      for (let i = 0; i < PLANETS.length; i++) {
        expectRadiusNear(
          group.children[i + 1] as THREE.LineLoop,
          planetOrbitRadius(PLANETS[i], mode),
        );
      }
    }
  });

  it('ringPlaneCorrection tips a plane to contain an off-plane body', () => {
    const n = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const IDENT = new THREE.Quaternion(0, 0, 0, 1);

    // Body already in the ecliptic plane → identity (no rotation).
    for (const body of [new THREE.Vector3(600, 0, 0), new THREE.Vector3(-123.4, 0, 77.7)]) {
      expect(ringPlaneCorrection(n, body, q)).toEqual(IDENT);
    }

    // Body off-plane (any Sun azimuth/elevation) → after the rotation the
    // plane contains it, and the normal stays unit (ring radius unchanged).
    const d = new THREE.Vector3();
    for (const [az, el] of [[150, 18], [30, -60], [0, 45], [179, 89], [-90, -12]] as const) {
      sunDirectionFromAzEl(az, el, d);
      ringPlaneCorrection(n, d, q);
      const n2 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(Math.abs(n2.dot(d))).toBeLessThan(1e-9);
      expect(n2.length()).toBeCloseTo(1, 9);
    }

    // Degenerate: body on the ring axis → still ends up in the plane.
    for (const sign of [1, -1] as const) {
      ringPlaneCorrection(n, new THREE.Vector3(0, 600 * sign, 0), q);
      const n2 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(Math.abs(n2.y * sign)).toBeLessThan(1e-9);
    }
  });

  it('orients Earth\'s ring through its live position (build + per frame)', () => {
    const sunDir = new THREE.Vector3();
    sunDirectionFromAzEl(150, 18, sunDir);
    const earthBody = sunDir.clone().multiplyScalar(-EARTH_ORBIT_RADIUS);
    const group = createOrbitRings(new THREE.Scene(), 'explore', 1, earthBody);
    const ring = group.children[0] as THREE.LineLoop;

    // The ring's current plane normal (base + accumulated quaternion) must be
    // perpendicular to Earth's position — i.e. Earth lies on the ring —
    // even though the Sun elevation (18°) takes Earth out of the ecliptic.
    const n = (ring.userData.baseNormal as THREE.Vector3).applyQuaternion(ring.quaternion);
    expect(Math.abs(n.dot(earthBody))).toBeLessThan(1e-9);

    // Sun moves (Auto Sun sweep / Full Daylight) → the per-frame pass
    // re-tilts the SAME ring (no rebuild) to follow Earth.
    sunDirectionFromAzEl(200, 35, sunDir);
    earthBody.copy(sunDir).multiplyScalar(-EARTH_ORBIT_RADIUS);
    orientOrbitRings(group, [earthBody]);
    n.copy(ring.userData.baseNormal as THREE.Vector3).applyQuaternion(ring.quaternion);
    expect(Math.abs(n.dot(earthBody))).toBeLessThan(1e-9);
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