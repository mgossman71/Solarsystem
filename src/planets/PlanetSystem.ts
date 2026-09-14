/**
 * PlanetSystem — a self-contained planet (+ optional rings + moons) module
 * that plugs into the shared scene and lighting of `EarthScene`. One
 * instance per planet in `registry.ts`; Saturn is just the ringed,
 * mooniest one (carried over from the old `src/saturn/` module).
 *
 * Layout:
 *   group (fixed at def.position)
 *     └─ tiltGroup (rotation.z = -tilt, equator in local XZ, Y = spin axis)
 *          ├─ planetMesh (oblate spheroid when def.oblateness < 1)
 *          ├─ ringMesh   (only for def.ring — Saturn today)
 *          └─ moon meshes (orbits in the equatorial plane, tidally locked)
 *
 * Conventions shared with the Earth/Moon modules:
 *  – World scale 1 unit = 1 Earth radius; positions in scene units.
 *  – Lighting from the shared sun: world-space sun direction computed with
 *    `sunDirectionToward` every frame (Full Daylight / Auto sun just work).
 *  – Textures are 1×1 solid-color placeholders until `load()` swaps the real
 *    ones in (same lazy pattern as the Moon); the caller owns disposal
 *    tracking via the `onTexture` callback.
 *  – Moons use the identical equirectangular convention as the Moon (north
 *    up, near-side center at local +X at identity orientation) — rocky/icy
 *    moons reuse the Moon shader verbatim; haze moons (Titan) get a shell.
 *
 * Orbits: circular, in the planet's equatorial plane (real inclinations are
 * 0–1.6° for the focusable moons, visually indistinguishable at these
 * sizes; Triton's retrograde direction is honored). Angles advance with the
 * shared OrbitMode clock; in "Real Scale" mode radii and orbits are the true
 * values, in Exploration mode orbits are compressed and small moons are
 * clamped to a readable floor.
 */
import * as THREE from 'three';
import type { QualityProfile } from '../core/Quality';
import type { OrbitMode, ScaleMode } from '../core/types';
import { sunDirectionToward } from '../lighting/SunLighting';
import { moonFragmentShader, moonVertexShader } from '../moon/shaders/moon';
import {
  MAX_MOONS,
  type MoonDef,
  type PlanetDef,
  moonPeriod,
  moonSpinSign,
  planetBodyTexture,
  planetMoonOrbit,
  planetMoonRenderRadius,
  planetMoonTexture,
  planetRadius,
} from './registry';
import { planetFragmentShader, planetVertexShader } from './shaders/planet';
import { createRingGeometry, ringFragmentShader, ringVertexShader } from './shaders/rings';
import { hazeFragmentShader, hazeVertexShader } from './shaders/haze';

interface MoonEntry {
  def: MoonDef;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  angle: number;
  radius: number; // current rendered radius (scale-mode dependent)
}

export interface PlanetFrameParams {
  autoRotate: boolean;
  orbitMode: OrbitMode;
  scaleMode: ScaleMode;
  sunWorldPos: THREE.Vector3;
}

