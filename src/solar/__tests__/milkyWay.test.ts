import { describe, it, expect } from 'vitest';
import {
  sunRadiusFraction, sunSceneRadius, sunScenePosition, spiralPoint,
  SOLAR_SYSTEM_RADIUS_LY, GALAXY_RADIUS_LY,
} from '../MilkyWay';

describe('Milky Way — geometry + Solar System placement', () => {
  it('places the Sun at its true galactic radius (~26,000 ly of a ~100,000 ly galaxy)', () => {
    expect(sunRadiusFraction()).toBeCloseTo(SOLAR_SYSTEM_RADIUS_LY / GALAXY_RADIUS_LY, 6);
    // Clearly in the disc (not the core, not the very rim).
    expect(sunRadiusFraction()).toBeGreaterThan(0.4);
    expect(sunRadiusFraction()).toBeLessThan(0.7);
  });

  it('scales the Sun radius linearly with the disc radius', () => {
    expect(sunSceneRadius(100)).toBeCloseTo(52, 5); // 100 × 0.52
    expect(sunSceneRadius(620)).toBeGreaterThan(sunSceneRadius(300));
  });

  it('puts the Sun in the disc plane (y = 0), at the correct distance from the centre', () => {
    const p = sunScenePosition(100);
    expect(p.y).toBe(0);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(52, 5);
  });

  it('draws spiral arms that sweep outward and are evenly separated', () => {
    const arms = 2, scale = 100;
    const r0 = Math.hypot(spiralPoint(0, 0, arms, scale).x, spiralPoint(0, 0, arms, scale).y);
    const r1 = Math.hypot(spiralPoint(0, 1, arms, scale).x, spiralPoint(0, 1, arms, scale).y);
    expect(r1).toBeGreaterThan(r0);        // radius grows outward with t
    expect(r1).toBeCloseTo(scale, 5);      // outer edge reaches the scale radius
    // Two arms at the same t sit on opposite sides of the centre.
    const a = spiralPoint(0, 0.5, arms, scale);
    const b = spiralPoint(1, 0.5, arms, scale);
    expect(a.x * b.x + a.y * b.y).toBeLessThan(0);
  });
});