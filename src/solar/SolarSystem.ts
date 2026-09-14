// ============================================================
// SOLAR — SOLAR SYSTEM VIEW (render + navigate the full system)
// ============================================================
// A self-contained Three.js subsystem that renders ALL planets + major moons
// from the centralized catalog, driven by the authoritative SimulationClock
// and the JPL ephemeris (no per-body timers). It uses the documented
// educational scale so the whole system is readable, preserves every orbit's
// true shape/direction, and provides contextual navigation (focus a planet,
// then its moons; speed presets; real-time; reset). It owns its own DOM panel
// and camera tween so the host app (EarthScene) only needs to show/hide it.
//
//   new SolarSystem(scene, camera, controls)  → .group (add to scene)
//   .update(dtSeconds)                          → advance clock + reposition
//   .focusBody(id) / .focusMoon(id)             → frame the camera
//   .dispose()                                  → remove meshes, lights, panel
//
// All planets/moons use MeshStandardMaterial lit by a point light at the Sun,
// so every body shows a correct day/night side facing the light.
// ============================================================

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { planets, moonsOf, getBody } from '../astronomy/CelestialCatalog';
import { heliocentricEcliptic, moonLocalPosition, barycenterMoonScale } from '../astronomy/OrbitalElements';
import { eclipticToScene, type Vec3 } from '../astronomy/ReferenceFrames';
import type { CelestialBody, MoonOrbitElements } from '../astronomy/types';
import { SimulationClock, SPEED_PRESETS } from '../astronomy/SimulationClock';
import {
  EDUCATIONAL_SCALE, REALISTIC_SCALE, ScaleParams,
  planetDisplayRadius, moonDisplayRadius, moonOrbitRadius, orbitRadius, oblateness,
} from './scale';

// ---- Base albedo colors: the honest FALLBACK shown when a real texture is
//     missing or its lazy load fails. Real equirectangular maps (catalog
//     `textures.body`) are swapped in over these by loadBodyTexture(). ----
const PLANET_COLORS: Record<string, number> = {
  mercury: 0x9c8e82, venus: 0xe6c78a, earth: 0x2f6fd0, mars: 0xc1552e,
  jupiter: 0xd8b98c, saturn: 0xe3cf9e, uranus: 0xaadfe6, neptune: 0x3b5bdb, pluto: 0xc3a58a,
};
const MOON_COLORS: Record<string, number> = {
  moon: 0xbfbfbf, phobos: 0x6b5d52, deimos: 0x7a6e62, io: 0xe0c85a, europa: 0xd8d4cc,
  ganymede: 0xa89a86, callisto: 0x6f655a, titan: 0xd6a24a, iapetus: 0x8a7a6a,
  triton: 0xc8c8d6, charon: 0x8a7f86,
};
export function colorFor(id: string): number {
  return PLANET_COLORS[id] ?? MOON_COLORS[id] ?? 0x9a9a9a;
}

/** UI label for a body — appends "— Dwarf Planet" for Pluto (accurate labeling). */
function displayName(id: string): string {
  const b = getBody(id);
  return (b?.name ?? id) + (b?.isDwarf ? ' — Dwarf Planet' : '');
}

/** Shared lazy texture loader (real equirectangular maps; the flat color above
 *  is the honest fallback if an asset is missing/fails — never fake geography). */
const textureLoader = new THREE.TextureLoader();

// ---- Rings (overview). A real ring image supersedes the procedural strip when
//     one exists; these cover the ringed giants whose ring imagery is pending.
/** Per-planet ring appearance: radial extents (× display radius), icy tint,
 *  peak alpha, and bright-band centers (fraction 0–1 from inner→outer edge). */
