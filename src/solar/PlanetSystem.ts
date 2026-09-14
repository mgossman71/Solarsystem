// ============================================================
// SOLAR — PER-PLANET SYSTEM VIEW (a single planet + its moons, up close)
// ============================================================
// The overview (SolarSystem) shows the whole Sun system at a compressed scale.
// This is the DEEP view for one planet: the planet (real texture, axial tilt,
// rings where applicable) at the centre, and every one of its moons on its true
// orbit — driven by the authoritative SimulationClock and the shared JPL
// ephemeris, so a moon's speed is set by its real period, not a hand-tuned rate.
// It owns its own meshes, lights, DOM panel and camera tween, so the host app
// (EarthScene) only shows/hides it — exactly like SolarSystem and SaturnSystem.
//
//   new PlanetSystem(scene, camera, controls, planetId)  → .group
//   .update(dtSeconds)   → advance clock + reposition moons + spin
//   .overview()          → frame the planet + its moon system
//   .focusMoon(id)       → frame a single moon
//   .dispose()           → remove meshes, lights, panel, listeners
// ============================================================

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getBody, moonsOf } from '../astronomy/CelestialCatalog';
import { moonLocalPosition } from '../astronomy/OrbitalElements';
import type { CelestialBody, MoonOrbitElements } from '../astronomy/types';
import type { Vec3 } from '../astronomy/ReferenceFrames';
import { SimulationClock, SPEED_PRESETS } from '../astronomy/SimulationClock';
import {
  planetDisplayRadius, moonDisplayRadius, moonOrbitRadius,
} from './scale';
// Reuse the overview's proven ring geometry / banding + per-planet definitions.
import { RING_DEFS, createRingGeo, makeRadialRingTexture, colorFor } from './SolarSystem';

const DEG2RAD = Math.PI / 180;

// ---- Small, PURE helpers (unit-testable, no Three.js) ----------------------
/** A planet's on-screen radius in the deep view (overview's capped sizing). */
export function systemPlanetRadius(radiusKm: number): number {
  return planetDisplayRadius(radiusKm);
}
/** A moon's on-screen radius in the deep view (small but resolvable). */
export function systemMoonRadius(radiusKm: number): number {
  return moonDisplayRadius(radiusKm);
}
/** A moon's display orbit radius: ~1.6×–3.6× the planet radius, ordered by true
 *  semi-major axis (inner → outer) so all stay visible. */
export function systemMoonOrbit(planetR: number, aKm: number, maxAKm: number): number {
  return moonOrbitRadius(planetR, aKm, maxAKm);
}
/** UI label — appends "— Dwarf Planet" for Pluto (accurate labeling). */
export function systemDisplayName(id: string): string {
  const b = getBody(id);
  return (b?.name ?? id) + (b?.isDwarf ? ' — Dwarf Planet' : '');
}

interface MoonNode { id: string; mesh: THREE.Mesh; orbitR: number; el: MoonOrbitElements }
interface CameraTween {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
  t: number; duration: number;
}

export class PlanetSystem {
  /** Root group — add to the host scene. */
  readonly group: THREE.Group;
  /** The single authoritative time source (days since J2000.0). */
  readonly clock: SimulationClock;
  /** The planet this system view is centred on. */
  readonly planet: CelestialBody;
  /** Display radius of the planet (units). */
  readonly planetR: number;

  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private planetMesh!: THREE.Mesh;
  private moons: MoonNode[] = [];
  private pickables: THREE.Mesh[] = [];
  private meshToId = new Map<THREE.Mesh, string>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tween: CameraTween | null = null;
  private panel: HTMLElement | null = null;
  private ac = new AbortController();
  private disposed = false;
  private loadedTextures: THREE.Texture[] = [];
  private _ecl: Vec3 = { x: 0, y: 0, z: 0 };

