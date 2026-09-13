/**
 * SaturnSystem — a self-contained Saturn + rings + seven-moons module that
 * plugs into the shared scene and lighting of `EarthScene`.
 *
 * Layout:
 *   group (fixed at SATURN_POSITION)
 *     └─ tiltGroup (rotation.z = -26.73°, equator in local XZ, Y = spin axis)
 *          ├─ planetMesh   (oblate spheroid, 9.46 scene units equatorial)
 *          ├─ ringMesh     (flat annulus in local XZ, 13.85 → 21.19)
 *          └─ 7 moon meshes (orbits in the equatorial plane, tidally locked)
 *
 * Conventions shared with the Earth/Moon modules:
 *  – World scale 1 unit = 1 Earth radius; positions in scene units.
 *  – Lighting from the shared sun: world-space sun direction computed with
 *    `sunDirectionToward` every frame (Full Daylight / Auto sun just work).
 *  – Textures are 1×1 solid-color placeholders until `load()` swaps the real
 *    ones in (same lazy pattern as the Moon); the caller owns disposal
 *    tracking via the `onTexture` callback.
 *  – Moons use the identical equirectangular convention as the Moon (north
 *    up, near-side center at local +X at identity orientation) — the six
 *    icy moons reuse the Moon shader verbatim; Titan gets a haze shader.
 *
 * Orbits: circular, in Saturn's equatorial plane (real inclinations are
 * 0–1.6°, visually indistinguishable from zero at these sizes). Angles
 * advance with the shared OrbitMode clock; in "Real Scale" mode radii and
 * orbits are the true values (Mimas 29.1 … Iapetus 558.9 units from the
 * planet center), in Exploration mode they're compressed (24–55) with small
 * moons clamped to a readable 0.32 radius.
 */
import * as THREE from 'three';
import type { QualityProfile } from '../core/Quality';
import type { OrbitMode, ScaleMode } from '../core/types';
import { sunDirectionToward } from '../lighting/SunLighting';
import { moonFragmentShader, moonVertexShader } from '../moon/shaders/moon';
import {
  RING_INNER, RING_OUTER, RING_TEX_U0, RING_TEX_U1,
  SATURN_MOONS, SATURN_OBLATENESS, SATURN_POSITION, SATURN_RADIUS,
  SATURN_SPIN_RATE, SATURN_TILT, SATURN_TEXTURES,
  saturnMoonOrbit, saturnMoonPeriod, saturnMoonRadius,
  type SaturnMoonDef,
} from './config';
import { saturnPlanetFragmentShader, saturnPlanetVertexShader } from './shaders/saturnPlanet';
import { createRingGeometry, ringFragmentShader, ringVertexShader } from './shaders/rings';
import { titanFragmentShader, titanVertexShader } from './shaders/titan';

interface MoonEntry {
  def: SaturnMoonDef;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  angle: number;
  radius: number; // current rendered radius (scale-mode dependent)
}

