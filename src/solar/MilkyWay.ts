// ============================================================
// SOLAR — MILKY WAY VIEW (the Galaxy, with the Solar System placed in it)
// ============================================================
// A self-contained view one level ABOVE the Solar System: the whole Milky Way
// as a barred spiral, with the Sun (and therefore the Solar System) placed at
// its real galactic radius — ~26,000 light-years out from the centre, in the
// Orion Spur. Like SolarSystem / PlanetSystem it owns its own meshes, DOM
// panel, camera tween and disposal, so EarthScene only shows/hides it and
// calls .update(dt) each frame.
//
//   new MilkyWay(scene, camera, controls)  → .group
//   .update(dtSeconds)   → slowly rotate the galaxy + pulse "you are here"
//   .overview()          → frame the whole galaxy
//   .focusSun()          → zoom to the Solar System's location
//   .dispose()           → remove meshes, panel, listeners
//
// The galaxy image is painted procedurally on a <canvas> (bulge + bar + two
// spiral arms + dust lanes + star clouds) — no external texture is required.
// ============================================================

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---- Real galaxy constants (drive the Solar System's placement) -----------
export const GALAXY_DIAMETER_LY = 100_000;   // Milky Way ≈ 100,000 light-years across
export const GALAXY_RADIUS_LY = GALAXY_DIAMETER_LY / 2;
export const SOLAR_SYSTEM_RADIUS_LY = 26_000; // Sun ≈ 26,000 ly from the centre
export const ORION_SPUR_ANGLE_DEG = 40;        // fixed bearing of the Sun (visual)

// ---- Pure helpers (unit-testable — no Three.js, no DOM) -------------------
/** The Sun's galactic radius as a fraction of the galaxy's radius (0..1). */
export function sunRadiusFraction(): number {
  return SOLAR_SYSTEM_RADIUS_LY / GALAXY_RADIUS_LY;
}
/** The Sun's placement radius in scene units, given the galaxy's disc radius. */
export function sunSceneRadius(galaxyRadiusUnits: number): number {
  return galaxyRadiusUnits * sunRadiusFraction();
}
/** Scene position of the Sun (the disc lies in XZ, +Y is "up"). */
export function sunScenePosition(galaxyRadiusUnits: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const r = sunSceneRadius(galaxyRadiusUnits);
  const a = (ORION_SPUR_ANGLE_DEG * Math.PI) / 180;
  out.x = Math.cos(a) * r;
  out.y = 0;
  out.z = Math.sin(a) * r;
  return out;
}
/** A point along a spiral arm, as a 2D offset from centre (canvas space).
 *  `t` ∈ [0,1]: 0 = innermost, 1 = outer edge; arms are evenly separated. */
export function spiralPoint(arm: number, t: number, arms: number, scale: number, turns = 1.1): { x: number; y: number } {
  const radius = scale * (0.08 + 0.92 * t);       // grows toward the edge, never at the centre
  const offset = (arm / arms) * Math.PI * 2;       // even separation between arms
  const theta = turns * Math.PI * 2 * t + offset;  // sweep grows toward the edge
  return { x: Math.cos(theta) * radius, y: Math.sin(theta) * radius };
}

export interface GalaxyTextureOptions { arms?: number; barAngleDeg?: number }

interface CameraTween {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
  t: number; duration: number;
}
/** Paint a barred-spiral galaxy into a square canvas and return it. Pure
 *  canvas/DOM (called at runtime, never at import) so the pure helpers above
 *  stay unit-testable. Additive blending gives the soft galactic glow. */
export function paintGalaxy(size = 1024, opts: GalaxyTextureOptions = {}): HTMLCanvasElement {
  const arms = opts.arms ?? 2;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2, cy = size / 2;
  const R = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter'; // additive glow

  // 1) Overall disc glow + central bulge (radial gradient).
  const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  disc.addColorStop(0.0, 'rgba(255,246,225,1.0)');
  disc.addColorStop(0.12, 'rgba(255,232,196,0.92)');
  disc.addColorStop(0.3, 'rgba(210,180,150,0.42)');
  disc.addColorStop(0.55, 'rgba(120,110,140,0.18)');
  disc.addColorStop(0.8, 'rgba(70,70,110,0.08)');
  disc.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

  // 2) The bar — an elongated, warm ellipse through the centre.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((opts.barAngleDeg ?? 25) * Math.PI / 180);
  const bar = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.30);
  bar.addColorStop(0, 'rgba(255,240,210,0.9)');
  bar.addColorStop(0.6, 'rgba(230,190,150,0.4)');
  bar.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.scale(1, 0.34); // flatten into a bar
  ctx.fillStyle = bar;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();

  // 3) Spiral arms — soft glow blobs following the spiral, brighter inward.
  const ARM_N = 220;
  for (let arm = 0; arm < arms; arm++) {
    for (let i = 0; i < ARM_N; i++) {
      const t = i / (ARM_N - 1);
      const p = spiralPoint(arm, t, arms, R);
      const x = cx + p.x, y = cy + p.y;
      const near = 1 - t;
      const rad = R * 0.16 * (0.5 + near * 0.7);
      const a = 0.10 * near + 0.02;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(180,200,255,${a})`);     // bluish young stars in arms
      g.addColorStop(0.5, `rgba(150,140,200,${a * 0.5})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 4) Star clouds — many tiny points, denser toward the centre.
  const STAR_N = 6000;
  for (let i = 0; i < STAR_N; i++) {
    const rr = Math.sqrt(Math.random()) * R * 0.95;
    const aa = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(aa) * rr;
    const y = cy + Math.sin(aa) * rr;
    const bright = Math.random();
    const col = bright > 0.7 ? '255,240,220' : bright > 0.4 ? '200,215,255' : '255,255,255';
    const px = 0.5 + Math.random() * 1.6;
    ctx.fillStyle = `rgba(${col},${(0.15 + Math.random() * 0.7).toFixed(3)})`;
    ctx.fillRect(x, y, px, px);
  }

  // 5) Dust lanes — faint reddish streaks just inside the arms.
  ctx.globalCompositeOperation = 'source-over';
  const DUST_N = 140;
  for (let arm = 0; arm < arms; arm++) {
    for (let i = 12; i < DUST_N; i++) {
      const t = i / (DUST_N - 1);
      const p = spiralPoint(arm, t, arms, R);
      const p2 = spiralPoint(arm, Math.min(1, t + 0.03), arms, R);
      ctx.strokeStyle = `rgba(40,26,18,${(0.10 * (1 - t)).toFixed(3)})`;
      ctx.lineWidth = R * 0.03 * (0.4 + (1 - t));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + p.x, cy + p.y);
      ctx.lineTo(cx + p2.x, cy + p2.y);
      ctx.stroke();
    }
  }
  return c;
}