  /** Optional host callback for "← Solar System" (return to the overview). */
  onExit: (() => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, planetId: string) {
    const body = getBody(planetId);
    if (!body) throw new Error(`PlanetSystem: unknown planet "${planetId}"`);
    this.planet = body;
    this.camera = camera;
    this.controls = controls;
    this.clock = new SimulationClock({ mode: 'realtime' }); // moons orbit at true rate
    this.planetR = systemPlanetRadius(body.radiusKm);

    this.group = new THREE.Group();
    this.group.name = body.name + ' system';
    this.group.visible = false;
    scene.add(this.group);
    this.build();
    this.bindPicking();
    this.buildPanel();
  }
  private build(): void {
    // Sun as a fixed light direction (the planet orbits it; here it is far to
    // one side). decay 0 → constant intensity; a faint ambient lifts shadows.
    const sun = new THREE.PointLight(0xffffff, 3.4, 0, 0);
    sun.position.set(320, 60, 40);
    this.group.add(sun);
    this.group.add(new THREE.AmbientLight(0x2a2a33, 0.65));

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = -(this.planet.rotation?.obliquityDeg ?? 0) * DEG2RAD; // Uranus → near-vertical
    this.group.add(tiltGroup);

    // The planet: real texture over an honest albedo fallback; period/
    // retrograde-aware spin is applied in update().
    const planetMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9, metalness: 0 });
    planetMat.color.set(colorFor(this.planet.id));
    this.planetMesh = new THREE.Mesh(new THREE.SphereGeometry(this.planetR, 64, 48), planetMat);
    this.planetMesh.name = this.planet.name;
    tiltGroup.add(this.planetMesh);
    this.loadBodyTexture(this.planet.textures?.body, planetMat);

    // Rings for the four giants — radial UV annulus + procedural banding,
    // tilted with the planet (so Uranus's ~98° obliquity reads as near-vertical).
    if (this.planet.hasRings) {
      const def = RING_DEFS[this.planet.id] ?? {
        inner: 1.45, outer: 2.0, tint: [200, 200, 200] as [number, number, number],
        maxAlpha: 0.4, bands: [0.6],
      };
      const ringTex = makeRadialRingTexture(def.tint, def.maxAlpha, def.bands);
      const ring = new THREE.Mesh(
        createRingGeo(this.planetR * def.inner, this.planetR * def.outer),
        new THREE.MeshStandardMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, roughness: 0.9, metalness: 0 }),
      );
      tiltGroup.add(ring);
      this.loadedTextures.push(ringTex);
    }

    // Moons: each on its own local orbit (driven by the ephemeris in update()).
    const moonGroup = new THREE.Group();
    this.group.add(moonGroup);
    const list = moonsOf(this.planet.id);
    const maxA = list.reduce((m, x) => Math.max(m, x.moon!.semiMajorAxisKm), 0);
    for (const moon of list) {
      const mR = systemMoonRadius(moon.radiusKm);
      const orbitR = systemMoonOrbit(this.planetR, moon.moon!.semiMajorAxisKm, maxA);
      const mMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95, metalness: 0 });
      mMat.color.set(colorFor(moon.id));
      const mMesh = new THREE.Mesh(new THREE.SphereGeometry(mR, 32, 24), mMat);
      this.loadBodyTexture(moon.textures?.body, mMat);
      mMesh.name = moon.name;
      moonGroup.add(mMesh);
      this.pickables.push(mMesh);
      this.meshToId.set(mMesh, moon.id);
      this.moons.push({ id: moon.id, mesh: mMesh, orbitR, el: moon.moon! });
      moonGroup.add(this.orbitGuide(moon.moon!, orbitR));
    }
  }

  /** A faithful (circular, catalog-inclination) orbit guide for one moon. */
  private orbitGuide(el: MoonOrbitElements, orbitR: number): THREE.LineLoop {
    const N = 96;
    const pts: THREE.Vector3[] = [];
    const tmp: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < N; i++) {
      const p = moonLocalPosition(el, (i / N) * el.periodDays, tmp);
      const n = Math.hypot(p.x, p.y, p.z) || 1;
      pts.push(new THREE.Vector3((p.x / n) * orbitR, (p.y / n) * orbitR, (p.z / n) * orbitR));
    }
    return new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.28 }),
    );
  }
  // ------------------------------------------------------------------
  // TIME + MOTION
  // ------------------------------------------------------------------
  update(dtSeconds: number): void {
    if (this.disposed || !this.group.visible) return;
    this.clock.advance(dtSeconds);
    const t = this.clock.epochDays;

    // Planet spin: period/retrograde-aware, readably slowed (fps-independent).
    const rotH = Math.abs(this.planet.rotation?.periodHours ?? 24);
    const retro = this.planet.rotation?.direction === 'retrograde' ? -1 : 1;
    this.planetMesh.rotation.y += dtSeconds * retro * 0.14 * Math.min(3, Math.max(0.2, 24 / rotH));

    for (const m of this.moons) {
      const lp = moonLocalPosition(m.el, t, this._ecl);
      const n = Math.hypot(lp.x, lp.y, lp.z) || 1;
      m.mesh.position.set((lp.x / n) * m.orbitR, (lp.y / n) * m.orbitR, (lp.z / n) * m.orbitR);
      if (m.el.tidallyLocked) m.mesh.rotation.y = Math.atan2(lp.x, lp.z); // face the planet
    }
    this.stepTween(dtSeconds);
  }

  // ------------------------------------------------------------------
  // NAVIGATION
  // ------------------------------------------------------------------
  overview(): void {
    const outer = this.moons.reduce((mx, m) => Math.max(mx, m.orbitR), this.planetR * 1.4);
    this.tweenTo(new THREE.Vector3(0, 0, 0), Math.max(outer * 2.3, this.planetR * 5), new THREE.Vector3(0.5, 0.6, 1));
  }
  focusMoon(id: string): void {
    const m = this.moons.find((x) => x.id === id);
    if (m) this.tweenTo(m.mesh.position.clone(), Math.max(m.orbitR * 1.2, this.planetR * 2.4));
  }
  moonIds(): string[] { return this.moons.map((m) => m.id); }

  private tweenTo(target: THREE.Vector3, distance: number, dirHint?: THREE.Vector3): void {
    const toTgt = target.clone();
    const dir = (dirHint ?? this.camera.position.clone().sub(this.controls.target)).normalize();
    const toPos = toTgt.clone().add(dir.multiplyScalar(distance));
    this.tween = { fromPos: this.camera.position.clone(), toPos, fromTgt: this.controls.target.clone(), toTgt, t: 0, duration: 0.7 };
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
  // TIME CONTROLS (mirror the overview's SimulationClock usage)
  // ------------------------------------------------------------------
  isPaused(): boolean { return this.clock.mode === 'paused'; }
  togglePause(): boolean {
    const next = !this.isPaused();
    this.clock.setMode(next ? 'paused' : 'realtime');
    return next;
  }
  applyPreset(id: string): void {
    const p = SPEED_PRESETS.find((x) => x.id === id);
    if (p) this.clock.applyPreset(p);
  }
  // ------------------------------------------------------------------
  // PICKING (click a moon to focus it)
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
    if (hits.length > 0) {
      const id = this.meshToId.get(hits[0].object as THREE.Mesh);
      if (id) this.focusMoon(id);
    }
  };

  // ------------------------------------------------------------------
  // TEXTURES (lazy, with a graceful flat-color fallback)
  // ------------------------------------------------------------------
  private loadBodyTexture(url: string | undefined, mat: THREE.MeshStandardMaterial): void {
    if (!url) return;
    new THREE.TextureLoader().load(
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
  // DOM PANEL
  // ------------------------------------------------------------------
  private buildPanel(): void {
    const el = document.createElement('div');
    el.className = 'solar-panel';
    el.style.cssText = [
      'position:fixed', 'top:16px', 'left:16px', 'z-index:40',
      'width:230px', 'padding:14px 16px', 'border-radius:14px',
      'background:rgba(10,14,22,0.82)', 'backdrop-filter:blur(10px)',
      'border:1px solid rgba(255,255,255,0.12)', 'color:#e6e6ee',
      'font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    ].join(';');
    const moons = moonsOf(this.planet.id);
    const moonOpts = moons.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
    const speedOpts = SPEED_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
    el.innerHTML = [
      `<div style="font-weight:600;font-size:14px;margin-bottom:4px">${systemDisplayName(this.planet.id)} system</div>`,
      `<div style="opacity:.6;font-size:11px;margin-bottom:10px">${moons.length} moon${moons.length === 1 ? '' : 's'}</div>`,
      `<div style="margin-bottom:8px"><div style="opacity:.7;margin-bottom:2px">Focus</div>`,
      `<select data-role="focus" style="width:100%"><option value="planet">${this.planet.name}</option>${moonOpts}</select></div>`,
      `<div style="margin-bottom:10px"><div style="opacity:.7;margin-bottom:2px">Speed</div>`,
      `<select data-role="speed" style="width:100%">${speedOpts}</select></div>`,
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">`,
      `<button data-role="pause">Pause</button>`,
      `<button data-role="overview">Overview</button>`,
      `<button data-role="back" style="grid-column:1/-1">← Solar System</button>`,
      `</div>`,
      `<div style="opacity:.5;font-size:11px;margin-top:10px">Moons not to true size. Positions: JPL ephemeris (J2000).</div>`,
    ].join('');
    document.body.appendChild(el);
    this.panel = el;

    const focus = el.querySelector('select[data-role="focus"]') as HTMLSelectElement;
    focus.addEventListener('change', () => { if (focus.value !== 'planet') this.focusMoon(focus.value); }, { signal: this.ac.signal });
    const speed = el.querySelector('select[data-role="speed"]') as HTMLSelectElement;
    speed.value = '1day';
    speed.addEventListener('change', () => this.applyPreset(speed.value), { signal: this.ac.signal });
    const pauseBtn = el.querySelector('button[data-role="pause"]') as HTMLButtonElement;
    pauseBtn.addEventListener('click', () => {
      pauseBtn.textContent = this.togglePause() ? 'Resume' : 'Pause';
    }, { signal: this.ac.signal });
    (el.querySelector('button[data-role="overview"]') as HTMLButtonElement)
      .addEventListener('click', () => this.overview(), { signal: this.ac.signal });
    if (this.onExit) {
      (el.querySelector('button[data-role="back"]') as HTMLButtonElement)
        .addEventListener('click', this.onExit, { signal: this.ac.signal });
    }
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