export interface SaturnFrameParams {
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

export class SaturnSystem {
  readonly group: THREE.Group;
  readonly tiltGroup: THREE.Group;
  readonly planetMesh: THREE.Mesh;
  readonly planetMaterial: THREE.ShaderMaterial;
  readonly ringMesh: THREE.Mesh;
  readonly ringMaterial: THREE.ShaderMaterial;
  readonly moons: MoonEntry[];
  /** World position of each moon (index order = SATURN_MOONS); refreshed in update(). */
  readonly moonWorlds: THREE.Vector3[];
  /** Current rendered radius of each moon (scene units; feeds the shadow uniforms). */
  readonly moonRadii: number[];
  /** Shared sun direction (uniform value for every Saturn material). */
  readonly sunDirection = new THREE.Vector3(1, 0, 0);

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
    quality: QualityProfile,
    maxAnisotropy: number,
    onTexture: (t: THREE.Texture) => void,
  ) {
    this.maxAnisotropy = maxAnisotropy;
    this.onTexture = onTexture;
    this.lastMoonSegments = quality.sphereSegments.moon;

    const seg = quality.sphereSegments;

    // --- Group hierarchy ------------------------------------------------
    this.group = new THREE.Group();
    this.group.position.copy(SATURN_POSITION);

    this.tiltGroup = new THREE.Group();
    this.tiltGroup.rotation.z = -SATURN_TILT; // spin axis tips toward +X
    this.group.add(this.tiltGroup);

    // --- Planet (oblateness baked into the geometry) --------------------
    const planetGeo = new THREE.SphereGeometry(SATURN_RADIUS, seg.earth[0], seg.earth[1]);
    planetGeo.scale(1, SATURN_OBLATENESS, 1);
    planetGeo.computeVertexNormals();

    const bodyPlaceholder = solidTexture(206, 188, 152);
    const ringPlaceholder = solidTexture(0, 0, 0, 0); // invisible until loaded
    this.onTexture(bodyPlaceholder);
    this.onTexture(ringPlaceholder);

    this.moonWorlds = SATURN_MOONS.map(() => new THREE.Vector3());
    this.moonRadii = SATURN_MOONS.map(() => 0.32);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(this.tiltGroup.quaternion);

    this.planetMaterial = new THREE.ShaderMaterial({
      vertexShader: saturnPlanetVertexShader,
      fragmentShader: saturnPlanetFragmentShader,
      uniforms: {
        uMap: { value: bodyPlaceholder },
        uSunDirection: { value: this.sunDirection },
        uCenter: { value: SATURN_POSITION.clone() },
        uAxis: { value: axis },
        uRingInner: { value: RING_INNER },
        uRingOuter: { value: RING_OUTER },
        uRingMap: { value: ringPlaceholder },
        uRingU0: { value: RING_TEX_U0 },
        uRingU1: { value: RING_TEX_U1 },
        uMoons: { value: this.moonWorlds },
        uMoonRadii: { value: this.moonRadii },
        uDebugMode: { value: 0 },
      },
    });
    this.planetMesh = new THREE.Mesh(planetGeo, this.planetMaterial);
    this.tiltGroup.add(this.planetMesh);

    // --- Rings -----------------------------------------------------------
    this.ringMaterial = new THREE.ShaderMaterial({
      vertexShader: ringVertexShader,
      fragmentShader: ringFragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uRingMap: { value: ringPlaceholder },
        uRingU0: { value: RING_TEX_U0 },
        uRingU1: { value: RING_TEX_U1 },
        uSunDirection: { value: this.sunDirection },
        uCenter: { value: SATURN_POSITION.clone() },
        uPlanetRadius: { value: SATURN_RADIUS },
        uMoons: { value: this.moonWorlds },
        uMoonRadii: { value: this.moonRadii },
      },
    });
    this.ringMesh = new THREE.Mesh(createRingGeometry(), this.ringMaterial);
    this.tiltGroup.add(this.ringMesh);

    // --- Moons -----------------------------------------------------------
    const moonPlaceholder = solidTexture(178, 182, 186);
    const titanPlaceholder = solidTexture(203, 145, 79);
    this.onTexture(moonPlaceholder);
    this.onTexture(titanPlaceholder);

    this.moons = SATURN_MOONS.map((def) => {
      const isTitan = def.id === 'titan';
      const radius = this.moonRenderRadius(def);
      const geo = new THREE.SphereGeometry(radius, seg.moon[0], seg.moon[1]);
      const material = isTitan
        ? new THREE.ShaderMaterial({
            vertexShader: titanVertexShader,
            fragmentShader: titanFragmentShader,
            uniforms: {
              uTexture: { value: titanPlaceholder },
              uSunDirection: { value: this.sunDirection },
              uTint: { value: new THREE.Color(1.0, 0.62, 0.40) },
              uRimColor: { value: new THREE.Color(1.0, 0.72, 0.45) },
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
      return { def, mesh, material, angle: def.initialAngle, radius };
    });

    this.layout(); // initial positions + world caches
    scene.add(this.group);
  }
  // ------------------------------------------------------------
  // TEXTURES (lazy, idempotent — EarthScene kicks this off after first paint)
  // ------------------------------------------------------------
  load(loader: THREE.TextureLoader): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadTextures(loader)
        .catch((err) => console.warn('Saturn texture load failed:', err))
        .finally(() => { if (!this.disposed) this.texturesLoaded = true; });
    }
    return this.loadPromise;
  }