/** 1×1 solid-color placeholder (same role as the Moon's gray placeholder). */
function solidTexture(r: number, g: number, b: number, a = 255): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class PlanetSystem {
  readonly def: PlanetDef;
  readonly group: THREE.Group;
  readonly tiltGroup: THREE.Group;
  readonly planetMesh: THREE.Mesh;
  readonly planetMaterial: THREE.ShaderMaterial;
  readonly ringMesh: THREE.Mesh | null;
  readonly ringMaterial: THREE.ShaderMaterial | null;
  readonly moons: MoonEntry[];
  /** World position of each moon (index order = def.moons); refreshed in update(). */
  readonly moonWorlds: THREE.Vector3[];
  /** Current rendered radius of each moon (scene units; feeds the shadow uniforms). */
  readonly moonRadii: number[];
  /** Shared sun direction (uniform value for every planet material). */
  readonly sunDirection = new THREE.Vector3(1, 0, 0);
  readonly position: THREE.Vector3;

  private scaleMode: ScaleMode = 'explore';
  private maxAnisotropy: number;
  private onTexture: (t: THREE.Texture) => void;
  private lastMoonSegments: readonly [number, number];
  private disposed = false;
  private loadPromise: Promise<void> | null = null;
  private texturesLoaded = false;
  private readonly _tmp = new THREE.Vector3();
  private readonly _tmpQ = new THREE.Quaternion();
  private static readonly _POS_X = new THREE.Vector3(1, 0, 0);

  get loaded(): boolean { return this.texturesLoaded; }

  constructor(
    scene: THREE.Scene,
    def: PlanetDef,
    quality: QualityProfile,
    maxAnisotropy: number,
    onTexture: (t: THREE.Texture) => void,
  ) {
    this.def = def;
    this.maxAnisotropy = maxAnisotropy;
    this.onTexture = onTexture;
    this.lastMoonSegments = quality.sphereSegments.moon;
    const seg = quality.sphereSegments;

    // --- Group hierarchy ------------------------------------------------
    this.position = new THREE.Vector3(...def.position);
    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    this.tiltGroup = new THREE.Group();
    this.tiltGroup.rotation.z = -(def.tiltDeg * Math.PI) / 180; // spin axis tips toward +X
    this.group.add(this.tiltGroup);

    // --- Planet (oblateness baked into the geometry) --------------------
    const radius = planetRadius(def);
    const planetGeo = new THREE.SphereGeometry(radius, seg.earth[0], seg.earth[1]);
    if (def.oblateness !== 1) {
      planetGeo.scale(1, def.oblateness, 1);
      planetGeo.computeVertexNormals();
    }

    const [pr, pg, pb] = def.placeholder;
    const bodyPlaceholder = solidTexture(pr, pg, pb);
    // Ringless planets sample a transparent 1×1 strip (shadow math is inert).
    const ringPlaceholder = solidTexture(0, 0, 0, 0);
    this.onTexture(bodyPlaceholder);
    this.onTexture(ringPlaceholder);

    // Shadow uniform arrays are ALWAYS MAX_MOONS long (fixed GLSL size);
    // the fragment loops stop at uMoonCount so padding is never sampled.
    this.moonWorlds = Array.from({ length: MAX_MOONS }, () => new THREE.Vector3());
    this.moonRadii = new Array<number>(MAX_MOONS).fill(0);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(this.tiltGroup.quaternion);

    const ring = def.ring;
    this.planetMaterial = new THREE.ShaderMaterial({
      vertexShader: planetVertexShader,
      fragmentShader: planetFragmentShader,
      uniforms: {
        uMap: { value: bodyPlaceholder },
        uSunDirection: { value: this.sunDirection },
        uCenter: { value: this.position.clone() },
        uAxis: { value: axis },
        uRingInner: { value: ring ? ring.inner : 0 },
        uRingOuter: { value: ring ? ring.outer : 0 },
        uRingMap: { value: ringPlaceholder },
        uRingU0: { value: ring ? ring.texU0 : 0 },
        uRingU1: { value: ring ? ring.texU1 : 1 },
        uMoons: { value: this.moonWorlds },
        uMoonRadii: { value: this.moonRadii },
        uMoonCount: { value: def.moons.length },
        uFill: { value: def.fill },
        uLimb: { value: def.limb },
        uDebugMode: { value: 0 },
      },
    });
    this.planetMesh = new THREE.Mesh(planetGeo, this.planetMaterial);
    this.tiltGroup.add(this.planetMesh);

    // --- Rings (optional — Saturn today) --------------------------------
    if (ring) {
      this.ringMaterial = new THREE.ShaderMaterial({
        vertexShader: ringVertexShader,
        fragmentShader: ringFragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uRingMap: { value: ringPlaceholder },
          uRingU0: { value: ring.texU0 },
          uRingU1: { value: ring.texU1 },
          uSunDirection: { value: this.sunDirection },
          uCenter: { value: this.position.clone() },
          uPlanetRadius: { value: radius },
          uMoons: { value: this.moonWorlds },
          uMoonRadii: { value: this.moonRadii },
          uMoonCount: { value: def.moons.length },
        },
      });
      this.ringMesh = new THREE.Mesh(createRingGeometry(ring.inner, ring.outer), this.ringMaterial);
      this.tiltGroup.add(this.ringMesh);
    } else {
      this.ringMaterial = null;
      this.ringMesh = null;
    }

    // --- Moons -----------------------------------------------------------
    const moonPlaceholder = solidTexture(178, 182, 186);
    this.onTexture(moonPlaceholder);

    this.moons = def.moons.map((md) => {
      const radius0 = this.moonRenderRadius(md);
      const geo = new THREE.SphereGeometry(radius0, seg.moon[0], seg.moon[1]);
      const material = md.haze
        ? new THREE.ShaderMaterial({
            vertexShader: hazeVertexShader,
            fragmentShader: hazeFragmentShader,
            uniforms: {
              uTexture: { value: solidTexture(...def.placeholder) },
              uSunDirection: { value: this.sunDirection },
              uTint: { value: new THREE.Color(...md.haze.tint) },
              uRimColor: { value: new THREE.Color(...md.haze.rim) },
            },
          })
        : new THREE.ShaderMaterial({
            vertexShader: moonVertexShader,
            fragmentShader: moonFragmentShader,
            uniforms: {
              uTexture: { value: moonPlaceholder },
              uSunDirection: { value: this.sunDirection },
              uBumpScale: { value: 1.0 },
              uDebugMode: { value: 0 },
            },
          });
      const mesh = new THREE.Mesh(geo, material);
      this.tiltGroup.add(mesh);
      return { def: md, mesh, material, angle: md.initialAngle, radius: radius0 };
    });

    this.layout(); // initial positions + world caches
    scene.add(this.group);
  }

  // ------------------------------------------------------------
  // TEXTURES (lazy, idempotent — kicked off after first paint / on focus)
  // ------------------------------------------------------------
  load(loader: THREE.TextureLoader): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadTextures(loader)
        .catch((err) => console.warn(`Planet texture load failed (${this.def.name}):`, err))
        .finally(() => { if (!this.disposed) this.texturesLoaded = true; });
    }
    return this.loadPromise;
  }

  /** Sequential loads (mobile bandwidth), placeholders stay on failure. */
  private async loadTextures(loader: THREE.TextureLoader): Promise<void> {
    const jobs: Array<[string, (t: THREE.Texture) => void]> = [
      [planetBodyTexture(this.def.id), (t) => { this.planetMaterial.uniforms.uMap.value = t; }],
    ];
    if (this.def.ring && this.ringMaterial) {
      jobs.push([this.def.ring.texture, (t) => {
        this.planetMaterial.uniforms.uRingMap.value = t; // shadow sampling
        this.ringMaterial!.uniforms.uRingMap.value = t;   // ring rendering
      }]);
    }
    for (const m of this.moons) {
      jobs.push([planetMoonTexture(this.def.id, m.def.id), (t: THREE.Texture) => {
        m.material.uniforms.uTexture.value = t;
      }]);
    }

    for (const [path, apply] of jobs) {
      if (this.disposed) return;
      try {
        const tex = await loader.loadAsync(path);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, this.maxAnisotropy);
        if (this.disposed) { tex.dispose(); return; }
        apply(tex);
        this.onTexture(tex); // caller tracks for disposal
      } catch (err) {
        console.warn(`Planet texture unavailable, keeping placeholder: ${path}`, err);
      }
    }
  }

  // ------------------------------------------------------------
  // PER-FRAME
  // ------------------------------------------------------------
  /** Advance spin + moon orbits, tidal lock, and refresh sun/shadow uniforms. */
  update(dt: number, p: PlanetFrameParams): void {
    if (this.disposed) return;

    // Shared sun direction (single write — all materials share the instance).
    sunDirectionToward(p.sunWorldPos, this.position, this.sunDirection);

    // Idle spin (cosmetic — bands are near-symmetric at these distances).
    if (p.autoRotate) this.planetMesh.rotation.y += dt * this.def.spinRate;

    if (p.scaleMode !== this.scaleMode) this.applyScaleMode(p.scaleMode);

    for (const m of this.moons) {
      const period = moonPeriod(m.def, p.orbitMode);
      if (Number.isFinite(period) && period > 0) {
        const sign = moonSpinSign(m.def);
        m.angle = (m.angle + sign * (dt / period) * Math.PI * 2) % (Math.PI * 2);
      }
    }
    this.layout();
  }

  /**
   * Place every moon on its orbit (local equatorial plane) and tidally lock
   * it — near-side center (u=0.5, local +X at identity) facing the planet.
   * Also refreshes the world caches feeding focus/pick/shadows.
   */
  private layout(): void {
    for (let i = 0; i < this.moons.length; i++) {
      const m = this.moons[i];
      const orbit = planetMoonOrbit(m.def, this.scaleMode);
      m.mesh.position.set(
        Math.cos(m.angle) * orbit,
        0,
        -Math.sin(m.angle) * orbit, // prograde viewed from the north pole
      );
      // Tidal lock in the local frame (parent applies equally to both vectors).
      this._tmp.copy(m.mesh.position).multiplyScalar(-1).normalize();
      m.mesh.quaternion.copy(this._tmpQ.setFromUnitVectors(PlanetSystem._POS_X, this._tmp));
      m.mesh.getWorldPosition(this.moonWorlds[i]);
      this.moonRadii[i] = m.radius;
    }
  }

  /** Rendered radius for the current/given scale mode (haze shell included). */
  private moonRenderRadius(def: MoonDef, mode: ScaleMode = this.scaleMode): number {
    return planetMoonRenderRadius(def, this.def, mode);
  }

  /** Switch Exploration ↔ Real Scale: rebuild moon spheres + re-layout. */
  applyScaleMode(mode: ScaleMode): void {
    if (mode === this.scaleMode) return;
    this.scaleMode = mode;
    const [w, h] = this.lastMoonSegments;
    for (const m of this.moons) {
      m.radius = this.moonRenderRadius(m.def, mode);
      const old = m.mesh.geometry;
      m.mesh.geometry = new THREE.SphereGeometry(m.radius, w, h);
      old.dispose();
    }
    this.layout();
  }

  /** Quality-tier switch: rebuild planet + moon tessellation (positions preserved). */
  swapSegments(seg: QualityProfile['sphereSegments']): void {
    this.lastMoonSegments = seg.moon;
    const [pw, ph] = seg.earth;
    const planetGeo = new THREE.SphereGeometry(planetRadius(this.def), pw, ph);
    if (this.def.oblateness !== 1) {
      planetGeo.scale(1, this.def.oblateness, 1);
      planetGeo.computeVertexNormals();
    }
    const oldPlanet = this.planetMesh.geometry;
    this.planetMesh.geometry = planetGeo;
    oldPlanet.dispose();
    for (const m of this.moons) {
      const old = m.mesh.geometry;
      m.mesh.geometry = new THREE.SphereGeometry(m.radius, seg.moon[0], seg.moon[1]);
      old.dispose();
    }
  }

  // ------------------------------------------------------------
  // LOOKUPS (used by EarthScene focus / picking)
  // ------------------------------------------------------------
  center(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.position); }

  /** World position of a moon by id, or null. */
  moonWorld(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const i = this.moons.findIndex((m) => m.def.id === id);
    return i < 0 ? null : out.copy(this.moonWorlds[i]);
  }

  /** Rendered radius of a moon by id (scene units), or null. */
  moonRadius(id: string): number | null {
    const i = this.moons.findIndex((m) => m.def.id === id);
    return i < 0 ? null : this.moons[i].radius;
  }

  /** Debug-panel hook — the shared Earth/Moon/planet convention
   *  (0 none, 1 normals, 2 sun ramp, 3 white × NdotL). */
  setDebugMode(mode: number): void {
    if (this.planetMaterial.uniforms.uDebugMode) this.planetMaterial.uniforms.uDebugMode.value = mode;
    for (const m of this.moons) {
      if (m.material.uniforms.uDebugMode) m.material.uniforms.uDebugMode.value = mode;
    }
  }

  /** Cancel in-flight texture work (geometry/materials are freed by the
   *  scene traversal; textures via the caller's `onTexture` tracking list). */
  markDisposed(): void { this.disposed = true; }
}