export const RING_DEFS: Record<string, {
  inner: number; outer: number; tint: [number, number, number]; maxAlpha: number; bands: number[];
}> = {
  saturn:  { inner: 1.45, outer: 2.35, tint: [224, 205, 168], maxAlpha: 0.8, bands: [0.18, 0.42, 0.58, 0.8] },
  jupiter: { inner: 1.3,  outer: 1.72, tint: [150, 140, 120], maxAlpha: 0.3, bands: [0.55, 0.78] },
  uranus:  { inner: 1.5,  outer: 2.3,  tint: [150, 212, 226], maxAlpha: 0.42, bands: [0.5, 0.75, 0.92] },
  neptune: { inner: 1.5,  outer: 2.5,  tint: [88, 120, 232],  maxAlpha: 0.5,  bands: [0.45, 0.66, 0.82, 0.98] },
};

/** Flat annulus in the XZ plane (Y up) with RADIAL UVs — U runs 0→1 from inner
 *  to outer radius — so a 1-D radial band strip maps as concentric rings. Same
 *  convention as the dedicated Saturn ring. */
export function createRingGeo(innerR: number, outerR: number, segments = 128): THREE.BufferGeometry {
  const n = segments;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const normals = new Float32Array((n + 1) * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const base = i * 2;
    positions[base * 3] = innerR * c; positions[base * 3 + 1] = 0; positions[base * 3 + 2] = innerR * s;
    positions[(base + 1) * 3] = outerR * c; positions[(base + 1) * 3 + 1] = 0; positions[(base + 1) * 3 + 2] = outerR * s;
    uvs[base * 2] = 0; uvs[base * 2 + 1] = 0;
    uvs[(base + 1) * 2] = 1; uvs[(base + 1) * 2 + 1] = 0;
    normals[base * 3 + 1] = 1; normals[(base + 1) * 3 + 1] = 1;
    if (i < n) indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/** Procedural radial ring banding — a 512×4 strip where x = inner→outer
 *  fraction, a few soft gaussian bright bands with soft inner/outer fades. */
export function makeRadialRingTexture(tint: [number, number, number], maxAlpha: number, bands: number[]): THREE.CanvasTexture {
  const W = 512, H = 4;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const f = x / (W - 1);
    const edge = Math.min(1, f / 0.08, (1 - f) / 0.1); // soft fades at both edges
    let a = 0.06;
    for (const b of bands) a += Math.exp(-Math.pow((f - b) / 0.035, 2));
    a = Math.min(maxAlpha, a) * edge;
    for (let y = 0; y < H; y++) {
      const idx = (y * W + x) * 4;
      img.data[idx] = tint[0]; img.data[idx + 1] = tint[1]; img.data[idx + 2] = tint[2];
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return tex;
}

const SUN_RADIUS_UNITS = 30;
const _ecl: Vec3 = { x: 0, y: 0, z: 0 };
const _s: Vec3 = { x: 0, y: 0, z: 0 };

// Radial compression: preserves the ephemeris DIRECTION, scales the radius.
const _dir: Vec3 = { x: 0, y: 0, z: 0 };
function radialToScene(ecl: Vec3, scale: ScaleParams, out: Vec3): Vec3 {
  const r = Math.hypot(ecl.x, ecl.y, ecl.z);
  if (r <= 0) { out.x = out.y = out.z = 0; return out; }
  const s = orbitRadius(r, scale);
  const e = eclipticToScene({ x: ecl.x / r, y: ecl.y / r, z: ecl.z / r }, _dir);
  out.x = e.x * s; out.y = e.y * s; out.z = e.z * s;
  return out;
}

interface MoonNode { id: string; mesh: THREE.Mesh; orbitR: number; el: MoonOrbitElements }
interface PlanetNode {
  id: string; group: THREE.Group; mesh: THREE.Mesh; displayR: number;
  /** Planet + ring core — moves as one (it wobbles around the pair's
   *  barycentre for Pluto; sits at the group origin for every other planet). */
  core: THREE.Group;
  periodDays: number; spinRate: number; moons: MoonNode[];
}

interface CameraTween {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
  t: number; duration: number;
}

export class SolarSystem {
  /** Root group — add to the host scene. */
  readonly group: THREE.Group;
  /** The single authoritative time source (days since J2000.0). */
  readonly clock: SimulationClock;
  /** Active scale model (educational by default; realistic on toggle). */
  scale: ScaleParams = EDUCATIONAL_SCALE;

  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private planets: PlanetNode[] = [];
  private orbitLines: THREE.LineLoop[] = [];
  private pickables: THREE.Mesh[] = [];
  private meshToId = new Map<THREE.Mesh, string>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tween: CameraTween | null = null;
  private panel: HTMLElement | null = null;
  private ac = new AbortController();
  private disposed = false;
  private loadedTextures: THREE.Texture[] = [];
  /** Optional host callback for the "Exit" button (leave Solar System mode). */
  onExit: (() => void) | null = null;
  /** Optional host callback for "🔭 Enter system" — open a planet's dedicated
   *  system view (its moons, up close). Receives the planet id. */
  onEnterSystem: ((planetId: string) => void) | null = null;
  /** Optional host callback for "🌌 Milky Way" — go up to the galaxy view. */
  onEnterGalaxy: (() => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, clock?: SimulationClock) {
    this.camera = camera;
    this.controls = controls;
    // Shared host clock keeps the same simulated epoch across overview ↔
    // planet systems (no J2000 reset when you drill in and back out).
    this.clock = clock ?? new SimulationClock({ mode: 'visualized', daysPerSecond: 7 }); // 1 week/s default
    this.group = new THREE.Group();
    this.group.name = 'SolarSystem';
    this.group.visible = false;
    scene.add(this.group);
    this.build();
    this.bindPicking();
    this.buildPanel();
  }
  private build(): void {
    // Point-source Sun light (decay 0 = constant) + faint ambient → every body
    // shows a correct day/night side facing the light.
    const sun = new THREE.PointLight(0xffffff, 3.4, 0, 0);
    sun.position.set(0, 0, 0);
    this.group.add(sun);
    this.group.add(new THREE.AmbientLight(0x2a2a33, 0.65));

    // Visible Sun disk (emissive; not affected by the light).
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS_UNITS, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    );
    sunMesh.name = 'Sun';
    this.group.add(sunMesh);

    for (const planet of planets()) {
      this.planets.push(this.buildPlanet(planet));
      this.orbitLines.push(this.orbitGuide(planet));
    }
  }

  /** Sample the true ephemeris over one period → a faithfully-shaped (but
   *  radially compressed) orbit guide in the root frame. */
  private orbitGuide(planet: CelestialBody): THREE.LineLoop {
    const el = planet.elements!;
    const period = (36525 * 360) / el.LDot!;
    const N = 180;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const ecl = heliocentricEcliptic(el, (i / N) * period, _ecl);
      const s = radialToScene(ecl, this.scale, _s);
      pts.push(new THREE.Vector3(s.x, s.y, s.z));
    }
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: colorFor(planet.id), transparent: true, opacity: 0.26 }),
    );
    this.group.add(line);
    return line;
  }

  private buildPlanet(planet: CelestialBody): PlanetNode {
    const displayR = planetDisplayRadius(planet.radiusKm);
    const periodDays = (36525 * 360) / planet.elements!.LDot!;
    const group = new THREE.Group();
    group.name = planet.name;
    // The core (planet + rings) is a subgroup: for Pluto–Charon it wobbles
    // around the system's barycentre (the group origin) while Charon orbits
    // the other side; for every other planet it simply sits at the origin.
    const core = new THREE.Group();
    group.add(core);

    const planetMat = new THREE.MeshStandardMaterial({ color: colorFor(planet.id), roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(displayR, 48, 32), planetMat);
    this.loadBodyTexture(planet.textures?.body, planetMat);
    mesh.name = planet.name;
    // True polar oblateness (gas/ice giants): f = 1 − r_p/r_eq.
    const f = oblateness(planet);
    if (f > 0) mesh.scale.y = 1 - f;
    core.add(mesh);
    this.pickables.push(mesh);
    this.meshToId.set(mesh, planet.id);
    // Period-aware, retrograde-aware spin (relative rates preserved, readably
    // slowed for the overview). Venus/Uranus spin backwards; gas giants faster.
    const rotH = planet.rotation?.periodHours ?? 24;
    const retro = rotH < 0 ? -1 : 1;
    const spinRate = retro * 0.12 * Math.min(3, Math.max(0.15, 24 / Math.abs(rotH)));

    // Rings where applicable. A radial banding strip (soft gaussian bands with
    // soft edge fades) is generated per planet — a real ring image supersedes it
    // when one becomes available. Uranus's near-vertical tilt comes from its
    // ~98° obliquity (see RING_DEFS + the rotation below).
    if (planet.hasRings) {
      const def = RING_DEFS[planet.id] ?? {
        inner: 1.45, outer: 2.0, tint: [200, 200, 200] as [number, number, number],
        maxAlpha: 0.4, bands: [0.6],
      };
      const ringTex = makeRadialRingTexture(def.tint, def.maxAlpha, def.bands);
      const ring = new THREE.Mesh(
        createRingGeo(displayR * def.inner, displayR * def.outer),
        new THREE.MeshStandardMaterial({
          map: ringTex,
          side: THREE.DoubleSide, transparent: true, roughness: 0.9, metalness: 0,
        }),
      );
      ring.rotation.x = Math.PI / 2 - (planet.rotation?.obliquityDeg ?? 0) * Math.PI / 180;
      core.add(ring);
      this.loadedTextures.push(ringTex); // CanvasTexture — dispose with the rest
    }

    // Moons (each on its own local orbit, driven by moonLocalPosition).
    const moons = moonsOf(planet.id);
    const maxA = moons.reduce((m, x) => Math.max(m, x.moon!.semiMajorAxisKm), 0);
    const moonNodes: MoonNode[] = [];
    for (const moon of moons) {
      const mR = moonDisplayRadius(moon.radiusKm);
      const orbitR = moonOrbitRadius(displayR, moon.moon!.semiMajorAxisKm, maxA);
      const mMat = new THREE.MeshStandardMaterial({ color: colorFor(moon.id), roughness: 0.95, metalness: 0 });
      const mMesh = new THREE.Mesh(new THREE.SphereGeometry(mR, 24, 16), mMat);
      this.loadBodyTexture(moon.textures?.body, mMat);
      mMesh.name = moon.name;
      group.add(mMesh);
      this.pickables.push(mMesh);
      this.meshToId.set(mMesh, moon.id);
      moonNodes.push({ id: moon.id, mesh: mMesh, orbitR, el: moon.moon! });
    }

    this.group.add(group);
    return { id: planet.id, group, mesh, core, displayR, periodDays, spinRate, moons: moonNodes };
  }

  /** Lazily swap a real equirectangular map into a body's material. If the
   *  asset is missing or the load fails, the flat albedo color remains (an
   *  honest placeholder — never fake geography). Tracks the texture for disposal. */
  private loadBodyTexture(url: string | undefined, mat: THREE.MeshStandardMaterial): void {
    if (!url) return;
    textureLoader.load(
      url,
      (tex) => {
        if (this.disposed) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat.map = tex;
        mat.color.set(0xffffff); // show true imagery, don't tint
        mat.needsUpdate = true;
        this.loadedTextures.push(tex);
      },
      undefined,
      () => { /* keep the flat-color placeholder */ },
    );
  }
  // ------------------------------------------------------------------
  // TIME + MOTION
  // ------------------------------------------------------------------
  update(dtSeconds: number): void {
    if (this.disposed || !this.group.visible) return;
    this.clock.advance(dtSeconds); // single authoritative time source
    const t = this.clock.epochDays;
    for (const p of this.planets) {
      const ecl = heliocentricEcliptic(getBody(p.id)!.elements!, t, _ecl);
      const s = radialToScene(ecl, this.scale, _s);
      // The GROUP (hence its barycentre) is on the true system orbit; the
      // planet core wobbles around it by −μ·r when the moon is massive.
      p.group.position.set(s.x, s.y, s.z);
      p.core.position.set(0, 0, 0);
      p.mesh.rotation.y += dtSeconds * p.spinRate; // period/retrograde-aware spin (fps-independent)
      for (const m of p.moons) {
        const lp = moonLocalPosition(m.el, t, _ecl);
        const n = Math.hypot(lp.x, lp.y, lp.z) || 1;
        const u = { x: lp.x / n, y: lp.y / n, z: lp.z / n };
        const moonS = barycenterMoonScale(m.el); // 1.0 for a classic moon
        const mx = u.x * m.orbitR * moonS, my = u.y * m.orbitR * moonS, mz = u.z * m.orbitR * moonS;
        m.mesh.position.set(mx, my, mz);
        if (moonS < 1) {
          // Parent on the far side of the barycentre: −(1 − moonS)·(u·orbitR).
          const k = (1 - moonS) * m.orbitR;
          p.core.position.set(-u.x * k, -u.y * k, -u.z * k);
        }
        // Tidally locked: keep the same face toward the PARENT (at the core),
        // not toward the origin — identical for a classic moon (core at 0,0,0).
        if (m.el.tidallyLocked) m.mesh.rotation.y = Math.atan2(-mx, -mz);
      }
    }
    this.stepTween(dtSeconds);
  }

  // ------------------------------------------------------------------
  // NAVIGATION
  // ------------------------------------------------------------------
  planetIds(): string[] { return this.planets.map((p) => p.id); }
  moonIdsOf(planetId: string): string[] {
    return this.planets.find((p) => p.id === planetId)?.moons.map((m) => m.id) ?? [];
  }

  focusBody(id: string): void {
    const node = this.planets.find((p) => p.id === id);
    if (node) this.tweenTo(node.group.position, Math.max(node.displayR * 3.4, 60));
  }
  focusMoon(id: string): void {
    for (const p of this.planets) {
      const m = p.moons.find((x) => x.id === id);
      if (m) { this.tweenTo(m.mesh.getWorldPosition(new THREE.Vector3()), 14); return; }
    }
  }
  /** Pull back to a high overhead view of the whole system (scale-aware). */
  overview(): void {
    const extent = this.systemExtent();
    this.tweenTo(new THREE.Vector3(0, 0, 0), extent * 1.6, new THREE.Vector3(0.5, 1, 0.35));
  }
  /** Farthest a planet can be from the Sun under the active scale (units). */
  systemExtent(): number {
    let max = 0;
    for (const p of this.planets) max = Math.max(max, orbitRadius(getBody(p.id)!.elements!.a, this.scale));
    return max;
  }

  private tweenTo(target: THREE.Vector3, distance: number, dirHint?: THREE.Vector3): void {
    const toTgt = target.clone();
    const dir = (dirHint ?? this.camera.position.clone().sub(this.controls.target)).normalize();
    const toPos = toTgt.clone().add(dir.multiplyScalar(distance));
    this.tween = {
      fromPos: this.camera.position.clone(), toPos,
      fromTgt: this.controls.target.clone(), toTgt, t: 0, duration: 0.7,
    };
  }
  private stepTween(dt: number): void {
    if (!this.tween) return;
    this.tween.t += dt;
    const k = Math.min(1, this.tween.t / this.tween.duration);
    const e = k * k * (3 - 2 * k); // smoothstep
    this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e);
    this.controls.target.lerpVectors(this.tween.fromTgt, this.tween.toTgt, e);
    if (k >= 1) this.tween = null;
  }

  // ------------------------------------------------------------------
  // PICKING (click a planet or moon to focus it)
  // ------------------------------------------------------------------
  private bindPicking(): void {
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.addEventListener('pointerdown', this.onPointerDown, { signal: this.ac.signal });
  }
  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.group.visible) return;
    const c = (ev.target as HTMLElement) ?? (document.querySelector('canvas') as HTMLCanvasElement | null);
    if (!c) return;
    const rect = c.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    if (hits.length) {
      const id = this.meshToId.get(hits[0].object as THREE.Mesh);
      if (id) this.onPick(id);
    }
  };
  private onPick(id: string): void {
    const body = getBody(id);
    if (!body) return;
    if (body.moon) this.focusMoon(id);
    else { this.focusBody(id); this.syncMoonPicker(id); }
  }

  // ------------------------------------------------------------------
  // CONTROLS (time, scale)
  // ------------------------------------------------------------------
  applyPreset(key: string): void {
    const p = SPEED_PRESETS.find((x) => x.id === key);
    if (p) this.clock.applyPreset(p);
  }
  /** Last non-paused mode, so pause → resume restores the shared clock's
   *  real state instead of clobbering it (realtime ↔ visualized). */
  private lastNonPausedMode: 'realtime' | 'visualized' = 'visualized';
  setPaused(paused: boolean): void {
    if (paused) {
      if (this.clock.mode !== 'paused') {
        this.lastNonPausedMode = this.clock.mode;
        this.clock.setMode('paused');
      }
    } else if (this.clock.mode === 'paused') {
      this.clock.setMode(this.lastNonPausedMode);
    }
  }
  isPaused(): boolean { return this.clock.mode === 'paused'; }
  /** Toggle educational ↔ realistic distance scale. Returns true if now realistic. */
  toggleScale(): boolean {
    const realistic = this.scale === REALISTIC_SCALE;
    this.scale = realistic ? EDUCATIONAL_SCALE : REALISTIC_SCALE;
    this.rebuildOrbits();
    return !realistic;
  }
  private rebuildOrbits(): void {
    for (const line of this.orbitLines) {
      this.group.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.orbitLines = [];
    for (const p of this.planets) this.orbitLines.push(this.orbitGuide(getBody(p.id)!));
  }
  // ------------------------------------------------------------------
  // UI PANEL (self-contained; removed on dispose)
  // ------------------------------------------------------------------
  private buildPanel(): void {
    const el = document.createElement('div');
    el.className = 'solar-panel';
    el.style.cssText = [
      'position:fixed', 'top:16px', 'left:16px', 'z-index:40',
      'width:220px', 'padding:14px 16px', 'border-radius:14px',
      'background:rgba(10,14,22,0.82)', 'backdrop-filter:blur(10px)',
      'border:1px solid rgba(255,255,255,0.12)', 'color:#e6e6ee',
      'font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    ].join(';');
    el.innerHTML = [
      '<div style="font-weight:600;font-size:14px;margin-bottom:10px">Solar System</div>',
      '<div style="margin-bottom:8px"><div style="opacity:.7;margin-bottom:2px">Body</div>',
      '<select data-role="body" style="width:100%"></select></div>',
      '<div style="margin-bottom:8px"><div style="opacity:.7;margin-bottom:2px">Moon</div>',
      '<select data-role="moon" disabled style="width:100%"></select></div>',
      '<div style="margin-bottom:10px"><div style="opacity:.7;margin-bottom:2px">Speed</div>',
      '<select data-role="speed" style="width:100%"></select></div>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">',
      '<button data-role="pause">Pause</button>',
      '<button data-role="scale">Realistic</button>',
      '<button data-role="overview">Overview</button>',
      '<button data-role="system">🔭 Enter system</button>',
      '<button data-role="galaxy" style="grid-column:1/-1;background:#1a3358">🌌 Milky Way</button>',
      '<button data-role="exit" style="grid-column:1/-1">Exit</button>',
      '</div>',
      '<div style="opacity:.5;font-size:11px;margin-top:10px">',
      'Positions: JPL ephemeris (J2000). Planets/moons not to true size.',
      '</div>',
    ].join('');
    document.body.appendChild(el);
    this.panel = el;

    const opts = (sel: string) => el.querySelector(sel) as HTMLSelectElement;
    const body = opts('select[data-role="body"]');
    const moon = opts('select[data-role="moon"]');
    const speed = opts('select[data-role="speed"]');

    body.appendChild(new Option('Whole system', 'system'));
    for (const p of this.planets) body.appendChild(new Option(displayName(p.id), p.id));
    body.addEventListener('change', () => {
      if (body.value === 'system') { this.overview(); this.syncMoonPicker(null); return; }
      this.focusBody(body.value);
      this.syncMoonPicker(body.value);
    }, { signal: this.ac.signal });

    moon.addEventListener('change', () => { if (moon.value) this.focusMoon(moon.value); }, { signal: this.ac.signal });

    for (const pr of SPEED_PRESETS) speed.appendChild(new Option(pr.label, pr.id));
    speed.value = '1week';
    speed.addEventListener('change', () => this.applyPreset(speed.value), { signal: this.ac.signal });

    const pauseBtn = el.querySelector('button[data-role="pause"]') as HTMLButtonElement;
    pauseBtn.addEventListener('click', () => {
      const next = !this.isPaused();
      this.setPaused(next);
      pauseBtn.textContent = next ? 'Resume' : 'Pause';
    }, { signal: this.ac.signal });

    const scaleBtn = el.querySelector('button[data-role="scale"]') as HTMLButtonElement;
    scaleBtn.addEventListener('click', () => {
      scaleBtn.textContent = this.toggleScale() ? 'Educational' : 'Realistic';
    }, { signal: this.ac.signal });

    (el.querySelector('button[data-role="overview"]') as HTMLButtonElement)
      .addEventListener('click', () => this.overview(), { signal: this.ac.signal });
    if (this.onEnterSystem) {
      // Open a dedicated per-planet system view (its moons, up close). Uses the
      // currently-selected body, defaulting to Jupiter (the richest moon system).
      (el.querySelector('button[data-role="system"]') as HTMLButtonElement)
        .addEventListener('click', () => {
          const sel = body.value;
          this.onEnterSystem!((sel && sel !== 'system') ? sel : 'jupiter');
        }, { signal: this.ac.signal });
    }
    if (this.onEnterGalaxy) {
      (el.querySelector('button[data-role="galaxy"]') as HTMLButtonElement)
        .addEventListener('click', this.onEnterGalaxy, { signal: this.ac.signal });
    }
    if (this.onExit) {
      (el.querySelector('button[data-role="exit"]') as HTMLButtonElement)
        .addEventListener('click', this.onExit, { signal: this.ac.signal });
    }
    this.syncTimeUI(); // reflect a shared host clock's existing state
  }

  /** Mirror the clock's live state into the panel (speed select + pause label)
   *  — matters when a shared host clock carries state across views. */
  private syncTimeUI(): void {
    const speed = this.panel?.querySelector('select[data-role="speed"]') as HTMLSelectElement | null;
    if (speed) {
      if (this.clock.mode === 'realtime') {
        speed.value = 'realtime';
      } else {
        const p = SPEED_PRESETS.find((x) => x.id !== 'realtime' && Math.abs(x.daysPerSecond - this.clock.visualizedDaysPerSecond) < 1e-9);
        if (p) speed.value = p.id;
      }
    }
    const pauseBtn = this.panel?.querySelector('button[data-role="pause"]') as HTMLButtonElement | null;
    if (pauseBtn) pauseBtn.textContent = this.isPaused() ? 'Resume' : 'Pause';
  }

  private syncMoonPicker(planetId: string | null): void {
    const el = this.panel?.querySelector('select[data-role="moon"]') as HTMLSelectElement | null;
    if (!el) return;
    const ids = planetId ? this.moonIdsOf(planetId) : [];
    el.innerHTML = '';
    if (!ids.length) { el.disabled = true; el.appendChild(new Option('—', '')); return; }
    el.disabled = false;
    for (const id of ids) el.appendChild(new Option(getBody(id)?.name ?? id, id));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ac.abort();
    this.panel?.remove();
    this.panel = null;
    for (const t of this.loadedTextures) t.dispose();
    this.loadedTextures = [];
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
    this.group.removeFromParent();
    this.group.visible = false;
  }
}