  /** Sequential loads (mobile bandwidth), placeholders stay on failure. */
  private async loadTextures(loader: THREE.TextureLoader): Promise<void> {
    const moonBy = (id: string) => this.moons.find((m) => m.def.id === id)!;
    const jobs: Array<[string, (t: THREE.Texture) => void]> = [
      [SATURN_TEXTURES.body, (t) => { this.planetMaterial.uniforms.uMap.value = t; }],
      [SATURN_TEXTURES.rings, (t) => {
        this.planetMaterial.uniforms.uRingMap.value = t; // shadow sampling
        this.ringMaterial.uniforms.uRingMap.value = t;   // ring rendering
      }],
      [SATURN_TEXTURES.titan, (t) => { moonBy('titan').material.uniforms.uTexture.value = t; }],
      ...SATURN_MOONS
        .filter((d) => d.id !== 'titan')
        .map((d) => [SATURN_TEXTURES.moon(d.id), (t: THREE.Texture) => {
          moonBy(d.id).material.uniforms.uTexture.value = t;
        }] as [string, (t: THREE.Texture) => void]),
    ];

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
        console.warn(`Saturn texture unavailable, keeping placeholder: ${path}`, err);
      }
    }
  }

  // ------------------------------------------------------------
  // PER-FRAME
  // ------------------------------------------------------------
  /** Advance orbits, tidal lock, and refresh sun/shadow uniforms. */
  update(dt: number, p: SaturnFrameParams): void {
    if (this.disposed) return;

    // Shared sun direction (single write — all materials share the instance).
    sunDirectionToward(p.sunWorldPos, SATURN_POSITION, this.sunDirection);

    // Idle spin (cosmetic — bands are near-symmetric; the hexagonal storm
    // at the north pole is only a hint of motion at this scale).
    if (p.autoRotate) this.planetMesh.rotation.y += dt * SATURN_SPIN_RATE;

    if (p.scaleMode !== this.scaleMode) this.applyScaleMode(p.scaleMode);

    for (const m of this.moons) {
      const period = saturnMoonPeriod(m.def, p.orbitMode);
      if (Number.isFinite(period) && period > 0) {
        m.angle = (m.angle + (dt / period) * Math.PI * 2) % (Math.PI * 2);
      }
    }
    this.layout();
  }

  /**
   * Place every moon on its orbit (local equatorial plane, prograde) and
   * tidally lock it — near-side center (u=0.5, local +X at identity) facing
   * Saturn. Also refreshes the world caches feeding focus/pick/shadows.
   */
  private layout(): void {
    for (let i = 0; i < this.moons.length; i++) {
      const m = this.moons[i];
      const orbit = saturnMoonOrbit(m.def, this.scaleMode);
      m.mesh.position.set(
        Math.cos(m.angle) * orbit,
        0,
        -Math.sin(m.angle) * orbit, // prograde viewed from the north pole
      );
      // Tidal lock in the local frame (parent applies equally to both vectors).
      this._tmp.copy(m.mesh.position).multiplyScalar(-1).normalize();
      m.mesh.quaternion.copy(this._tmpQ.setFromUnitVectors(SaturnSystem._POS_X, this._tmp));
      m.mesh.getWorldPosition(this.moonWorlds[i]);
      this.moonRadii[i] = m.radius;
    }
  }

  /** Rendered radius for the current/given scale mode (Titan carries a +4% haze shell). */
  private moonRenderRadius(def: SaturnMoonDef, mode: ScaleMode = this.scaleMode): number {
    const r = saturnMoonRadius(def, mode);
    return def.id === 'titan' ? r * 1.04 : r;
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
    const planetGeo = new THREE.SphereGeometry(SATURN_RADIUS, pw, ph);
    planetGeo.scale(1, SATURN_OBLATENESS, 1);
    planetGeo.computeVertexNormals();
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
  center(out: THREE.Vector3): THREE.Vector3 { return out.copy(SATURN_POSITION); }

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

  /** Debug-panel hook — same modes as the Moon (0 none, 1 normals, 2 UV, 3 white). */
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