export class MilkyWay {
  /** Root group — add to the host scene. */
  readonly group: THREE.Group;
  /** Radius of the galaxy disc, in scene units. */
  readonly radius: number;

  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private spinGroup!: THREE.Group;
  private sunMarker!: THREE.Group;
  private sunRing!: THREE.Mesh;
  private ringMat!: THREE.MeshBasicMaterial;
  private ringPhase = 0;
  private tween: CameraTween | null = null;
  private panel: HTMLElement | null = null;
  private ac = new AbortController();
  private disposed = false;
  private textures: THREE.Texture[] = [];

  /** Optional host callback for "← Solar System" (return to the overview). */
  onExit: (() => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera;
    this.controls = controls;
    this.radius = 620; // disc radius in scene units (Sun sits ~52% out)
    this.group = new THREE.Group();
    this.group.name = 'Milky Way';
    this.group.visible = false;
    scene.add(this.group);
    this.build();
    this.buildPanel();
  }
  private build(): void {
    this.spinGroup = new THREE.Group();
    this.group.add(this.spinGroup);

    // The galaxy disc — a canvas-painted barred spiral, laid in the XZ plane.
    const tex = new THREE.CanvasTexture(paintGalaxy(1024));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.textures.push(tex);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius, 96),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.96, side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2; // lay flat: +Y up
    this.spinGroup.add(disc);

    // A faint 3D star cloud for depth (points distributed in the flat disc).
    this.spinGroup.add(this.starCloud());

