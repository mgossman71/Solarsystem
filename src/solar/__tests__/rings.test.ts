// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRingGeo, RING_DEFS } from '../SolarSystem';

describe('Overview rings — procedural geometry + definitions', () => {
  it('createRingGeo is a flat annulus in the XZ plane (Y up), at the given radii', () => {
    const geo = createRingGeo(2, 4, 64);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBe(0); // flat
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      expect(r).toBeGreaterThanOrEqual(1.99);
      expect(r).toBeLessThanOrEqual(4.01);
    }
  });

  it('uses RADIAL UVs: U=0 on the inner edge, U=1 on the outer, V=0', () => {
    const geo = createRingGeo(2, 4, 64);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    let u0 = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      expect([0, 1].includes(u)).toBe(true); // only the two radial extremes
      expect(uv.getY(i)).toBe(0);
      if (u === 0) u0++;
    }
    expect(u0).toBe(uv.count / 2); // half inner, half outer
  });

  it('is a valid indexed mesh: (n+1)×2 vertices, n×6 indices, all in range', () => {
    const n = 64;
    const geo = createRingGeo(2, 4, n);
    const vcount = (n + 1) * 2;
    expect((geo.getAttribute('position') as THREE.BufferAttribute).count).toBe(vcount);
    expect((geo.getAttribute('normal') as THREE.BufferAttribute).count).toBe(vcount);
    const idx = geo.getIndex()!;
    expect(idx.count).toBe(n * 6); // n segments × 2 triangles × 3
    for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBeLessThan(vcount);
  });

  it('has an ordered, valid ring definition for every ringed giant', () => {
    for (const id of ['saturn', 'jupiter', 'uranus', 'neptune']) {
      const d = RING_DEFS[id];
      expect(d).toBeDefined();
      expect(d.inner).toBeGreaterThan(0);
      expect(d.outer).toBeGreaterThan(d.inner); // ring lies outside the planet
      expect(d.maxAlpha).toBeGreaterThan(0);
      expect(d.maxAlpha).toBeLessThanOrEqual(1);
      expect(d.tint).toHaveLength(3);
      d.bands.forEach((b) => { expect(b).toBeGreaterThan(0); expect(b).toBeLessThan(1); });
    }
  });

  it('Saturn is the most opaque ring system (visually dominant)', () => {
    for (const id of ['jupiter', 'uranus', 'neptune']) {
      expect(RING_DEFS.saturn.maxAlpha).toBeGreaterThan(RING_DEFS[id].maxAlpha);
    }
  });
});