    // The Sun / "you are here" — placed at its true galactic radius.
    const pos = sunScenePosition(this.radius);
    this.sunMarker = new THREE.Group();
    this.sunMarker.position.set(pos.x, pos.y, pos.z);
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(4, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0 }),
    );
    sun.name = 'Sun — You are here';
    this.sunMarker.add(sun);
    this.sunMarker.add(new THREE.PointLight(0xfff2c0, 2.2, 0, 2));
    // pulsing "you are here" ring (lies flat in the disc)
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    this.sunRing = new THREE.Mesh(new THREE.RingGeometry(6, 7.5, 48), this.ringMat);
    this.sunRing.rotation.x = -Math.PI / 2;
    this.sunMarker.add(this.sunRing);
    this.spinGroup.add(this.sunMarker);

    // Subtle ambient so the marker reads (the galaxy itself is unlit/emissive).
    this.group.add(new THREE.AmbientLight(0x223344, 0.6));
  }

  private starCloud(): THREE.Points {
    const N = 4000;
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const rr = Math.sqrt(Math.random()) * this.radius * 0.98;
      const aa = Math.random() * Math.PI * 2;
      arr[i * 3] = Math.cos(aa) * rr;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 34; // the disc is flat
      arr[i * 3 + 2] = Math.sin(aa) * rr;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xcdd6ff, size: 1.5, sizeAttenuation: true,
      transparent: true, opacity: 0.7, depthWrite: false,
    }));
  }

  update(dt: number): void {
    if (this.disposed || !this.group.visible) return;
    this.spinGroup.rotation.y += dt * 0.02; // very slow galactic rotation (Sun orbits too)
    this.ringPhase += dt;                    // pulse the "you are here" ring
    const s = 1 + 0.35 * Math.sin(this.ringPhase * 1.6);
    this.sunRing.scale.setScalar(s);
    this.ringMat.opacity = 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(this.ringPhase * 1.6));
    this.stepTween(dt);
  }

  // ------------------------------------------------------------------
  // NAVIGATION
  // ------------------------------------------------------------------
  overview(): void {
    this.tweenTo(new THREE.Vector3(0, 0, 0), this.radius * 1.9, new THREE.Vector3(0.3, 0.9, 0.4));
  }
  focusSun(): void {
    const p = sunScenePosition(this.radius);
    this.tweenTo(new THREE.Vector3(p.x, p.y, p.z), 60, new THREE.Vector3(0.6, 0.5, 0.5));
  }

  private tweenTo(target: THREE.Vector3, distance: number, dirHint: THREE.Vector3): void {
    const toTgt = target.clone();
    const toPos = toTgt.clone().add(dirHint.clone().normalize().multiplyScalar(distance));
    this.tween = { fromPos: this.camera.position.clone(), toPos, fromTgt: this.controls.target.clone(), toTgt, t: 0, duration: 0.8 };
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
  // DOM PANEL
  // ------------------------------------------------------------------
  private buildPanel(): void {
    const el = document.createElement('div');
    el.className = 'solar-panel';
    el.style.cssText = [
      'position:fixed', 'top:16px', 'left:16px', 'z-index:40',
      'width:244px', 'padding:14px 16px', 'border-radius:14px',
      'background:rgba(10,14,22,0.82)', 'backdrop-filter:blur(10px)',
      'border:1px solid rgba(255,255,255,0.12)', 'color:#e6e6ee',
      'font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    ].join(';');
    el.innerHTML = [
      '<div style="font-weight:600;font-size:14px;margin-bottom:4px">Milky Way — the Galaxy</div>',
      '<div style="opacity:.75;font-size:12px;margin-bottom:10px">',
      'A barred spiral ~100,000 light-years across. The Sun sits ~26,000 ly out in the ',
      'Orion Spur and takes ~230 million years to orbit the centre. ',
      '<b style="color:#ffd27a">The small yellow dot is home.</b></div>',
      '<div style="margin-bottom:8px"><div style="opacity:.7;margin-bottom:2px">Focus</div>',
      '<select data-role="focus" style="width:100%">',
      '<option value="galaxy">Whole galaxy</option>',
      '<option value="sun">Solar System (home)</option>',
      '</select></div>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">',
      '<button data-role="overview">Overview</button>',
      '<button data-role="home">Home</button>',
      '<button data-role="back" style="grid-column:1/-1">← Solar System</button>',
      '</div>',
      '<div style="opacity:.5;font-size:11px;margin-top:10px">Scale not to life-size. Galaxy generated procedurally.</div>',
    ].join('');
    document.body.appendChild(el);
    this.panel = el;

    const focus = el.querySelector('select[data-role="focus"]') as HTMLSelectElement;
    focus.addEventListener('change', () => {
      if (focus.value === 'sun') this.focusSun(); else this.overview();
    }, { signal: this.ac.signal });
    (el.querySelector('button[data-role="overview"]') as HTMLButtonElement)
      .addEventListener('click', () => this.overview(), { signal: this.ac.signal });
    (el.querySelector('button[data-role="home"]') as HTMLButtonElement)
      .addEventListener('click', () => this.focusSun(), { signal: this.ac.signal });
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
    for (const t of this.textures) t.dispose();
    this.textures = [];
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
