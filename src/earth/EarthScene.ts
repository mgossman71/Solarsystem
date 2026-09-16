import * as THREE from 'three';
import { RoamController, type RoamCollider } from './RoamController';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  SunLightingState,
  sunDirectionToward,
} from '../lighting/SunLighting';
import {
  QUALITY_PROFILES,
  QualityProfile,
  QualitySetting,
  QualityTier,
  TEXTURE_PATHS,
  nextTierDown,
  resolveProfile,
} from '../core/Quality';
import { CameraPose, Focus, OrbitMode, ScaleMode } from '../core/types';
import { isPlanetFocus, isPlanetMoonFocus } from '../core/types';
import {
  EARTH_ORBIT_RADIUS,
  INITIAL_MOON_ANGLE,
  INITIAL_SUN_AZIMUTH,
  INITIAL_SUN_ELEVATION,
  MOON_ORBIT_EXPLORE,
  MOON_ORBIT_INCLINATION,
  MOON_ORBIT_PERIOD_REALTIME,
  MOON_ORBIT_PERIOD_VISUAL,
  MOON_ORBIT_REAL,
  MOON_RADIUS,
  SUN_RADIUS,
  wrapAzimuth,
} from '../config/sceneScale';
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  INITIAL_CAMERA_POSITION,
  INTERACTION_SETTLE_MS,
  ORIENTATION_REFRAME_MS,
  SYSTEM_VIEW_MAX_FRAME,
} from '../config/camera';
import { prefersReducedMotion } from '../config/mobile';
import { sunVertexShader, sunFragmentShader } from '../sun/shaders/sun';
import { createStarField } from './StarField';
import { createOrbitRings, orientOrbitRings, setRingBrightness as applyRingBrightness, ORBIT_RING_BRIGHTNESS_MIN, ORBIT_RING_BRIGHTNESS_MAX, ORBIT_RING_BRIGHTNESS_DEFAULT } from '../planets/OrbitRings';
import { earthVertexShader, earthFragmentShader } from '../earth/shaders/earth';
import { cloudVertexShader, cloudFragmentShader } from '../earth/shaders/cloud';
import { atmosphereVertexShader, atmosphereFragmentShader } from '../earth/shaders/atmosphere';
import { moonVertexShader, moonFragmentShader } from '../moon/shaders/moon';
import { PlanetSystem } from '../planets/PlanetSystem';
import {
  MOON_OWNER, PLANETS, PLANET_BY_ID,
  planetFrameRadius, planetMoonRadius, planetOrbitRadius, planetRadius,
  type MoonDef, type PlanetDef,
} from '../planets/registry';

// ============================================================
// SHARED TYPES & SCENE SCALE (extracted into focused modules)
// ============================================================
//   sizes/distances      -> src/config/sceneScale.ts
//   camera + controls    -> src/config/camera.ts
//   shared types         -> src/core/types.ts
//   Sun state + vector   -> src/lighting/SunLighting.ts
// (All of the above are imported at the top of this file.)

// ============================================================
// EARTH SCENE CLASS
// ============================================================

export class EarthScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  /** Live bloom pass (null on the performance tier, which skips it). */
  private bloomPass: UnrealBloomPass | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private roam: RoamController;

  private earthMesh: THREE.Mesh | null = null;
  private cloudMesh: THREE.Mesh | null = null;
  private atmosphereMesh: THREE.Mesh | null = null;
  private starField: THREE.Points | null = null;
  private orbitRings: THREE.Group | null = null;
  /** Scratch body positions for the per-frame ring alignment (Earth first,
   *  then registry order — matches the orbitRings children order). */
  private ringBodyPositions: THREE.Vector3[] = [new THREE.Vector3(), ...PLANETS.map(() => new THREE.Vector3())];
  private earthMaterial: THREE.ShaderMaterial | null = null;
  private cloudMaterial: THREE.ShaderMaterial | null = null;
  private sunRay: THREE.ArrowHelper | null = null;

  // Single authoritative Sun state. `sun.direction` is the APPARENT
  // Earth→Sun direction — one normalized world-space vector shared by
  // reference with the Earth surface, cloud and atmosphere uSunDirection
  // uniforms. Heliocentric inversion: the Sun itself is FIXED at the scene
  // centre (origin), so "moving the Sun" (azimuth/elevation) = moving the
  // EARTH-MOON SYSTEM to the anti-solar point,
  //   earthPos = -EARTH_ORBIT_RADIUS * sun.direction.
  // Either way the relative direction is what every lighting consumer needs,
  // and one write updates every lighting system at once — the layers can
  // never visually disagree.
  private sun = new SunLightingState(INITIAL_SUN_AZIMUTH, INITIAL_SUN_ELEVATION);

  // World position of the EARTH-MOON SYSTEM: Earth orbits the Sun (the scene
  // centre) at EARTH_ORBIT_RADIUS, always opposite the apparent Sun. Field
  // order matters — `sun` (above) is initialized first.
  readonly earthPos = new THREE.Vector3()
    .copy(this.sun.direction)
    .multiplyScalar(-EARTH_ORBIT_RADIUS);

  // The visible Sun: a photosphere mesh + corona halo in one group parked at
  // the SYSTEM CENTRE (origin). It IS the authoritative light source —
  // lighting directions are derived from its position, and every lighting
  // mode (manual, auto, full daylight) moves the Earth-Moon system around it
  // instead of moving the Sun, so the disk, the corona and the illuminated
  // hemispheres always agree.
  private sunGroup: THREE.Group | null = null;
  private sunMesh: THREE.Mesh | null = null;
  private sunMaterial: THREE.ShaderMaterial | null = null;
  private sunCorona: THREE.Sprite | null = null;
  /** World-space position of the light source = the origin (scene centre). */
  private sunWorldPos = new THREE.Vector3();
  /** Per-frame point-source light direction for the Moon (see animate()). */
  private moonSunDir = new THREE.Vector3();
  // Full Daylight: the user's manual Sun, remembered while the Sun follows
  // the camera and restored exactly when the mode is switched off.
  private savedManualSun = { azimuth: INITIAL_SUN_AZIMUTH, elevation: INITIAL_SUN_ELEVATION };
  /** Scratch vector for the per-frame Full Daylight computation. */
  private _sunTmp = new THREE.Vector3();
  /** Scratch vector for repositionEarth(). */
  private readonly _earthTmp = new THREE.Vector3();
  private sunPad: HTMLElement | null = null;
  private padHalf = 60;
  /** Cached Sun-panel DOM refs — resolved once, so the per-frame update
   *  never re-queries the document. */
  private sunUI: {
    azSlider: HTMLInputElement;
    elSlider: HTMLInputElement;
    azVal: HTMLElement;
    elVal: HTMLElement;
    knob: HTMLElement;
  } | null = null;
  /** Last values written to the Sun panel — skip DOM writes when unchanged. */
  private lastAzShown: number | null = null;
  private lastElShown: number | null = null;
  private lastKnobTransform: string | null = null;
  private clock: THREE.Clock;
  /** One signal for every DOM listener this class attaches — abort() in
   *  dispose() removes all of them at once and cannot drift out of sync. */
  private ac = new AbortController();

  private isInteracting = false;
  private interactionTimeout: ReturnType<typeof setTimeout> | null = null;
  /** True once dispose() has run — in-flight texture loads must not attach. */
  private disposed = false;

  /** EARTH-RELATIVE start offset — Earth orbits the Sun (see createCamera). */
  private initialCameraPosition = INITIAL_CAMERA_POSITION.clone();

  private animationId: number | null = null;
  /** Handle for the in-flight reset-view transition (at most one at a time). */
  private resetAnimId: number | null = null;

  // Respect reduced-motion users from the very first frame: no idle spin.
  private state = { autoRotate: !prefersReducedMotion(), atmosphere: true, clouds: true, stars: true, autoSun: false, fullDaylight: false, planetLabels: true, ringBrightness: ORBIT_RING_BRIGHTNESS_DEFAULT };

  // ------------------------------------------------------------
  // ADAPTIVE QUALITY (see Quality.ts)
  // ------------------------------------------------------------
  /** User setting (persisted choice); `auto` resolves from device signals. */
  private qualitySetting: QualitySetting = 'auto';
  /** The concrete profile currently applied to the renderer/scene. */
  private quality: QualityProfile | null = null;
  /** Textures already fetched, keyed by file path — live tier switches reuse them. */
  private textureCache = new Map<string, THREE.Texture>();
  /** Runtime FPS guard state (Auto only; steps down, never up). */
  private fpsGuard = { acc: 0, frames: 0, lastEval: 0, cooldownUntil: 0 };

  // ------------------------------------------------------------
  // MOON + NAVIGATION
  // ------------------------------------------------------------
  private moonMesh: THREE.Mesh | null = null;
  private moonMaterial: THREE.ShaderMaterial | null = null;
  /** All eight planet systems (planet + optional rings + moons) — see `src/planets/`. */
  private planets = new Map<Focus, PlanetSystem>();
  private moonAngle = INITIAL_MOON_ANGLE;
  /** Live Moon world position (earthPos + its local orbit offset). */
  readonly moonPosition = new THREE.Vector3();
  private focus: Focus = 'system';
  /** Focus requested before assets finished loading — applied in loadEarth. */
  private pendingFocus: Focus | null = null;
  private moonOrbit: OrbitMode = 'visualized';
  private scaleMode: ScaleMode = 'explore';

  // Scratch (reused per frame — no allocations in the render loop).
  private _v = new THREE.Vector3();
  private _moonDir = new THREE.Vector3();
  private _moonQuat = new THREE.Quaternion();
  private readonly _plusX = new THREE.Vector3(1, 0, 0);
  private readonly _origin = new THREE.Vector3(0, 0, 0);
  private raycaster = new THREE.Raycaster();
  private _tap = { downX: 0, downY: 0, downT: 0 };

  /**
   * Invisible enlarged raycast targets — real picking hit areas that are
   * comfortably tappable on touch even when the Moon is a sliver in the
   * System view. Material is invisible (renderer skips it) but raycastable,
   * so they never draw anything.
   */
  private hitProxies: { mesh: THREE.Mesh; focus: Focus }[] = [];

  // ------------------------------------------------------------
  // PLANET NAME LABELS (wide "System" overview)
  // ------------------------------------------------------------
  /** One DOM pill per planet in `#planet-labels` — projected to screen space
   *  every frame in updatePlanetLabels(); removed from the DOM in dispose(). */
  private planetLabelEls: { focus: Focus; name: string; el: HTMLElement }[] = [];
  /** One DOM pill per registry moon (plus Earth's special-case Moon) in
   *  `#planet-labels` — shown only while its owner planet (or one of its
   *  moons) is focused, NEVER in the System overview (27 pills over 9 planet
   *  dots would be clutter); projected every frame in updatePlanetLabels();
   *  removed from the DOM in dispose() alongside the planet pills. */
  private moonLabelEls: { focus: Focus; name: string; owner: Focus; el: HTMLElement }[] = [];
  /** Scratch NDC vector for the per-frame label projection (no hot-path
   *  allocations — same discipline as `this._v`). */
  private _labelNdc = new THREE.Vector3();

  // Textures created in loadEarth — material.dispose() does NOT dispose them.
  private textures: THREE.Texture[] = [];
  /** Shared texture loader — planet systems lazy-load their maps through it. */
  private loader: THREE.TextureLoader | null = null;

  private showSunRay = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.clock = new THREE.Clock();
    // Quality must exist before the renderer: pixel-ratio cap, bloom and
    // tessellation all come from it.
    this.quality = resolveProfile(this.qualitySetting);
    this.renderer = this.createRenderer();
    this.scene = new THREE.Scene();
    this.camera = this.createCamera();
    this.roam = this.createRoam();
  }

  init(): void {
    this.applyURLParams();
    // The constructor framed the initial System view for the DEFAULT
    // ('explore') orbit span, but applyURLParams() may have switched to
    // ?scale=real (Pluto 2300 → 3100), so re-fit the top-down camera now the
    // final scale mode is known. Instant snap — no user interaction has
    // happened yet, so no transition is needed (a live toggle later is
    // handled by setScaleMode).
    if (this.focus === 'system') {
      this.camera.position.set(
        0, this.systemFrameDistance(this.camera.fov, this.camera.aspect), 0,
      );
      this.camera.lookAt(this._origin);
      this.roam.syncFromCamera();
    }
    this.createSun();
    this.loadSun();
    this.createComposer();
    this.loadEarth().catch((err) => {
      console.error('Failed to load Earth:', err);
      // Stop the render loop and release GPU resources before showing the
      // overlay — otherwise animate() would keep running requestAnimationFrame
      // forever against a detached canvas.
      this.dispose();
      this.showFatalOverlay('Failed to load Earth textures.');
    });
    this.setupUI();
    this.setupSunUI();
    this.setupPlanetLabels();
    // Normalise the button state to the DEFAULT focus ('system') — the
    // markup only carries static defaults and setFocus() (which would do
    // this) has not run yet. Also hides the Earth-only buttons, which only
    // make sense while Earth is focused.
    this.syncFocusUI();
    this.bindSelection();
    this.createHitProxies();
    if (this.debugEnabled) this.setupDebugPanel();
    this.animate();
  }

  // ------------------------------------------------------------
  // URL PARAMETERS (deterministic scenes for debugging / QA)
  // ------------------------------------------------------------
  // Supported: ?debug  ?clouds=0|1  ?atmosphere=0|1  ?stars=0|1
  //            ?rotate=0|1  ?sun=az,el  ?mode=1|2|3  ?sunray=1
  //            ?focus=earth|moon|sun  ?orbit=paused|visualized|realtime
  //            ?scale=explore|real  ?rings=0..2
  private debugEnabled = false;
  /** The ?debug panel element (on <body>) — removed in dispose(). */
  private debugPanel: HTMLElement | null = null;
  /** Active debug render mode (0 none, 1 normals, 2 sun ramp, 3 white × NdotL).
   *  Mode 3 renders a BARE sphere — every cloud-visibility path must consult
   *  this so a Clouds toggle can't silently re-enable the shell mid-test. */
  private debugMode = 0;
  private pendingDebugMode: number | null = null;
  private pendingSunRay = false;
  private pendingFrontlight = false;
  private pendingSoftfill = false;

  private applyURLParams(): void {
    const params = new URLSearchParams(window.location.search);
    // Quality: ?quality=auto|high|balanced|performance > saved preference.
    const qParam = params.get('quality');
    if (qParam === 'auto' || qParam === 'high' || qParam === 'balanced' || qParam === 'performance') {
      this.qualitySetting = qParam;
    } else {
      try {
        const saved = localStorage.getItem('earth-quality');
        if (saved === 'auto' || saved === 'high' || saved === 'balanced' || saved === 'performance') {
          this.qualitySetting = saved;
        }
      } catch { /* private mode */ }
    }
    if (params.has('debug')) this.debugEnabled = true;
    if (params.get('clouds') === '0') this.state.clouds = false;
    if (params.get('atmosphere') === '0') this.state.atmosphere = false;
    if (params.get('stars') === '0') this.state.stars = false;
    if (params.get('rotate') === '0') this.state.autoRotate = false;
    if (params.get('labels') === '0') this.state.planetLabels = false;
    if (params.get('labels') === '1') this.state.planetLabels = true;
    const ringsParam = params.get('rings');
    if (ringsParam !== null) {
      const r = Number(ringsParam);
      if (Number.isFinite(r)) {
        this.state.ringBrightness = THREE.MathUtils.clamp(
          r, ORBIT_RING_BRIGHTNESS_MIN, ORBIT_RING_BRIGHTNESS_MAX,
        );
      }
    }
    const modeParam = params.get('mode');
    if (modeParam === '1' || modeParam === '2' || modeParam === '3') {
      this.pendingDebugMode = Number(modeParam);
    }
    if (params.get('sunray') === '1') this.pendingSunRay = true;
    if (params.get('frontlight') === '1') this.pendingFrontlight = true;
    if (params.get('softfill') === '1') this.pendingSoftfill = true;
    const orbitParam = params.get('orbit');
    if (orbitParam === 'paused' || orbitParam === 'visualized' || orbitParam === 'realtime') {
      this.moonOrbit = orbitParam;
    }
    if (params.get('scale') === 'real') {
      this.scaleMode = 'real';
    }
    const focusParam = params.get('focus');
    if (
      focusParam === 'system' || focusParam === 'earth' || focusParam === 'moon' ||
      focusParam === 'sun' ||
      isPlanetFocus(focusParam as Focus) || isPlanetMoonFocus(focusParam as Focus)
    ) {
      // Defer every non-default focus until its body exists: loadEarth applies
      // it through setFocus, which checks isFocusReady(). Do NOT assign
      // this.focus here — that would bypass the guard, so getFocus() would
      // report a focus that was never committed and focusCenter() could resolve
      // it against a not-yet-built body. The default is already 'system'
      // (top-down overview, always ready), so ?focus=system is a no-op.
      if (focusParam !== 'system') this.pendingFocus = focusParam as Focus;
    }
    const sunParam = params.get('sun');
    if (sunParam) {
      const [az, el] = sunParam.split(',').map((s) => parseFloat(s));
      if (Number.isFinite(az) && Number.isFinite(el)) {
        // Clamp to valid ranges so ?sun=0,500 cannot yield a nonsense direction.
        this.sun.set(
          THREE.MathUtils.clamp(az, -180, 180),
          THREE.MathUtils.clamp(el, -90, 90),
        );
      }
    }

    // The constructor resolved 'auto' before the URL / localStorage preference
    // was known. Re-resolve here, BEFORE createSun / createComposer / loadEarth
    // build anything from the profile, so every consumer is constructed at the
    // right tier. (Do NOT call applyQuality() here — the composer does not
    // exist yet, and it would be orphaned by init()'s createComposer().)
    const resolved = resolveProfile(this.qualitySetting);
    if (resolved.tier !== this.quality!.tier) {
      this.quality = resolved;
      this.qualityEpoch++;
      this.renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, resolved.pixelRatioCap),
      );
    }
  }

  // ------------------------------------------------------------
  // RENDERER
  // ------------------------------------------------------------
  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      // NOTE: canvas MSAA has no effect here — the scene always renders through
      // the EffectComposer into a render target, where only the target's
      // `samples` (per-tier msaaSamples) apply. Left for clarity, not cost.
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    // NEVER raw window.devicePixelRatio: modern phones report 3 and the
    // extra fill-rate silently destroys the frame budget. Cap per quality
    // tier (2 / 1.75 / 1.5).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality!.pixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    // RoamController already sets touch-action:none on the canvas, so one-finger
    // look and two-finger pinch own the gestures here and the page never
    // scrolls/zooms under them — while UI panels keep normal touch behavior.
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    this.container.appendChild(renderer.domElement);

    // Every listener here rides the shared abort signal — dispose() must be
    // able to remove everything this class attached, including on the
    // load-failure path.
    window.addEventListener('resize', this.onResize, { signal: this.ac.signal });
    // Mobile browsers do not always fire `resize` promptly on rotation —
    // orientationchange is the reliable signal, and visualViewport covers
    // address-bar-driven layout changes on iOS/Android.
    window.addEventListener('orientationchange', this.onOrientationChange, { signal: this.ac.signal });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onResize, { signal: this.ac.signal });
    }
    // Returning from bfcache (iOS back/forward) can leave a stale size.
    window.addEventListener('pageshow', this.onResize, { signal: this.ac.signal });
    return renderer;
  }

  /** Debounced: rotation settles, then reframe if the focus body is cropped. */
  private reframeTimer: number | null = null;
  private onOrientationChange = (): void => {
    this.onResize();
    if (this.reframeTimer != null) clearTimeout(this.reframeTimer);
    this.reframeTimer = window.setTimeout(() => {
      this.reframeTimer = null;
      this.reframeIfOutOfFrame();
    }, ORIENTATION_REFRAME_MS);
  };

  private createCamera(): THREE.PerspectiveCamera {
    // Far plane must clear the far side of the star shell (12000–13000, see
    // sceneScale STAR_FIELD_RADIUS_*) from the OUTERMOST camera — the top-down
    // System overview can sit out to SYSTEM_VIEW_MAX_FRAME (~8000), so the far
    // shell edge is up to ~21000 from it; CAMERA_FAR (25000) clears that.
    const aspect = window.innerWidth / window.innerHeight;
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
    // DEFAULT VIEW = the System: a straight-down overview centred on the Sun
    // (at the origin) with every planet on its orbit below. Individual bodies
    // are reached by fly-to (setFocus). Uses systemFrameDistance() with explicit
    // fov/aspect because this.camera does not exist yet during construction.
    camera.position.set(0, this.systemFrameDistance(CAMERA_FOV, aspect), 0);
    return camera;
  }

  private createRoam(): RoamController {
    // The Sun is the fixed system centre — start looking at the origin
    // (top-down overview), not at Earth (which orbits around it).
    this.camera.lookAt(this._origin);
    const roam = new RoamController(this.camera, this.renderer.domElement);
    roam.syncFromCamera();

    roam.addEventListener('start', () => {
      this.isInteracting = true;
      // User grabbed the camera: bail on any in-flight fly-to so it can't
      // fight the drag, and hand the camera back to free-roam.
      if (this.resetAnimId != null) {
        cancelAnimationFrame(this.resetAnimId);
        this.resetAnimId = null;
      }
      this.roam.endFly();
      if (this.interactionTimeout) clearTimeout(this.interactionTimeout);
    });

    roam.addEventListener('end', () => {
      if (this.interactionTimeout) clearTimeout(this.interactionTimeout);
      this.interactionTimeout = setTimeout(() => { this.isInteracting = false; }, INTERACTION_SETTLE_MS);
    });

    return roam;
  }

  /** Build the live soft-collider list (Sun/Earth/Moon + every planet and its
   *  moons). `position` entries are shared references into the scene, so they
   *  track their bodies every frame; radii are the current rendered sizes, so
   *  this is re-run whenever the scale mode changes. */
  private buildRoamColliders(): RoamCollider[] {
    const list: RoamCollider[] = [];
    // Sun: clear the CORONA halo (SUN_RADIUS*2.75), not just the photosphere —
    // the Sun pose sits above it, but free-roam must not dive through the halo.
    list.push({ position: this.sunWorldPos, radius: SUN_RADIUS * 2.75 });
    // Earth: clear the atmosphere shell (1.08), not just the globe surface (1).
    list.push({ position: this.earthPos, radius: 1.08 });
    list.push({ position: this.moonPosition, radius: MOON_RADIUS });
    for (const sys of this.planets.values()) {
      list.push({ position: sys.position, radius: planetRadius(sys.def) });
      for (let i = 0; i < sys.def.moons.length; i++) {
        list.push({ position: sys.moonWorlds[i], radius: sys.moonRadii[i] });
      }
    }
    return list;
  }

  // ------------------------------------------------------------
  // ASSET LOADING — tier-aware, real fallbacks, progress reporting
  // ------------------------------------------------------------
  /** The first-paint assets tracked via trackAsset() (loadEarth/loadSun/
   *  createMoon). The overlay total is derived from this list — registering a
   *  new tracked asset is all it takes to keep the bar reaching 100%; a hard
   *  `total: 5` could not. */
  private static readonly FIRST_PAINT_ASSETS = [
    'Earth · day map', 'Earth · night lights', 'Earth · clouds',
    'Sun · photosphere', 'Moon · lunar map',
  ];
  private loadingAssets = { total: EarthScene.FIRST_PAINT_ASSETS.length, done: 0 };

  /** Report asset progress on the loading overlay (no-op after load done). */
  private trackAsset<T>(label: string, promise: Promise<T>): Promise<T> {
    const lab = document.getElementById('loading-label');
    if (lab) lab.textContent = label;
    return promise.finally(() => {
      this.loadingAssets.done = Math.min(this.loadingAssets.done + 1, this.loadingAssets.total);
      const pct = Math.round((this.loadingAssets.done / this.loadingAssets.total) * 100);
      const bar = document.getElementById('loading-fill');
      if (bar) bar.style.width = pct + '%';
      if (this.loadingAssets.done >= this.loadingAssets.total) {
        const overlay = document.getElementById('loading');
        if (overlay) {
          overlay.classList.add('done');
          setTimeout(() => overlay.remove(), 800);
        }
      }
    });
  }

  /**
   * Load a texture from the current tier's file list, falling through in
   * order (high-res → low-res real asset, or vice versa) so a failed download
   * degrades gracefully instead of killing the scene. Results are cached by
   * path so live tier switches swap instantly.
   */
  private async loadTextureKey(
    loader: THREE.TextureLoader,
    key: 'day' | 'night' | 'clouds' | 'moon' | 'sun',
  ): Promise<THREE.Texture> {
    const set = this.quality!.textureSet;
    const paths = TEXTURE_PATHS[key][set];
    let lastErr: unknown = null;
    for (const path of paths) {
      const cached = this.textureCache.get(path);
      if (cached) return cached;
      try {
        const tex = await loader.loadAsync(path);
        tex.colorSpace = THREE.SRGBColorSpace;
        if (this.quality!.anisotropy > 0) {
          tex.anisotropy = Math.min(
            this.renderer.capabilities.getMaxAnisotropy(),
            this.quality!.anisotropy,
          );
        }
        this.textureCache.set(path, tex);
        this.textures.push(tex);
        return tex;
      } catch (err) {
        // Real lower-res fallback next (spec: never fake textures, never crash).
        lastErr = err;
        console.warn(`Asset ${key}: ${path} failed; trying next source`, err);
      }
    }
    throw lastErr ?? new Error(`No source available for ${key}`);
  }

  // ------------------------------------------------------------
  // LOAD EARTH TEXTURES & MESHES
  // ------------------------------------------------------------
  private async loadEarth(): Promise<void> {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    const [dayTexture, nightTexture] = await Promise.all([
      this.trackAsset('Earth · day map', this.loadTextureKey(loader, 'day')),
      this.trackAsset('Earth · night lights', this.loadTextureKey(loader, 'night')),
    ]);
    this.loadedAtTier = this.quality!.tier;
    // (dayTexture/nightTexture are already tracked in this.textures by
    // loadTextureKey — one owner per texture.)

    // Both cloud consumers sample only the alpha channel, so a 1x1 fully
    // transparent placeholder is pixel-identical to "no clouds" (cloud shell:
    // density 0 -> discard; surface shadow: smoothstep(0.2, 0.85, 0) -> no
    // dimming). That lets the cloud map — the largest asset — load in the
    // background: first paint no longer waits for it, and a missing asset
    // degrades to a cloudless Earth instead of failing the whole load.
    const noClouds = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    noClouds.needsUpdate = true;
    this.textures.push(noClouds);

    // Earth mesh with custom shader.
    // The surface independently renders a correct day/night hemisphere from
    // (texture + geometry + shared Sun direction) — no dependence on clouds,
    // atmosphere or post-processing.
    const seg = this.quality!.sphereSegments.earth;
    const earthGeometry = new THREE.SphereGeometry(1, seg[0], seg[1]);
    const earthMaterial = new THREE.ShaderMaterial({
      vertexShader: earthVertexShader,
      fragmentShader: earthFragmentShader,
      uniforms: {
        uDayTexture: { value: dayTexture },
        uNightTexture: { value: nightTexture },
        uCloudTexture: { value: noClouds },
        uSunDirection: { value: this.sun.direction },
        uOceanSpecular: { value: 0.45 },
        uNightIntensity: { value: 2.5 },
        uCloudShadowStrength: { value: this.state.clouds ? 0.2 : 0.0 },
        uCloudUVOffset: { value: 0.0 },
        uSoftFill: { value: 0 },
        uDebugMode: { value: 0.0 },
      },
    });
    this.earthMaterial = earthMaterial;
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    // Initial rotation to show North America / Atlantic toward camera
    this.earthMesh.rotation.y = -Math.PI * 0.25;
    this.earthMesh.renderOrder = 0;
    // Born on the orbit (repositionEarth() keeps it there every frame — a
    // mesh spawned at the origin would sit at the Sun until the next sync).
    this.earthMesh.position.copy(this.earthPos);
    this.scene.add(this.earthMesh);

    // Cloud layer (slightly larger) — a satellite cloud map (white with an
    // alpha density channel) rendered as a semi-transparent shell with the
    // same hemisphere lighting model as the surface.
    const cseg = this.quality!.sphereSegments.cloud;
    const cloudGeometry = new THREE.SphereGeometry(1.01, cseg[0], cseg[1]);
    const cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      uniforms: {
        uCloudTexture: { value: noClouds },
        uSunDirection: { value: this.sun.direction },
        uOpacity: { value: 0.9 },
        uSoftFill: { value: 0 },
        uDebugMode: { value: 0.0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.cloudMaterial = cloudMaterial;
    this.cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    this.cloudMesh.rotation.y = -Math.PI * 0.25;
    this.cloudMesh.visible = this.state.clouds;
    this.cloudMesh.renderOrder = 1; // explicit transparent order: surface < clouds < atmosphere
    this.cloudMesh.position.copy(this.earthPos);
    this.scene.add(this.cloudMesh);

    // ?mode=1|2|3 — apply the requested debug render mode once materials exist
    if (this.pendingDebugMode != null) {
      this.debugMode = this.pendingDebugMode;
      earthMaterial.uniforms.uDebugMode.value = this.pendingDebugMode;
      cloudMaterial.uniforms.uDebugMode.value = this.pendingDebugMode;
      // White-sphere test = bare sphere: keep the cloud shell out of the way.
      if (this.pendingDebugMode === 3) this.cloudMesh.visible = false;
    }

    // The cloud map arrives independently of first paint. Swap it into both
    // materials when it does — they only ever read .a, so the placeholder and
    // the real map are interchangeable from the shaders' point of view.
    // (Tier-aware path + real fallback via loadTextureKey; non-blocking.)
    this.trackAsset('Earth · clouds', this.loadTextureKey(loader, 'clouds'))
      .then((cloudTexture) => {
        if (this.disposed) {
          // Scene went away while loading — don't leak the texture.
          cloudTexture.dispose();
          return;
        }
        earthMaterial.uniforms.uCloudTexture.value = cloudTexture;
        cloudMaterial.uniforms.uCloudTexture.value = cloudTexture;
      })
      .catch((err) => {
        console.warn('Cloud map failed to load; continuing without clouds:', err);
      });

    // Atmosphere glow (largest sphere)
    const aseg = this.quality!.sphereSegments.atmosphere;
    const atmoGeometry = new THREE.SphereGeometry(1.08, aseg[0], aseg[1]);
    const atmoMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: {
        uSunDirection: { value: this.sun.direction },
        uIntensity: { value: 1.0 },
      },
      transparent: true,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.atmosphereMesh = new THREE.Mesh(atmoGeometry, atmoMaterial);
    this.atmosphereMesh.visible = this.state.atmosphere;
    this.atmosphereMesh.renderOrder = 2;
    this.atmosphereMesh.position.copy(this.earthPos);
    this.scene.add(this.atmosphereMesh);

    // Moon — exact 0.2727 size ratio to Earth, shared Sun, real lunar map
    // (loads non-blocking; a neutral placeholder occupies the slot first).
    this.createMoon(loader);

    // Planet systems — all eight exist immediately (cheap: placeholder
    // geometry), so Explore buttons and picking always work. Textures are
    // deliberately NOT in the first-paint asset overlay (the systems'
    // neutral placeholders are correct until each map lands): Saturn loads
    // at startup; the rest load on first focus (see setFocus).
    this.loader = loader;
    for (const def of PLANETS) {
      const sys = new PlanetSystem(
        this.scene,
        def,
        this.quality!,
        Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
        (t) => this.textures.push(t),
      );
      this.planets.set(def.id, sys);
      if (this.pendingDebugMode != null) sys.setDebugMode(this.pendingDebugMode);
      if (def.eager) void sys.load(loader);
    }

    // Free-roam soft colliders — one per body. Positions are live references
    // (tracked every frame); radii are the current rendered sizes, so this is
    // re-run on scale-mode change (see setScaleMode).
    this.roam.colliders = this.buildRoamColliders();

    // Star background
    this.starField = createStarField(this.scene, this.quality!.starCount);
    this.starField.visible = this.state.stars;

    // Faint orbit guide rings (see OrbitRings.ts) — orientation for the
    // top-down System overview. Rebuilt on scale-mode change (radii differ).
    // earthPos pre-orients the group so Earth's ring already passes through
    // Earth on frame 1; frame() re-applies the alignment every frame.
    this.orbitRings = createOrbitRings(this.scene, this.scaleMode, this.state.ringBrightness, this.earthPos);

    // Debug: Sun direction ray (hidden unless toggled) — drawn at the Earth
    // center along the shared apparent Sun direction (toward the Sun at the
    // origin). repositionEarth() keeps its origin on the moving Earth.
    this.sunRay = new THREE.ArrowHelper(
      this.sun.direction.clone(),
      this.earthPos.clone(),
      1.8, 0xffcc44, 0.35, 0.18,
    );
    this.sunRay.visible = this.pendingSunRay;
    this.showSunRay = this.pendingSunRay;
    this.scene.add(this.sunRay);

    // QA URL params that need the materials to exist before applying.
    if (this.pendingSoftfill) this.setSoftDaylight(true);
    if (this.pendingFrontlight) this.setFullDaylight(true);
    // The pending flags were consumed above — reset them so the instance
    // doesn't keep reporting already-applied state.
    this.pendingSoftfill = false;
    this.pendingFrontlight = false;
    this.pendingSunRay = false;
    this.pendingDebugMode = null;

    // If the quality tier changed while the first-paint assets were loading
    // (e.g. a fast UI toggle), re-apply the levers now that all consumers exist
    // — this also pulls in the newly-requested texture set.
    if (this.loadedAtTier && this.loadedAtTier !== this.quality!.tier) {
      this.applyQualityLevers(QUALITY_PROFILES[this.loadedAtTier]);
    } else {
      this.applyQualityLevers(this.quality!);
    }

    // Focus requested before the body existed (URL param or fast UI click).
    if (this.pendingFocus) {
      const f = this.pendingFocus;
      this.pendingFocus = null;
      // 'system' is the default focus — the guard mirrors applyURLParams():
      // applying it would be a no-op, but every OTHER value (including
      // 'earth' — ?focus=earth!) must actually land.
      if (f !== 'system') this.setFocus(f);
    }

    // Fade out hint
    setTimeout(() => {
      const hint = document.getElementById('hint');
      if (hint) hint.style.opacity = '0';
    }, 5000);
  }

  // ------------------------------------------------------------
  // SUN — THE VISIBLE LIGHT SOURCE
  // ------------------------------------------------------------
  // The Sun is a real, navigable object AND the authoritative light source.
  // It sits at the SYSTEM CENTRE (origin), and:
  //   • Earth (at earthPos, on its orbit) is lit along
  //     normalize(origin − earthPos) — exactly the shared sun.direction the
  //     existing uniforms already use, so its shading is bit-identical to
  //     the old Earth-at-origin model.
  //   • The Moon is lit from its real world position (sunDirectionToward),
  //     a true point source — which is what makes the lunar phase
  //     geometrically consistent with the visible Sun.
  // Every lighting mode (manual, auto, full daylight) moves the Earth-Moon
  // system around the fixed Sun, so the disk, the corona and the illuminated
  // hemispheres always agree.
  private createSun(): void {
    const group = new THREE.Group();

    // Photosphere: real sphere, 4K solar texture (procedural granulation
    // until it lands, or forever if it fails), limb darkening, and an HDR
    // brightness of ~1.5 so it reads as the scene's brightest object and is the
    // primary bloom source. The bloom threshold (see createComposer) sits high
    // enough that only the Sun and the very brightest limb/specular highlights
    // exceed it.
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uHasMap: { value: 0.0 },
        uTime: { value: 0.0 },
      },
      vertexShader: sunVertexShader,
      fragmentShader: sunFragmentShader,
    });
    const sseg = this.quality!.sphereSegments.sun;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, sseg[0], sseg[1]), material);
    group.add(mesh);

    // Corona: a billboard halo centered on the Sun. Its center sits behind
    // the opaque photosphere (depth test), so only the annular glow around
    // the limb is visible — the classic solar corona, always facing camera.
    const corona = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.makeCoronaTexture(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: this.quality!.coronaOpacity,
    }));
    corona.scale.setScalar(SUN_RADIUS * 5.5);
    group.add(corona);

    this.scene.add(group);
    this.sunGroup = group;
    this.sunMesh = mesh;
    this.sunMaterial = material;
    this.sunCorona = corona;
    this.placeSun();
  }

  /** Soft radial gradient for the corona sprite (generated, no asset). */
  private makeCoronaTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    // Stops relative to the halo radius (= sprite scale / 2 = 2.75 disk
    // radii): the disk limb itself sits at ~0.36 of that radius.
    grad.addColorStop(0.0, 'rgba(255, 252, 240, 1.0)');
    grad.addColorStop(0.36, 'rgba(255, 232, 190, 0.5)');
    grad.addColorStop(0.55, 'rgba(255, 200, 135, 0.2)');
    grad.addColorStop(0.8, 'rgba(255, 168, 92, 0.06)');
    grad.addColorStop(1.0, 'rgba(255, 150, 80, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * The Sun is the fixed system centre: its disk + corona live at the origin
   * and the Earth-Moon system orbits them. "Placing the Sun" therefore just
   * keeps the light source parked at the origin — idempotent, and the single
   * place that keeps `sunWorldPos` authoritative for the lighting math.
   */
  private placeSun(): void {
    if (!this.sunGroup) return;
    this.sunWorldPos.set(0, 0, 0);
    this.sunGroup.position.set(0, 0, 0);
  }

  /**
   * Heliocentric counterpart of "moving the Sun": re-place the entire
   * Earth-Moon system on Earth's orbit about the Sun (the origin) so the
   * apparent Sun direction stays `sun.direction`:
   *
   *   earthPos = -EARTH_ORBIT_RADIUS * sun.direction
   *
   * In free-roam the camera is NOT glued to the body — if a Sun sweep moves
   * the system, the user's camera simply stays put (that's the whole point of
   * an unbound camera). This method only re-syncs the Earth/Moon meshes to
   * the live orbit point. Idempotent: in manual mode it just re-syncs
   * positions, which is what animate() relies on (first frames after load).
   */
  private repositionEarth(): void {
    const newE = this._earthTmp.copy(this.sun.direction).multiplyScalar(-EARTH_ORBIT_RADIUS);
    const dx = newE.x - this.earthPos.x;
    const dy = newE.y - this.earthPos.y;
    const dz = newE.z - this.earthPos.z;
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      this.earthPos.copy(newE);
    }
    // Position sync (idempotent — also covers the first calls after the
    // Earth/Moon meshes were created at the origin).
    if (this.earthMesh) this.earthMesh.position.copy(this.earthPos);
    if (this.cloudMesh) this.cloudMesh.position.copy(this.earthPos);
    if (this.atmosphereMesh) this.atmosphereMesh.position.copy(this.earthPos);
    if (this.sunRay) this.sunRay.position.copy(this.earthPos);
    if (this.moonMesh) this.updateMoonTransform();
  }

  /** Swap the tier-appropriate solar map into the photosphere when it lands. */
  private loadSun(): void {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    this.trackAsset('Sun · photosphere', this.loadTextureKey(loader, 'sun'))
      .then((tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        if (this.sunMaterial) {
          this.sunMaterial.uniforms.uMap.value = tex;
          this.sunMaterial.uniforms.uHasMap.value = 1.0;
        }
      })
      .catch((err) => {
        // Keep the procedural granulation — the Sun still renders.
        console.warn('Sun map failed to load; using procedural granulation:', err);
      });
  }

  // ------------------------------------------------------------
  // POST-PROCESSING — SUN BLOOM
  // ------------------------------------------------------------
  // RenderPass → UnrealBloom → OutputPass. The scene renders into a linear
  // HalfFloat target: three only enables TONE_MAPPING when rendering to the
  // screen, so the OPAQUE layers' (Earth, Moon) tone-mapping/color-space
  // includes are no-ops there and they look exactly as before, and OutputPass
  // applies ACES + sRGB exactly once at the end. Note the transparent layers
  // (clouds' alpha, the additive atmosphere and stars) now blend in LINEAR HDR
  // before that single tone-map, so their apparent brightness shifts slightly
  // versus the old sRGB-framebuffer blending. The bloom threshold (~1.25) sits
  // above 1.0 so only the Sun's HDR values (~1.5) and the very brightest limb
  // and ocean-specular highlights bloom — not the whole atmosphere rim.
  private createComposer(): void {
    const pr = this.renderer.getPixelRatio();
    const size = new THREE.Vector2(
      window.innerWidth * pr,
      window.innerHeight * pr,
    );
    const renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      // MSAA is a pure mobile cost: the performance tier drops it entirely.
      samples: this.quality!.msaaSamples,
    });
    const composer = new EffectComposer(this.renderer, renderTarget);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Soft selective bloom — only the Sun and the brightest limb/specular
    // highlights exceed the threshold; the rest of the scene stays crisp.
    // The performance tier skips the pass (11 extra render targets) entirely.
    if (this.quality!.bloom.enabled) {
      const bloom = new UnrealBloomPass(
        size,
        this.quality!.bloom.strength,
        this.quality!.bloom.radius,
        this.quality!.bloom.threshold,
      );
      composer.addPass(bloom);
      this.bloomPass = bloom;
    }
    composer.addPass(new OutputPass());
    // EffectComposer's constructor sets _width/_height from the (device-pixel)
    // renderTarget size; normalise them to LOGICAL pixels so setSize() /
    // setPixelRatio() scale by the pixel ratio exactly once — otherwise the
    // passes (notably the bloom's 11 blur targets) are allocated 2× too large.
    composer.setSize(window.innerWidth, window.innerHeight);
    this.composer = composer;
  }

  // ------------------------------------------------------------
  // UI — ONE DOM, TWO LAYOUTS
  // ------------------------------------------------------------
  // The buttons live in a single set of elements (#primary-bar + #sheet).
  // Desktop CSS unfolds them into the classic panels; mobile CSS folds them
  // into a bottom sheet. All interaction is delegated to <body>, so the
  // same handler serves both layouts and both pointer types.
  private uiHandler = (e: Event): void => {
    const el = (e.target as HTMLElement | null)?.closest('[data-focus],[data-orbit],[data-scale],[data-action],[data-quality]') as HTMLElement | null;
    if (!el) return;

    const focus = el.dataset.focus as Focus | undefined;
    if (focus) {
      this.setFocus(focus);
      this.collapseSheet(); // the user wants to LOOK, not read settings
      return;
    }

    const orbit = el.dataset.orbit as OrbitMode | undefined;
    if (orbit) { this.setMoonOrbit(orbit); return; }

    const scale = el.dataset.scale as ScaleMode | undefined;
    if (scale) { this.setScaleMode(scale); return; }

    const quality = el.dataset.quality as QualitySetting | undefined;
    if (quality) { this.setQuality(quality); return; }

    // Sun presets / Full Daylight / soft fill are owned by setupSunUI's
    // dedicated listeners (they must stay in sync with panel state) — the
    // delegated handler deliberately skips [data-preset] and sun-mode buttons.
    const action = el.dataset.action;
    switch (action) {
      case 'reset': this.resetView(); break;
      case 'auto-rotate':
        this.state.autoRotate = !this.state.autoRotate;
        this.syncUIButtons();
        break;
      case 'atmosphere':
        this.state.atmosphere = !this.state.atmosphere;
        if (this.atmosphereMesh) this.atmosphereMesh.visible = this.state.atmosphere;
        this.syncUIButtons();
        break;
      case 'clouds':
        this.state.clouds = !this.state.clouds;
        // Mode 3 (white-sphere validation) renders a BARE sphere — the cloud
        // shell stays hidden for the whole test regardless of this toggle.
        if (this.cloudMesh) this.cloudMesh.visible = this.state.clouds && this.debugMode !== 3;
        // Cloud visibility is a pure layer toggle: it never changes the Sun,
        // the surface lighting or the terminator. Only the surface cloud
        // shadows (part of the cloud layer) switch with it.
        if (this.earthMaterial) {
          this.earthMaterial.uniforms.uCloudShadowStrength.value =
            this.state.clouds ? 0.2 : 0.0;
        }
        this.syncUIButtons();
        break;
      case 'labels':
        this.state.planetLabels = !this.state.planetLabels;
        this.syncUIButtons();
        break;
      case 'fullscreen': this.toggleFullscreen(); break;
    }
  };

  private setupUI(): void {
    // Single delegated handler — survives any responsive re-parenting.
    document.body.addEventListener('click', this.uiHandler, { signal: this.ac.signal });

    // Orbit-ring brightness: every layout's slider (desktop bar + mobile sheet)
    // drives the same value; setRingBrightness() re-syncs all of them.
    document.querySelectorAll('[data-rings]').forEach((el) => {
      const input = el as HTMLInputElement;
      input.addEventListener(
        'input',
        () => this.setRingBrightness(parseFloat(input.value) / 100),
        { signal: this.ac.signal },
      );
    });

    // Moon pickers (desktop focus panel + mobile sheet): generate the
    // buttons from the registry; visibility follows the focused planet.
    const focusMoons = document.querySelector('#focus-moons') as HTMLElement | null;
    const sheetMoons = document.querySelector('#sheet-moons') as HTMLElement | null;
    if (focusMoons) this.buildMoonPicker(focusMoons);
    if (sheetMoons) this.buildMoonPicker(sheetMoons);

    // Initial sync pass: URL params (?clouds=0, ?atmosphere=0, ?rotate=0) may
    // have changed the state before this ran — reflect it in the button
    // "active" classes so the UI never lies about the scene.
    this.syncUIButtons();
    // …and hide the Earth-only toggles if a URL param deferred a non-Earth focus.
    this.syncEarthOnlyButtons();

    // Fullscreen does not exist for documents on iOS Safari — hide the
    // control instead of shipping a dead button.
    const fsBtns = Array.from(document.querySelectorAll('[data-action="fullscreen"]'));
    if (!EarthScene.fullscreenSupported()) {
      fsBtns.forEach((b) => { (b as HTMLElement).hidden = true; });
    } else {
      document.addEventListener('fullscreenchange', () => {
        const on = document.fullscreenElement != null;
        fsBtns.forEach((b) => (b as HTMLElement).classList.toggle('active', on));
      }, { signal: this.ac.signal });
    }

    // Quality UI, bottom sheet, interaction dimming.
    this.syncQualityUI();
    this.setupSheet();
    this.setupInteractionDim();
  }

  /**
   * While the user drags/pinches the scene, secondary chrome fades back so
   * the 3D is the focus; it returns when they let go. The primary bar (the
   * only always-visible controls on mobile) is intentionally left alone.
   */
  private setupInteractionDim(): void {
    let restoreTimer: number | null = null;
    this.roam.addEventListener('start', () => {
      if (restoreTimer != null) { clearTimeout(restoreTimer); restoreTimer = null; }
      document.body.classList.add('interacting');
    });
    this.roam.addEventListener('end', () => {
      if (restoreTimer != null) clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        restoreTimer = null;
        document.body.classList.remove('interacting');
      }, 900);
    });
  }

  // ------------------------------------------------------------
  // MOBILE SHEET (collapsed / half / full)
  // ------------------------------------------------------------
  private sheetEl: HTMLElement | null = null;
  private sheetDrag = { y: 0, active: false, moved: false };
  private sheetDragFrom = 0; // offset(px) the drag started from
  private sheetState(): 'collapsed' | 'half' | 'full' {
    return (this.sheetEl?.dataset.sheet as 'collapsed' | 'half' | 'full') || 'collapsed';
  }

  private setupSheet(): void {
    this.sheetEl = document.getElementById('sheet');
    const toggle = document.getElementById('sheet-toggle') as HTMLButtonElement | null;
    const handle = document.getElementById('sheet-handle') as HTMLElement | null;
    const close = document.getElementById('sheet-close') as HTMLButtonElement | null;
    if (!this.sheetEl || !toggle) return;

    toggle.addEventListener('click', () => {
      const s = this.sheetState();
      this.setSheetState(s === 'collapsed' ? 'half' : 'collapsed');
    }, { signal: this.ac.signal });
    close?.addEventListener('click', () => this.setSheetState('collapsed'), { signal: this.ac.signal });
    handle?.addEventListener('click', () => {
      if (this.sheetDrag.moved) { this.sheetDrag.moved = false; return; } // a drag just ended
      const s = this.sheetState();
      this.setSheetState(s === 'collapsed' ? 'half' : s === 'half' ? 'full' : 'collapsed');
    }, { signal: this.ac.signal });

    // Drag the handle to scrub between states (pointer events cover touch +
    // mouse; the canvas behind never sees these because they start on the
    // sheet, not the canvas).
    const onDown = (e: PointerEvent): void => {
      this.sheetDrag = { y: e.clientY, active: true, moved: false };
      this.sheetDragFrom = this.sheetOffset(this.sheetState()); // px
      // NOTE: no setPointerCapture here — capturing on the sheet retargets the
      // click to #sheet and breaks the delegated uiHandler for every control
      // inside it. Capture only once this is a real drag (see onMove).
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.sheetDrag.active) return;
      const dy = e.clientY - this.sheetDrag.y;
      if (!this.sheetDrag.moved) {
        if (Math.abs(dy) <= 8) return; // still a tap — leave the click alone
        this.sheetDrag.moved = true;
        this.sheetEl!.style.transition = 'none';
        this.sheetEl!.setPointerCapture(e.pointerId);
      }
      // target offset: base + dy, clamped between full (0) and collapsed (max).
      const from = this.sheetDragFrom;
      const maxOff = this.sheetOffset('collapsed');
      const target = Math.max(0, Math.min(from + dy, maxOff));
      this.sheetEl!.style.transform = `translateY(${target}px)`;
    };
    const onUp = (e: PointerEvent): void => {
      if (!this.sheetDrag.active) return;
      this.sheetDrag.active = false;
      if (!this.sheetDrag.moved) return; // a tap: let the click through
      try { this.sheetEl!.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      this.sheetEl!.style.transition = '';
      const dy = e.clientY - this.sheetDrag.y;
      const projected = this.sheetDragFrom + dy;
      // Snap to whichever state's offset the projected position is closest to.
      const states: Array<'collapsed' | 'half' | 'full'> = ['collapsed', 'half', 'full'];
      let best = this.sheetState();
      let bestD = Infinity;
      for (const s of states) {
        const d = Math.abs(this.sheetOffset(s) - projected);
        if (d < bestD) { bestD = d; best = s; }
      }
      this.setSheetState(best);
      // `moved` stays true so the click that follows this drag is suppressed;
      // the handle's click listener resets it.
    };
    const sheet = this.sheetEl;
    sheet.addEventListener('pointerdown', onDown, { signal: this.ac.signal });
    sheet.addEventListener('pointermove', onMove, { signal: this.ac.signal });
    sheet.addEventListener('pointerup', onUp, { signal: this.ac.signal });
    sheet.addEventListener('pointercancel', onUp, { signal: this.ac.signal });
    // Escape closes it (a11y parity with a dialog) — but only while the sheet
    // is actually visible (mobile): on desktop #sheet is display:none, where
    // Escape must not mutate scene state, and a collapsed sheet has nothing
    // to close.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.sheetEl) return;
      if (window.getComputedStyle(this.sheetEl).display === 'none') return;
      if (this.sheetState() !== 'collapsed') this.setSheetState('collapsed');
    }, { signal: this.ac.signal });
    // Apply the JS-computed offset for the initial state so the peek matches
    // the visualViewport-based math (not just the CSS dvh fallback), and so
    // the toggle's aria-expanded / active class reflect reality on first paint.
    this.setSheetState(this.sheetState());
  }

  /** translateY offset (px) for a sheet state — single source of truth. */
  private sheetOffset(state: 'collapsed' | 'half' | 'full'): number {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    if (state === 'full') return 0;
    if (state === 'half') return vh * 0.52;
    return vh - 76; // collapsed: a 76px peek (handle + title)
  }

  private setSheetState(state: 'collapsed' | 'half' | 'full'): void {
    if (!this.sheetEl) return;
    this.sheetEl.dataset.sheet = state;
    this.sheetEl.style.transition = '';
    this.sheetEl.style.transform = `translateY(${this.sheetOffset(state)}px)`;
    const toggle = document.getElementById('sheet-toggle') as HTMLButtonElement | null;
    if (toggle) {
      const openish = state !== 'collapsed';
      toggle.setAttribute('aria-expanded', String(openish));
      toggle.classList.toggle('active', openish);
    }
  }

  private collapseSheet(): void {
    if (this.sheetEl && this.sheetState() !== 'collapsed') this.setSheetState('collapsed');
  }

  /**
   * Reflect `this.state` into the main UI toggle buttons. Every code path
   * that flips clouds/atmosphere/auto-rotate (main UI, debug panel, URL
   * params) must end here so the buttons never desync from the scene.
   * Works on ALL instances of a control (both layouts share the same DOM).
   */
  private syncUIButtons(): void {
    const sync = (action: string, on: boolean): void => {
      document.querySelectorAll(`[data-action="${action}"]`).forEach((el) => {
        const h = el as HTMLElement;
        h.classList.toggle('active', on);
        h.setAttribute('aria-pressed', String(on));
      });
    };
    sync('auto-rotate', this.state.autoRotate);
    sync('atmosphere', this.state.atmosphere);
    sync('clouds', this.state.clouds);
    sync('labels', this.state.planetLabels);
    this.syncRingUI();
  }

  /**
   * Smoothly return the camera to the initial view = the top-down System
   * overview. Delegates to the shared focus transition (see setFocus) so
   * Reset and the Explore selector can never fight each other. Cancels if
   * the user grabs the camera mid-flight (resetAnimId).
   */
  private resetView(): void {
    this.setFocus('system');
  }

  // ------------------------------------------------------------
  // RUNTIME QUALITY SWITCHING
  // ------------------------------------------------------------
  /** Bumped on every tier change so in-flight texture loads can detect staleness. */
  private qualityEpoch = 0;
  /** Tier whose texture set actually produced the first-paint assets (mid-load changes). */
  private loadedAtTier: QualityTier | null = null;

  /** Public: set the quality setting (persisted) and apply it live. */
  setQuality(setting: QualitySetting): void {
    this.qualitySetting = setting;
    try { localStorage.setItem('earth-quality', setting); } catch { /* private mode */ }
    this.applyQuality();
  }

  /** Public (tests / debugging): the currently applied tier. */
  getActiveTier(): QualityTier { return this.quality!.tier; }
  /** Public (tests): the user setting, e.g. 'auto'. */
  getQualitySetting(): QualitySetting { return this.qualitySetting; }
  /** Public (tests): the active focus. */
  getFocus(): Focus { return this.focus; }

  /** Resolve the setting and push the profile through every cost lever. */
  private applyQuality(): void {
    const profile = resolveProfile(this.qualitySetting);
    const prev = this.quality!;
    if (profile.tier !== prev.tier) this.qualityEpoch++;
    this.quality = profile;

    this.applyQualityLevers(prev);

    this.syncQualityUI();
  }

  /** Free composer passes + targets. EffectComposer.dispose() does NOT free
   *  passes added via addPass() — UnrealBloomPass alone owns 11 render
   *  targets (plus OutputPass's material/quad); without this, every tier
   *  switch and every dispose leaks them to the GPU. */
  private disposeComposer(): void {
    if (!this.composer) return;
    for (const pass of this.composer.passes) {
      (pass as { dispose?: () => void }).dispose?.();
    }
    this.composer.dispose();
    this.composer = null;
    this.bloomPass = null;
  }

  /** The renderer-facing levers (pixel ratio, bloom, stars, segments, textures). */
  private applyQualityLevers(prev?: QualityProfile): void {
    const profile = this.quality!;
    const from = prev ?? profile;

    // 1) Pixel ratio — the single biggest fill-rate lever on 3x-DPR phones.
    const pr = Math.min(window.devicePixelRatio, profile.pixelRatioCap);
    this.renderer.setPixelRatio(pr);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    // 2) Bloom + MSAA live on the composer render target: rebuild only when
    //    the topology (bloom pass present / MSAA count) actually changes —
    //    parameter-only changes apply in place.
    const prevBloom = this.bloomPass != null;
    const wantBloom = profile.bloom.enabled;
    if (prevBloom !== wantBloom || from.msaaSamples !== profile.msaaSamples) {
      this.disposeComposer();
      this.createComposer();
    } else if (this.bloomPass) {
      this.bloomPass.strength = profile.bloom.strength;
      this.bloomPass.radius = profile.bloom.radius;
      this.bloomPass.threshold = profile.bloom.threshold;
    }

    // 3) Corona — cheap uniform.
    if (this.sunCorona) {
      (this.sunCorona.material as THREE.SpriteMaterial).opacity = profile.coronaOpacity;
    }

    // 4) Star count — rebuild the point cloud (small buffer, cheap at runtime).
    if (this.starField && this.starField.geometry.attributes.position.count !== profile.starCount) {
      const parent = this.starField.parent;
      const visible = this.starField.visible;
      const order = this.starField.renderOrder;
      const material = this.starField.material;
      parent?.remove(this.starField);
      this.starField.geometry.dispose();
      this.starField = null;
      const fresh = createStarField(this.scene, this.quality!.starCount);
      // createStarField always builds a fresh material — free it, we reuse
      // the previous one (same shader source, so nothing is lost).
      (fresh.material as THREE.Material).dispose();
      fresh.material = material;
      fresh.renderOrder = order;
      fresh.visible = visible;
      this.starField = fresh;
    }

    // 5) Sphere tessellation — swap geometries in place (skipped pre-first-paint
    //    when the meshes don't exist yet — they were already built at this tier).
    if (this.earthMesh) {
      const seg = profile.sphereSegments;
      this.swapGeometry(this.earthMesh, new THREE.SphereGeometry(1, seg.earth[0], seg.earth[1]));
      this.swapGeometry(this.cloudMesh, new THREE.SphereGeometry(1.01, seg.cloud[0], seg.cloud[1]));
      this.swapGeometry(this.atmosphereMesh, new THREE.SphereGeometry(1.08, seg.atmosphere[0], seg.atmosphere[1]));
      this.swapGeometry(this.moonMesh, new THREE.SphereGeometry(MOON_RADIUS, seg.moon[0], seg.moon[1]));
      if (this.sunMesh) this.swapGeometry(this.sunMesh, new THREE.SphereGeometry(SUN_RADIUS, seg.sun[0], seg.sun[1]));
      for (const sys of this.planets.values()) sys.swapSegments(seg);
    }

    // 6) Texture set — load the other set on demand, then swap into uniforms.
    //    (Cached textures make the second switch instant.)
    if (from.textureSet !== profile.textureSet && this.earthMaterial) {
      void this.swapTextureSet(profile);
    }
  }

  private swapGeometry(mesh: THREE.Mesh | null, next: THREE.BufferGeometry): void {
    if (!mesh) return;
    const old = mesh.geometry;
    mesh.geometry = next;
    old.dispose();
  }

  /** Load the new tier's texture set and swap it into every consumer. */
  private async swapTextureSet(_profile: QualityProfile): Promise<void> {
    const epoch = this.qualityEpoch;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    try {
      const [day, night, clouds, moon, sun] = await Promise.all([
        this.loadTextureKey(loader, 'day'),
        this.loadTextureKey(loader, 'night'),
        this.loadTextureKey(loader, 'clouds').catch(() => null),
        this.loadTextureKey(loader, 'moon').catch(() => null),
        this.loadTextureKey(loader, 'sun').catch(() => null),
      ]);
      if (this.disposed || epoch !== this.qualityEpoch) return; // stale
      if (this.earthMaterial) {
        this.earthMaterial.uniforms.uDayTexture.value = day;
        this.earthMaterial.uniforms.uNightTexture.value = night;
      }
      if (clouds) {
        if (this.earthMaterial) this.earthMaterial.uniforms.uCloudTexture.value = clouds;
        if (this.cloudMaterial) this.cloudMaterial.uniforms.uCloudTexture.value = clouds;
      }
      if (moon && this.moonMaterial) this.moonMaterial.uniforms.uTexture.value = moon;
      if (sun && this.sunMaterial) {
        this.sunMaterial.uniforms.uMap.value = sun;
        this.sunMaterial.uniforms.uHasMap.value = 1.0;
      }
    } catch (err) {
      console.warn('Quality texture swap failed; keeping previous set:', err);
    }
  }

  /** Mirror the setting + active tier into the Quality buttons. */
  private syncQualityUI(): void {
    const activeTier = this.quality!.tier;
    document.querySelectorAll('[data-quality]').forEach((el) => {
      const h = el as HTMLElement;
      const on = h.dataset.quality === this.qualitySetting;
      h.classList.toggle('active', on);
      h.setAttribute('aria-pressed', String(on));
      // Publish the resolved tier on the Auto button so its tooltip can
      // show exactly which profile the device is running right now.
      if (h.dataset.quality === 'auto') h.dataset.tier = activeTier;
      if (on && h.dataset.quality === 'auto') {
        h.title = `Auto — rendering at ${activeTier}`;
      } else {
        h.removeAttribute('title');
      }
    });
  }

  // ------------------------------------------------------------
  // MOON — MESH, ORBIT, TIDAL LOCK
  // ------------------------------------------------------------
  private createMoon(loader: THREE.TextureLoader): void {
    const mseg = this.quality!.sphereSegments.moon;
    const geometry = new THREE.SphereGeometry(MOON_RADIUS, mseg[0], mseg[1]);

    // Grey placeholder so the Moon (and its exact 0.2727 scale) exists in
    // the first frame; the real lunar map swaps in when it lands — the same
    // non-blocking pattern the cloud layer uses.
    const placeholder = new THREE.DataTexture(new Uint8Array([150, 150, 148, 255]), 1, 1);
    placeholder.colorSpace = THREE.SRGBColorSpace;
    placeholder.needsUpdate = true;
    this.textures.push(placeholder);

    const material = new THREE.ShaderMaterial({
      vertexShader: moonVertexShader,
      fragmentShader: moonFragmentShader,
      uniforms: {
        uTexture: { value: placeholder },
        // Point-source light: recomputed every frame from the Sun's real
        // world position (sunDirectionToward, see animate) so the lunar
        // phase follows true Sun–Earth–Moon geometry rather than the shared
        // parallel-ray direction the rest of the scene uses.
        uSunDirection: { value: this.moonSunDir },
        uBumpScale: { value: 1.6 },
        uDebugMode: { value: 0.0 },
      },
    });
    if (this.pendingDebugMode != null) material.uniforms.uDebugMode.value = this.pendingDebugMode;

    this.moonMaterial = material;
    this.moonMesh = new THREE.Mesh(geometry, material);
    this.updateMoonTransform();
    this.scene.add(this.moonMesh);

    this.trackAsset('Moon · lunar map', this.loadTextureKey(loader, 'moon'))
      .then((tex) => {
        if (this.disposed) {
          // Scene went away while loading — don't leak the texture.
          tex.dispose();
          return;
        }
        if (this.moonMaterial) this.moonMaterial.uniforms.uTexture.value = tex;
      })
      .catch((err) => {
        console.warn('Moon map failed to load; continuing with the placeholder:', err);
      });
  }

  /**
   * Position + tidal lock from the current angle/scale.
   *
   * Orbit: circle of radius R in a plane tilted MOON_ORBIT_INCLINATION
   * (the real 5.145°) about the X axis.
   *
   * Tidal lock: the shipped equirectangular map has its prime meridian
   * (near-side center, u=0.5) at local +X at identity orientation (verified
   * against three.js SphereGeometry). Rotating +X onto the Earth-facing
   * direction each frame therefore keeps the same face toward Earth —
   * an exact lock with no accumulated spin that could ever drift.
   */
  private updateMoonTransform(): void {
    const R = this.scaleMode === 'real' ? MOON_ORBIT_REAL : MOON_ORBIT_EXPLORE;
    const a = this.moonAngle;
    const s = Math.sin(a);
    // Local orbit offset about Earth (the 5.145°-tilted circle), expressed in
    // WORLD space — Earth itself sits at earthPos on its orbit about the Sun.
    const lx = R * Math.cos(a);
    const ly = R * s * Math.sin(MOON_ORBIT_INCLINATION);
    const lz = R * s * Math.cos(MOON_ORBIT_INCLINATION);
    this.moonPosition.set(
      this.earthPos.x + lx,
      this.earthPos.y + ly,
      this.earthPos.z + lz,
    );
    if (!this.moonMesh) return;
    this.moonMesh.position.copy(this.moonPosition);
    // Tidal lock: face EARTH — the LOCAL offset, not the world position (the
    // prime meridian points at the planet, not the Sun).
    this._moonDir.set(-lx, -ly, -lz).normalize();
    this._moonQuat.setFromUnitVectors(this._plusX, this._moonDir);
    this.moonMesh.quaternion.copy(this._moonQuat);
  }

  // ------------------------------------------------------------
  // FOCUS / CAMERA NAVIGATION (Earth · Moon · System)
  // ------------------------------------------------------------
  private orbitRadius(): number {
    return this.scaleMode === 'real' ? MOON_ORBIT_REAL : MOON_ORBIT_EXPLORE;
  }

  /** Resolve the live world-space center of the current focus target. */
  private focusCenter(out: THREE.Vector3): THREE.Vector3 {
    if (this.focus === 'system') return out.copy(this._origin);
    if (this.focus === 'sun') return out.copy(this.sunWorldPos);
    if (this.focus === 'moon') return out.copy(this.moonPosition);
    if (isPlanetFocus(this.focus)) {
      const sys = this.planets.get(this.focus);
      if (sys) return sys.center(out);
    }
    if (isPlanetMoonFocus(this.focus)) {
      const owner = MOON_OWNER[this.focus];
      const sys = owner ? this.planets.get(owner) : null;
      if (sys) {
        // (Writing into `out` directly is safe: copy-on-self is a no-op.)
        return sys.moonWorld(this.focus, out) ?? out.copy(this._origin);
      }
    }
    // 'earth' (the only remaining case): the Earth-Moon system's live world
    // position on its orbit about the Sun.
    return out.copy(this.earthPos);
  }

  /**
   * Camera distance (from the target) at which a sphere of `radius` plus an
   * optional extra half-span fits WITHOUT CROPPING in the CURRENT aspect.
   *
   * The vertical FOV is fixed (45°) but the horizontal half-angle shrinks as
   * the aspect gets narrow — exactly the portrait-phone case where the old
   * vertical-only math let the limb (or the Moon) run off the screen edges:
   *   tan(hfov/2) = tan(vfov/2) × aspect
   * so we fit against the tighter of the two axes and take the max distance.
   */
  private fitDistance(radius: number, extraHalfSpan = 0, margin = 1.0): number {
    const span = radius + extraHalfSpan;
    const vTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const hTan = vTan * this.camera.aspect;
    if (vTan <= 0 || hTan <= 0) return radius * 2.4;
    return (Math.max(span / vTan, span / hTan)) * margin;
  }

  /** Straight-down distance at which the OUTERMOST orbit (current scale
   *  mode) fits WITHOUT CROPPING in the given fov/aspect, capped so narrow
   *  aspects stay sane and zoomable (see SYSTEM_VIEW_MAX_FRAME). Takes
   *  explicit fov/aspect so it can run before this.camera exists (createCamera). */
  private systemFrameDistance(fovDeg: number, aspect: number): number {
    let outer = EARTH_ORBIT_RADIUS;
    for (const p of PLANETS) outer = Math.max(outer, planetOrbitRadius(p, this.scaleMode));
    const vTan = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
    const hTan = vTan * aspect;
    if (vTan <= 0 || hTan <= 0) return SYSTEM_VIEW_MAX_FRAME;
    return Math.min(Math.max(outer / vTan, outer / hTan) * 1.1, SYSTEM_VIEW_MAX_FRAME);
  }

  private computeFocusPose(focus: Focus): CameraPose {
    if (focus === 'system') {
      // Straight-down overview of the whole system, centred on the Sun.
      const dist = this.systemFrameDistance(this.camera.fov, this.camera.aspect);
      return {
        position: new THREE.Vector3(0, dist, 0),
        target: this._origin.clone(),
      };
    }
    if (focus === 'earth') {
      const dir = this.initialCameraPosition.clone().normalize();
      // Keep the globe (and its 1.08 atmosphere shell) fully in frame even on
      // narrow portrait screens; 3.2 is just the desktop minimum, never a
      // ceiling on how far we may pull back. The pose is RELATIVE TO EARTH'S
      // LIVE POSITION — the fly-to (animateCameraTo) chases it while in flight.
      const dist = Math.max(
        this.initialCameraPosition.length(),
        this.fitDistance(1.08, 0, 1.06),
      );
      return {
        position: this.earthPos.clone().addScaledVector(dir, dist),
        target: this.earthPos.clone(),
      };
    }
    if (focus === 'moon') {
      const target = this.moonPosition.clone();
      const dir = this._v.copy(this.camera.position).sub(target);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0.25, 1);
      dir.normalize();
      // 1.4 is the desktop minimum; narrow screens pull back until the whole
      // lunar disk fits horizontally as well as vertically.
      const dist = Math.max(1.4, this.fitDistance(MOON_RADIUS, 0, 1.25));
      return {
        position: target.clone().addScaledVector(dir, dist),
        target,
      };
    }
    if (focus === 'sun') {
      const target = this.sunWorldPos.clone();
      const dir = this._v.copy(this.camera.position).sub(target);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0.25, 1);
      dir.normalize();
      // ~3.5 disk radii on desktop; pull back so the full corona halo (2.75
      // radii) stays in frame on narrow aspects.
      const dist = Math.max(SUN_RADIUS * 3.5, this.fitDistance(SUN_RADIUS * 2.75, 0, 1.05));
      return {
        position: target.clone().addScaledVector(dir, dist),
        target,
      };
    }
    if (isPlanetFocus(focus)) {
      const sys = this.planets.get(focus)!;
      const target = sys.center(this._v).clone();
      const dir = this._v.copy(this.camera.position).sub(target);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0.25, 1);
      dir.normalize();
      // The default sun sits NEARLY SIDE-ON to Saturn (Earth-view fly-in
      // lands on the night side — the disk goes black). Swing the approach
      // direction onto the sunlit hemisphere: guarantee dir·sunDir ≥ ~0.35
      // (a comfortable ~70° phase) while preserving the approach angle as
      // much as possible. k is the exact blend that hits the 0.35 floor.
      const sunDir = this._moonDir.copy(this.sunWorldPos).sub(target).normalize();
      const facing = dir.dot(sunDir);
      if (facing < 0.35) dir.addScaledVector(sunDir, (0.35 - facing) / 0.65).normalize();
      // Frame the FULL ring span (Saturn) or body (the rest) on any aspect.
      const dist = Math.max(this.fitDistance(planetFrameRadius(sys.def), 0, 1.15),
                            planetRadius(sys.def) * 1.6);
      return {
        position: target.clone().addScaledVector(dir, dist),
        target,
      };
    }
    if (isPlanetMoonFocus(focus)) {
      const owner = MOON_OWNER[focus];
      const sys = owner ? this.planets.get(owner) : null;
      const mw = sys?.moonWorld(focus, this._v);
      if (sys && mw) {
        const target = mw.clone();
        const dir = this._v.copy(this.camera.position).sub(target);
        if (dir.lengthSq() < 1e-8) dir.set(0, 0.25, 1);
        dir.normalize();
        // Same night-side guard as the planet (moons share its sun geometry).
        const sunDir = this._moonDir.copy(this.sunWorldPos).sub(target).normalize();
        const facing = dir.dot(sunDir);
        if (facing < 0.35) dir.addScaledVector(sunDir, (0.35 - facing) / 0.65).normalize();
        const r = sys.moonRadius(focus) ?? 0.4;
        const dist = Math.max(r * 1.9, this.fitDistance(r, 0, 1.3));
        return {
          position: target.clone().addScaledVector(dir, dist),
          target,
        };
      }
    }
    // Defensive fallback (every known focus is handled above): Earth pose.
    return this.computeFocusPose('earth');
  }

  /**
   * Post-orientation-change safety net: if the current view no longer contains
   * the focused body (narrow axis cropped it), glide out to a framing that
   * does. Never pulls the camera closer and never fights an in-flight
   * transition — a deliberate zoom-in by the user is respected.
   */
  private reframeIfOutOfFrame(): void {
    if (this.resetAnimId != null || this.disposed) return;
    // Deferred focus whose body is still loading: skip the reframe rather
    // than frame a stale origin (Moon at 0,0,0) or touch a null Saturn
    // (the M1 crash path on a mobile orientation change).
    if (!this.isFocusReady(this.focus)) return;
    const focus = this.focus;
    const target = this.focusCenter(this._v);
    const cameraDist = this.camera.position.distanceTo(target);
    const margin = 1.08;
    let required: number; // every branch below assigns before the read
    if (focus === 'system') required = this.systemFrameDistance(this.camera.fov, this.camera.aspect);
    else if (focus === 'earth') required = this.fitDistance(1.08, 0, margin);
    else if (focus === 'moon') required = this.fitDistance(MOON_RADIUS, 0, margin * 1.1);
    else if (focus === 'sun') required = this.fitDistance(SUN_RADIUS * 2.75, 0, margin * 1.05);
    else if (isPlanetFocus(focus)) {
      const sys = this.planets.get(focus);
      required = this.fitDistance(sys ? planetFrameRadius(sys.def) : 20, 0, margin * 1.1);
    }
    else if (isPlanetMoonFocus(focus)) {
      const owner = MOON_OWNER[focus];
      const sys = owner ? this.planets.get(owner) : null;
      const r = sys?.moonRadius(focus) ?? 0.4;
      required = this.fitDistance(r, 0, margin * 1.3);
    }
    else required = this.fitDistance(this.orbitRadius() * 0.5 + MOON_RADIUS, 0, margin * 1.1);
    if (cameraDist >= required) return; // already framed — user's orbit stays put
    this.animateCameraTo(this.computeFocusPose(focus), 550);
  }

  /**
   * Animate the camera to a pose. Wall-clock driven (frame-rate independent),
   * single stored handle so rapid re-selection cannot stack competing
   * chains; a user grab cancels it (resetAnimId). The END target is
   * re-resolved every frame via focusCenter(), so while the Moon orbits
   * mid-flight the transition keeps chasing its live position.
   */
  private animateCameraTo(pose: CameraPose, durationMs = 900): void {
    if (this.resetAnimId != null) cancelAnimationFrame(this.resetAnimId);
    if (prefersReducedMotion()) durationMs = 0;
    const startPos = this.camera.position.clone();
    // Free-roam has no pivot: the fly drives the camera directly (position +
    // lookAt). beginFly() suspends user input so it can't fight the transition.
    this.roam.beginFly();
    if (durationMs <= 0) {
      this.camera.position.copy(pose.position);
      this.camera.lookAt(this.focusCenter(this._v));
      this.roam.endFly();
      this.resetAnimId = null;
      return;
    }
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min((now - t0) / durationMs, 1);
      const ease = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(startPos, pose.position, ease);
      // Live end-target: the body (Moon / planet) may move while we fly.
      this.camera.lookAt(this.focusCenter(this._v));
      if (t < 1) {
        this.resetAnimId = requestAnimationFrame(step);
      } else {
        this.resetAnimId = null;
        this.roam.endFly();
      }
    };
    this.resetAnimId = requestAnimationFrame(step);
  }

  private syncFocusUI(): void {
    // A request deferred for a still-loading body shows as selected already,
    // so the UI gives immediate feedback while the camera waits for it.
    const active = this.pendingFocus ?? this.focus;
    document.querySelectorAll('[data-focus]').forEach((el) => {
      const h = el as HTMLElement;
      h.classList.toggle('active', h.dataset.focus === active);
      h.setAttribute('aria-pressed', String(h.dataset.focus === active));
    });
    // Moon pickers: show only the moons of the planet we are looking at
    // (focused planet, or the owner of the focused moon).
    const owner = isPlanetFocus(active) ? active
      : isPlanetMoonFocus(active) ? MOON_OWNER[active]
      : null;
    const row = document.querySelector('#focus-moons');
    if (row) (row.closest('.focus-row') as HTMLElement | null)?.setAttribute('hidden', String(owner == null));
    const section = document.querySelector('#sheet-moons-section');
    if (section) section.setAttribute('hidden', String(owner == null));
    document.querySelectorAll('[data-moon-owner]').forEach((el) => {
      (el as HTMLElement).hidden = owner == null || (el as HTMLElement).dataset.moonOwner !== owner;
    });
    this.syncEarthOnlyButtons();
  }

  /**
   * Auto Rotate / Atmosphere / Clouds are Earth-specific layers — they only
   * make sense while Earth is the focused body, so they are only VISIBLE then
   * (in both layouts: the desktop bar and the mobile sheet). Falls back on
   * pendingFocus like syncFocusUI so a deferred request stays honest.
   */
  private syncEarthOnlyButtons(): void {
    const earthActive = (this.pendingFocus ?? this.focus) === 'earth';
    for (const action of ['auto-rotate', 'atmosphere', 'clouds']) {
      document.querySelectorAll(`[data-action="${action}"]`).forEach((el) => {
        (el as HTMLElement).hidden = !earthActive;
      });
    }
  }

  /** Populate a moon button group (desktop panel / mobile sheet) from the
   *  registry — every moon of every planet, tagged with its owner so
   *  `syncFocusUI` can show just the relevant set. */
  private buildMoonPicker(container: HTMLElement): void {
    container.innerHTML = '';
    for (const def of PLANETS) {
      for (const m of def.moons) {
        const b = document.createElement('button');
        b.className = 'seg-btn';
        b.dataset.focus = m.id;
        b.dataset.moonOwner = def.id;
        b.textContent = m.name;
        b.hidden = true; // revealed by syncFocusUI when the owner is focused
        container.appendChild(b);
      }
    }
  }

  /** True once the body behind `f` has been built (Earth/Sun exist before
   *  any UI is wired; Moon and Saturn arrive with the first-paint assets). */
  private isFocusReady(f: Focus): boolean {
    if (f === 'system') return true;
    if (f === 'earth' || f === 'sun') return true;
    if (f === 'moon') return this.moonMesh != null;
    if (isPlanetFocus(f)) return this.planets.has(f);
    if (isPlanetMoonFocus(f)) return this.planets.has(MOON_OWNER[f]);
    return false;
  }

  /**
   * Switch focus (Earth / Moon / Sun / planets / moons): fly the free-roam
   * camera to the new body with a cinematic transition. While focused on a
   * moving body, the transition keeps chasing its live position (focusCenter)
   * every frame.
   *
   * The focus is only COMMITTED once its body exists: while it's still
   * loading, the request waits in pendingFocus (applied by loadEarth), so
   * per-frame code (orientation reframes, scale changes) can never frame a
   * stale origin or touch a not-yet-constructed Saturn.
   */
  private setFocus(f: Focus): void {
    if (!this.isFocusReady(f)) {
      this.pendingFocus = f;
      this.syncFocusUI();
      return;
    }
    this.pendingFocus = null;
    this.focus = f;
    this.syncFocusUI();
    // First focus on a planet: start loading its texture set (idempotent —
    // the placeholder is a correct neutral until the real maps land).
    if (this.loader) {
      const owner = isPlanetFocus(f) ? f : isPlanetMoonFocus(f) ? MOON_OWNER[f] : null;
      if (owner) this.planets.get(owner)?.load(this.loader);
    }
    this.animateCameraTo(this.computeFocusPose(f));
  }

  private setMoonOrbit(mode: OrbitMode): void {
    this.moonOrbit = mode; // planets read the same mode from their per-frame params
    document.querySelectorAll('[data-orbit]').forEach((el) => {
      const h = el as HTMLElement;
      h.classList.toggle('active', h.dataset.orbit === mode);
      h.setAttribute('aria-pressed', String(h.dataset.orbit === mode));
    });
  }

  private setScaleMode(mode: ScaleMode): void {
    if (mode === this.scaleMode) return;
    this.scaleMode = mode;
    this.updateMoonTransform();
    for (const sys of this.planets.values()) sys.applyScaleMode(mode);
    // Radii changed — refresh the free-roam soft colliders to the new sizes.
    this.roam.colliders = this.buildRoamColliders();
    // The orbit span changed — the faint guide rings must follow the new radii.
    this.rebuildOrbitRings();
    document.querySelectorAll('[data-scale]').forEach((el) => {
      const h = el as HTMLElement;
      h.classList.toggle('active', h.dataset.scale === mode);
      h.setAttribute('aria-pressed', String(h.dataset.scale === mode));
    });
    // The orbit span changed — re-frame if we are looking at it (and its
    // body exists — a deferred focus must not compute a pose against null).
    if (this.focus !== 'earth' && this.isFocusReady(this.focus)) {
      this.animateCameraTo(this.computeFocusPose(this.focus));
    }
  }

  /** Swap the orbit guide rings for the new scale mode (radii differ). The ring
   *  geometries are per-line; the material is shared across every ring, so it
   *  is disposed once (grabbed from the first child). */
  private rebuildOrbitRings(): void {
    const old = this.orbitRings;
    if (old) {
      this.scene.remove(old);
      for (const child of old.children) (child as THREE.Line).geometry.dispose();
      // All rings share one material — dispose it once via the first child.
      const mat = (old.children[0] as THREE.Line)?.material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
      this.orbitRings = null;
    }
    this.orbitRings = createOrbitRings(this.scene, this.scaleMode, this.state.ringBrightness, this.earthPos);
  }

  /**
   * Update the orbit-ring brightness (colour intensity) live — no geometry
   * rebuild. Clamps to the supported range, stores it in state, applies it to
   * the built rings (if any), and reflects it in every layout's slider.
   * Opacity stays fixed (see OrbitRings.ts); only the colour intensity changes.
   */
  private setRingBrightness(brightness: number): void {
    const b = THREE.MathUtils.clamp(
      brightness,
      ORBIT_RING_BRIGHTNESS_MIN,
      ORBIT_RING_BRIGHTNESS_MAX,
    );
    this.state.ringBrightness = b;
    if (this.orbitRings) applyRingBrightness(this.orbitRings, b);
    this.syncRingUI();
  }

  /** Reflect state.ringBrightness into every layout's slider (desktop bar + sheet). */
  private syncRingUI(): void {
    const v = String(Math.round(this.state.ringBrightness * 100));
    document.querySelectorAll('[data-rings]').forEach((el) => {
      const input = el as HTMLInputElement;
      // Don't fight the slider the user is currently dragging.
      if (document.activeElement !== input) input.value = v;
    });
  }

  // ------------------------------------------------------------
  // TAP-TO-SELECT (Earth / Moon)
  // ------------------------------------------------------------
  /**
   * A deliberate short, still tap selects the body under the pointer.
   * Anything moving >6px or lasting >350ms is a drag/orbit, not a
   * selection, so camera control and selection never fight.
   */
  private bindSelection(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      this._tap.downX = e.clientX;
      this._tap.downY = e.clientY;
      this._tap.downT = performance.now();
    });
    dom.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (performance.now() - this._tap.downT > 350) return;
      if (Math.hypot(e.clientX - this._tap.downX, e.clientY - this._tap.downY) > 6) return;
      const ndc = new THREE.Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      // Pick against the ENLARGED invisible hit proxies, not the visual
      // meshes: at System distance the Moon is a sliver that is impossible to
      // finger-tap, so every body carries a comfortably oversized pick area
      // (material-invisible, raycast-visible).
      const meshes = this.hitProxies.filter((p) => p.mesh.visible).map((p) => p.mesh);
      const hits = this.raycaster.intersectObjects(meshes, false);
      if (!hits.length) return;
      const proxy = this.hitProxies.find((p) => p.mesh === hits[0].object);
      if (proxy) this.setFocus(proxy.focus);
    });
  }

  /**
   * Build the invisible, enlarged tap targets. Radii are generous on purpose
   * (≥ ~2× the visual size, and large in absolute world units at the System
   * distance) so a finger tap — not a pixel-perfect aim — lands the body.
   * The Moon proxy tracks the Moon's live position every frame.
   */
  private createHitProxies(): void {
    const material = new THREE.MeshBasicMaterial({ visible: false });
    const make = (radius: number, focus: Focus): { mesh: THREE.Mesh; focus: Focus } => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
      mesh.visible = false; // updated by updateHitProxies(); raycast ignores visible
      this.scene.add(mesh);
      return { mesh, focus };
    };
    const earth = make(1.15, 'earth');
    earth.mesh.position.copy(this.earthPos);
    earth.mesh.visible = true;
    this.hitProxies.push(earth);
    const sun = make(SUN_RADIUS * 1.2, 'sun');
    sun.mesh.visible = true; // position tracked by updateHitProxies()
    this.hitProxies.push(sun);
    const moon = make(0.5, 'moon');
    this.hitProxies.push(moon);
    // Planets + their moons (world space, tracked per frame in updateHitProxies)
    for (const def of PLANETS) {
      this.hitProxies.push(make(planetRadius(def) * 1.3, def.id));
      for (const m of def.moons) {
        // Unit sphere: the pick radius is applied as a per-frame scale in
        // updateHitProxies() so it stays scale-mode-aware (in Real scale the
        // true moon radii are 7–25× smaller than exploration-size pick spheres).
        const proxy = make(1, m.id as Focus);
        proxy.mesh.scale.setScalar(this.planetMoonPickRadius(m, def, this.scaleMode));
        this.hitProxies.push(proxy);
      }
    }
  }

  /** Pick radius for a planet moon in the active scale mode. Exploration:
   *  generous (≥ 0.8, ~1.6× the exploration size) so a finger tap lands.
   *  Real: capped at ~2.5× the TRUE radius so a tap clearly aimed at empty
   *  space can't select a 0.001-unit Phobos (a fixed 0.8 floor would be
   *  7–25× its rendered size). */
  private planetMoonPickRadius(def: MoonDef, planet: PlanetDef, mode: ScaleMode): number {
    const r = planetMoonRadius(def, planet, mode);
    return mode === 'real' ? Math.max(0.2, r * 2.5) : Math.max(0.8, r * 1.6);
  }

  // ------------------------------------------------------------
  // PLANET NAME LABELS (wide "System" overview)
  // ------------------------------------------------------------
  /**
   * Build one DOM pill per planet into `#planet-labels`. In the top-down
   * System view the true-scale planets are sub-pixel dots (see OrbitRings.ts)
   * — the labels are the only way to tell them apart, so they exist to point
   * at those dots. Each pill is itself clickable (data-focus → setFocus) and
   * is the PRIMARY way to select a planet from the System view: the enlarged
   * hit proxies are only a few world units across and are well under a pixel
   * at ~6000+ units of standoff. The rest of the layer is pointer-events:none
   * so orbit/zoom/tap keep working on the canvas.
   */
  private setupPlanetLabels(): void {
    const layer = document.getElementById('planet-labels');
    if (!layer) return;
    const mk = (id: Focus, name: string) => {
      const el = document.createElement('span');
      el.className = 'planet-label';
      el.textContent = name;
      el.style.display = 'none';
      // Clickable → fly to that planet. The delegated body click handler
      // (uiHandler) already maps any [data-focus] element to setFocus();
      // this is the exact same path the planet buttons in the primary bar use.
      el.dataset.focus = id;
      el.setAttribute('role', 'button');
      el.setAttribute('title', `Fly to ${name}`);
      const dot = document.createElement('i');
      dot.className = 'planet-label-dot';
      el.prepend(dot);
      layer.appendChild(el);
      this.planetLabelEls.push({ focus: id, name, el });
    };
    // Earth is the special-case body — it is NOT in the PLANETS registry (it
    // owns its own shader/texture path and is tracked by `this.earthPos`), so
    // add it explicitly (it appears first in the DOM, then Mercury … Pluto).
    mk('earth', 'Earth');
    for (const def of PLANETS) mk(def.id, def.name);
    // Moons: one pill per registry moon, tagged with its owner planet. Hidden
    // until updatePlanetLabels() reveals them for the focused planet (or one
    // of its moons) — NEVER in the System overview, where 27 pills over 9
    // sub-pixel dots would clutter the view. Clicking flies to that moon via
    // the same delegated [data-focus] → setFocus() path as the planet pills.
    const mkMoon = (id: Focus, name: string, owner: Focus) => {
      const el = document.createElement('span');
      el.className = 'planet-label moon-label';
      el.textContent = name;
      el.style.display = 'none';
      el.dataset.focus = id;
      el.setAttribute('role', 'button');
      el.setAttribute('title', `Fly to ${name}`);
      const dot = document.createElement('i');
      dot.className = 'planet-label-dot';
      el.prepend(dot);
      layer.appendChild(el);
      this.moonLabelEls.push({ focus: id, name, owner, el });
    };
    // Earth's Moon: a special-case body (own mesh, tracked by `moonPosition`)
    // that is NOT in the registry — add it explicitly, first (Earth leads
    // the planet order, and its Moon is its only moon).
    mkMoon('moon', 'Moon', 'earth');
    for (const def of PLANETS) {
      for (const m of def.moons) mkMoon(m.id, m.name, def.id);
    }
  }

  /** Per-frame: hide the planet labels unless we're in the wide System view
   *  with labels enabled — then project each planet's live world position to
   *  screen space and position its pill just above the dot. The moon labels
   *  use the same mechanism but show only while a planet (or one of its
   *  moons) is focused — never in the System overview. Labels behind the
   *  camera or off the viewport are hidden (NDC z > 1 / out of range). */
  private updatePlanetLabels(): void {
    if (this.planetLabelEls.length === 0 && this.moonLabelEls.length === 0) return;
    // project() reads camera.matrixWorldInverse, normally only refreshed
    // inside renderer.render() — refresh it from the camera's current
    // transform so the projection is exact for THIS frame.
    this.camera.updateMatrixWorld();
    const planetShow = this.focus === 'system' && this.state.planetLabels;
    // Moon pills: same "Labels" toggle, but only while we are actually AT
    // that planet — focused on the planet itself or on one of its moons (so
    // the sibling labels let you hop between moons by clicking). Never in
    // the System overview — that view stays planet-names-only.
    const moonOwner = this.state.planetLabels
      ? (this.focus === 'earth' ? 'earth'
        : isPlanetFocus(this.focus) ? this.focus
        : isPlanetMoonFocus(this.focus) ? MOON_OWNER[this.focus]
        : null)
      : null;
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    for (const p of this.planetLabelEls) {
      if (!planetShow) {
        if (p.el.style.display !== 'none') p.el.style.display = 'none';
        continue;
      }
      // Earth is tracked by `this.earthPos` (special-case body, not in
      // `this.planets`); every other label resolves through its PlanetSystem.
      if (p.focus === 'earth') this._v.copy(this.earthPos);
      else {
        const sys = this.planets.get(p.focus);
        if (!sys) {
          p.el.style.display = 'none';
          continue;
        }
        // The system group sits at the planet's live orbit position — the same
        // `center()` the focus/pose code uses.
        sys.center(this._v);
      }
      this._labelNdc.copy(this._v).project(this.camera);
      if (this._labelNdc.z > 1 || this._labelNdc.z < -1
        || this._labelNdc.x < -1.05 || this._labelNdc.x > 1.05
        || this._labelNdc.y < -1.05 || this._labelNdc.y > 1.05) {
        p.el.style.display = 'none';
        continue;
      }
      const x = (this._labelNdc.x + 1) * 0.5 * w;
      const y = (1 - this._labelNdc.y) * 0.5 * h;
      p.el.style.display = '';
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
    }
    for (const m of this.moonLabelEls) {
      if (!moonOwner || m.owner !== moonOwner) {
        if (m.el.style.display !== 'none') m.el.style.display = 'none';
        continue;
      }
      // The pill of the body we are looking AT would sit dead-centre on its
      // disk — hide it (the moon-picker buttons + primary bar still name it).
      if (m.focus === this.focus) {
        if (m.el.style.display !== 'none') m.el.style.display = 'none';
        continue;
      }
      // Live world position — registry moons via the owner's PlanetSystem
      // (the same moonWorld() the focus-pose and hit-proxy code track,
      // refreshed each frame by sys.update() before this runs in animate());
      // Earth's Moon is the special-case body tracked by `moonPosition`.
      if (m.focus === 'moon') {
        this._v.copy(this.moonPosition);
      } else {
        const sys = this.planets.get(m.owner);
        const mw = sys ? sys.moonWorld(m.focus, this._v) : null;
        if (!sys || !mw) {
          m.el.style.display = 'none';
          continue;
        }
      }
      this._labelNdc.copy(this._v).project(this.camera);
      if (this._labelNdc.z > 1 || this._labelNdc.z < -1
        || this._labelNdc.x < -1.05 || this._labelNdc.x > 1.05
        || this._labelNdc.y < -1.05 || this._labelNdc.y > 1.05) {
        m.el.style.display = 'none';
        continue;
      }
      m.el.style.display = '';
      m.el.style.left = `${(this._labelNdc.x + 1) * 0.5 * w}px`;
      m.el.style.top = `${(1 - this._labelNdc.y) * 0.5 * h}px`;
    }
  }

  /** The planet whose moons are currently pickable — exactly the condition
   *  syncFocusUI() uses to show the moon picker (the focused planet, or the
   *  owner of the focused moon); null otherwise. Used to gate the moon
   *  hit-proxies so a moon can't sit on top of its planet and steal the click
   *  in the System overview. */
  private moonOwnerForPick(): Focus | null {
    const active = this.pendingFocus ?? this.focus;
    if (isPlanetFocus(active)) return active;
    if (isPlanetMoonFocus(active)) return MOON_OWNER[active];
    return null;
  }

  /** Keep the moving proxies in lock-step with their bodies (per frame). */
  private updateHitProxies(): void {
    for (const p of this.hitProxies) {
      if (p.focus === 'earth') {
        p.mesh.visible = true;
        p.mesh.position.copy(this.earthPos);
      } else if (p.focus === 'sun') {
        p.mesh.visible = true;
        p.mesh.position.copy(this.sunWorldPos);
      } else if (p.focus === 'moon') {
        // Pickable only while viewing Earth or the Moon itself — in the System
        // overview it would sit on top of Earth and steal the click.
        const active = this.pendingFocus ?? this.focus;
        p.mesh.visible = (active === 'earth' || active === 'moon') && this.moonMesh != null;
        if (this.moonMesh) p.mesh.position.copy(this.moonPosition);
      } else if (isPlanetFocus(p.focus)) {
        // Every planet is a click-to-zoom target at any zoom — free-roam
        // selection is global, so track + enable all of them every frame.
        const sys = this.planets.get(p.focus);
        if (!sys) { p.mesh.visible = false; continue; }
        p.mesh.visible = true;
        sys.center(p.mesh.position);
      } else if (isPlanetMoonFocus(p.focus)) {
        const owner = MOON_OWNER[p.focus];
        const sys = this.planets.get(owner);
        if (!sys) { p.mesh.visible = false; continue; }
        const pdef = PLANET_BY_ID[owner];
        const mdef = pdef.moons.find((m) => m.id === p.focus);
        // Scale-aware pick radius: the unit sphere is scaled to the active
        // scale mode's tappable size (see planetMoonPickRadius).
        const pick = mdef ? this.planetMoonPickRadius(mdef, pdef, this.scaleMode) : 0.8;
        if (p.mesh.scale.x !== pick) p.mesh.scale.setScalar(pick);
        const mw = sys.moonWorld(p.focus, this._v);
        if (mw) p.mesh.position.copy(mw);
        // Gate on focus relevance (matches the moon-picker UI) so a planet's
        // moons are pick targets only while actually viewing that planet or one
        // of its moons — not in the System overview.
        p.mesh.visible = this.moonOwnerForPick() === owner;
      }
    }
  }

  /** Hide on platforms without document fullscreen (e.g. iOS Safari). */
  private static fullscreenSupported(): boolean {
    const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    return typeof d.requestFullscreen === 'function' || typeof d.webkitRequestFullscreen === 'function';
  }

  private toggleFullscreen(): void {
    const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const isFull = document.fullscreenElement != null || d.webkitRequestFullscreen != null && (document as unknown as { webkitFullscreenElement?: unknown }).webkitFullscreenElement != null;
    if (!isFull) {
      if (typeof d.requestFullscreen === 'function') d.requestFullscreen().catch(() => {});
      else if (typeof d.webkitRequestFullscreen === 'function') d.webkitRequestFullscreen();
    } else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else (document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.();
    }
  }

  // ------------------------------------------------------------
  // SUN LIGHTING CONTROL
  // ------------------------------------------------------------
  // There are two mutually exclusive Sun modes, both driven through the one
  // shared `SunLightingState.direction` Vector3 (referenced by the Earth,
  // cloud and atmosphere `uSunDirection` uniforms):
  //   1. MANUAL — the user's azimuth/elevation, fixed in world space.
  //   2. FULL DAYLIGHT — the direction is recomputed every frame from the
  //      camera, so the Sun sits behind the viewer and the visible hemisphere
  //      stays lit while orbiting.
  // Both modes define the APPARENT Sun direction as seen from Earth; since
  // the Sun itself is the fixed system centre, they reposition the Earth-Moon
  // system onto the matching orbit point (repositionEarth) instead of moving
  // the light. updateSun() is the single write path for MANUAL mode.
  private updateSun(azimuth: number, elevation: number): void {
    this.sun.set(azimuth, elevation);
    // setDirection derives a quaternion from the vector and retains no
    // reference to it — no clone needed.
    if (this.sunRay) this.sunRay.setDirection(this.sun.direction);
    // "Moving the Sun" = moving the Earth-Moon system to the anti-solar point
    // (the camera follows when Earth/Moon is the focus).
    this.repositionEarth();
    this.updateSunUI();
  }

  // ------------------------------------------------------------
  // FULL DAYLIGHT (camera-following Sun)
  // ------------------------------------------------------------
  // The shader convention is: uSunDirection = the world-space direction the
  // Sun lies in (lit hemisphere faces it). "Sun behind the viewer" therefore
  // means the camera's Earth-relative offset points at the Sun:
  // direction = normalize(cameraPosition − earthPos), where earthPos is
  // EARTH'S CENTRE — a FIXED reference, deliberately NOT the orbit target.
  // This matters: with the Sun the focus, the target tracks the Sun (see
  // animate()), so deriving the direction from a target the system is
  // positioned relative to would be a divergent feedback loop.
  // repositionEarth() then places the Earth-Moon system at
  // −EARTH_ORBIT_RADIUS * direction, so the fixed Sun (origin) sits exactly
  // behind the viewer. That vector is written IN PLACE into the one shared
  // Vector3 every uSunDirection uniform references, so the surface day/night
  // blend, city lights, ocean specular, clouds and atmosphere all follow the
  // camera together — no layer invents its own light, and no
  // ambient/emissive cheat flattens the shading.
  private updateFullDaylightSun(): void {
    this._sunTmp.copy(this.camera.position).sub(this.earthPos);
    if (this._sunTmp.lengthSq() < 1e-12) return; // degenerate: camera on Earth
    this._sunTmp.normalize();
    this.sun.direction.copy(this._sunTmp);
    // Sync azimuth/elevation from the vector so the panel readout, knob and
    // sliders reflect the live Sun, and manual-mode restore has sane state.
    const RAD2DEG = 180 / Math.PI;
    this.sun.elevation =
      Math.asin(THREE.MathUtils.clamp(this._sunTmp.y, -1, 1)) * RAD2DEG;
    this.sun.azimuth =
      wrapAzimuth(Math.atan2(this._sunTmp.z, this._sunTmp.x) * RAD2DEG);
    if (this.sunRay) this.sunRay.setDirection(this.sun.direction);
    this.updateSunUI();
    // Move the Earth-Moon system to the anti-solar point (camera follows).
    this.repositionEarth();
  }

  private setFullDaylight(on: boolean): void {
    if (on === this.state.fullDaylight) return;
    if (on) {
      // Remember the user's manual Sun exactly, so disabling Full Daylight
      // restores it instead of resetting arbitrarily.
      this.savedManualSun = {
        azimuth: this.sun.azimuth,
        elevation: this.sun.elevation,
      };
      this.setAutoSun(false);
      this.updateFullDaylightSun();
    } else {
      this.updateSun(this.savedManualSun.azimuth, this.savedManualSun.elevation);
    }
    this.state.fullDaylight = on;
    this.updateSunPanelState();
  }

  /** Soft Daylight: subtle optional studio fill (see uSoftFill in shaders). */
  private setSoftDaylight(on: boolean): void {
    // Deliberately low: it only lifts the day-side shadow band, never the
    // night side, so Full Daylight works perfectly well without it.
    const value = on ? 0.2 : 0.0;
    if (this.earthMaterial) this.earthMaterial.uniforms.uSoftFill.value = value;
    if (this.cloudMaterial) this.cloudMaterial.uniforms.uSoftFill.value = value;
    const cb = document.getElementById('sun-softfill') as HTMLInputElement | null;
    if (cb) cb.checked = on;
  }

  /** Visual state of the Sun panel: which mode is active, what's overridden. */
  private updateSunPanelState(): void {
    const panel = document.getElementById('sun-panel');
    if (panel) panel.classList.toggle('full-daylight', this.state.fullDaylight);
    const fdBtn = panel?.querySelector(
      '[data-preset="full-daylight"]',
    ) as HTMLElement | null;
    if (fdBtn) fdBtn.classList.toggle('active', this.state.fullDaylight);
  }

  private resetSun(): void {
    if (this.state.fullDaylight) this.setFullDaylight(false);
    this.setAutoSun(false);
    this.updateSun(INITIAL_SUN_AZIMUTH, INITIAL_SUN_ELEVATION);
  }

  private applySunPreset(preset: string): void {
    if (preset === 'full-daylight') {
      this.setFullDaylight(!this.state.fullDaylight);
      return;
    }
    // Fixed presets are mutually exclusive with Full Daylight — exit the
    // camera-following mode (which restores the saved manual Sun) before the
    // preset direction replaces it, so no conflicting lighting state lingers.
    if (this.state.fullDaylight) this.setFullDaylight(false);
    this.setAutoSun(false);
    switch (preset) {
      case 'day': this.updateSun(90, 0); break;      // Sun toward camera: fully lit
      case 'sunset': this.updateSun(0, 8); break;    // Sun to the side: warm half-lit
      case 'night': this.updateSun(-90, 0); break;   // Sun behind: night side + city lights
      case 'backlit': this.updateSun(-90, -12); break; // Low Sun behind: strong blue rim
      default: break;
    }
  }

  private setAutoSun(on: boolean): void {
    if (on && this.state.fullDaylight) this.setFullDaylight(false);
    this.state.autoSun = on;
    // Every instance (both layouts share the same DOM) — same convention as
    // syncUIButtons, so a duplicated button can never desync.
    document.querySelectorAll('[data-action="auto-sun"]').forEach((el) => {
      (el as HTMLElement).classList.toggle('active', on);
    });
  }

  private setupSunUI(): void {
    const panel = document.getElementById('sun-panel');
    const pad = document.getElementById('sun-pad') as HTMLElement | null;
    const knob = document.getElementById('sun-knob') as HTMLElement | null;
    const azSlider = document.getElementById('sun-az') as HTMLInputElement | null;
    const elSlider = document.getElementById('sun-el') as HTMLInputElement | null;
    const azVal = document.getElementById('sun-az-val');
    const elVal = document.getElementById('sun-el-val');
    if (!panel || !pad || !knob || !azSlider || !elSlider || !azVal || !elVal) return;

    this.sunPad = pad;
    this.sunUI = { azSlider, elSlider, azVal, elVal, knob };
    const measure = (): void => {
      const r = pad.getBoundingClientRect();
      if (r.width > 0) this.padHalf = Math.min(r.width, r.height) / 2;
    };
    measure();

    // Sliders -> Sun (full -180..180 / -90..90 range). Guarded so manual
    // input can never fight Full Daylight (the CSS also disables these).
    azSlider.addEventListener('input', () => {
      if (this.state.fullDaylight) return;
      this.setAutoSun(false);
      this.updateSun(parseFloat(azSlider.value), this.sun.elevation);
    }, { signal: this.ac.signal });
    elSlider.addEventListener('input', () => {
      if (this.state.fullDaylight) return;
      this.setAutoSun(false);
      this.updateSun(this.sun.azimuth, parseFloat(elSlider.value));
    }, { signal: this.ac.signal });

    // Circular pad: left/right = azimuth, up/down = elevation
    let dragging = false;
    const setFromPointer = (clientX: number, clientY: number): void => {
      const rect = pad.getBoundingClientRect();
      if (rect.width <= 0) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const half = Math.min(rect.width, rect.height) / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > half) { dx *= half / len; dy *= half / len; }
      this.updateSun((dx / half) * 180, (-dy / half) * 90);
    };
    const onDown = (e: PointerEvent): void => {
      // Guard first: never leave `dragging` stuck true in Full Daylight.
      if (this.state.fullDaylight) return;
      dragging = true;
      this.setAutoSun(false);
      pad.setPointerCapture(e.pointerId);
      setFromPointer(e.clientX, e.clientY);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      setFromPointer(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent): void => {
      dragging = false;
      if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);
    };
    pad.addEventListener('pointerdown', onDown, { signal: this.ac.signal });
    pad.addEventListener('pointermove', onMove, { signal: this.ac.signal });
    pad.addEventListener('pointerup', onUp, { signal: this.ac.signal });
    pad.addEventListener('pointercancel', onUp, { signal: this.ac.signal });

    // Presets (only change the Sun)
    panel.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => this.applySunPreset((btn as HTMLElement).dataset.preset!), { signal: this.ac.signal });
    });

    // Reset Sun
    const resetBtn = panel.querySelector('[data-action="reset-sun"]');
    resetBtn?.addEventListener('click', () => this.resetSun(), { signal: this.ac.signal });

    // Auto Sun toggle
    const autoBtn = panel.querySelector('[data-action="auto-sun"]') as HTMLElement | null;
    autoBtn?.addEventListener('click', () => this.setAutoSun(!this.state.autoSun), { signal: this.ac.signal });

    // Soft Daylight fill toggle (optional subtle studio fill)
    const softFill = document.getElementById('sun-softfill') as HTMLInputElement | null;
    softFill?.addEventListener('change', () => this.setSoftDaylight(softFill.checked), { signal: this.ac.signal });

    this.updateSunPanelState();
    this.updateSunUI();

    // Collapse / expand
    const collapseBtn = panel.querySelector('[data-action="collapse-sun"]') as HTMLElement | null;
    const body = panel.querySelector('.sun-body') as HTMLElement | null;
    collapseBtn?.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      if (body) body.classList.toggle('hidden', collapsed);
      collapseBtn.textContent = collapsed ? '+' : '\u2212';
    }, { signal: this.ac.signal });
  }

  /**
   * Per-frame Sun-panel readout. All element refs are cached in setupSunUI
   * and every write is skipped when its value has not changed, so Auto Sun /
   * Full Daylight modes do minimal DOM work each frame.
   */
  private updateSunUI(): void {
    const ui = this.sunUI;
    if (!ui) return;
    const az = Math.round(this.sun.azimuth);
    const el = Math.round(this.sun.elevation);
    if (this.lastAzShown !== az) {
      ui.azSlider.value = String(az);
      ui.azVal.textContent = String(az);
      this.lastAzShown = az;
    }
    if (this.lastElShown !== el) {
      ui.elSlider.value = String(el);
      ui.elVal.textContent = String(el);
      this.lastElShown = el;
    }
    if (this.padHalf > 0) {
      let dx = (this.sun.azimuth / 180) * this.padHalf;
      let dy = (-this.sun.elevation / 90) * this.padHalf;
      const len = Math.hypot(dx, dy);
      if (len > this.padHalf) { dx *= this.padHalf / len; dy *= this.padHalf / len; }
      const transform = `translate(${dx}px, ${dy}px)`;
      if (this.lastKnobTransform !== transform) {
        ui.knob.style.transform = transform;
        this.lastKnobTransform = transform;
      }
    }
  }

  // ------------------------------------------------------------
  // DEBUG PANEL (enabled via ?debug — not shown in normal UI)
  // ------------------------------------------------------------
  // Layer-isolation tools for diagnosing rendering defects: per-layer
  // visibility (surface / clouds / atmosphere / stars), a surface-normal view,
  // a "sun ramp" view that visualizes the exact dot(normal, sunDir) footprint,
  // and the Sun direction ray. Post-processing IS active: createComposer()
  // runs unconditionally in init() and animate() renders only through it,
  // with UnrealBloom on every tier except 'performance'. So these validation
  // views are still tone-mapped and bloomed by OutputPass — they do not
  // isolate the surface shading as cleanly as a direct-to-screen render would.
  private setupDebugPanel(): void {
    const panel = document.createElement('div');
    panel.className = 'debug-panel';

    const title = document.createElement('div');
    title.className = 'debug-title';
    title.textContent = 'Debug isolation — ?debug';
    panel.appendChild(title);

    const makeToggle = (label: string, isActive: boolean): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = 'debug-btn' + (isActive ? ' active' : '');
      btn.textContent = label;
      panel.appendChild(btn);
      return btn;
    };

    const surfaceBtn = makeToggle('Surface', true);
    surfaceBtn.addEventListener('click', () => {
      if (this.earthMesh) {
        this.earthMesh.visible = !this.earthMesh.visible;
        surfaceBtn.classList.toggle('active', this.earthMesh.visible);
      }
    }, { signal: this.ac.signal });

    const moonBtn = makeToggle('Moon', true);
    moonBtn.addEventListener('click', () => {
      if (this.moonMesh) {
        this.moonMesh.visible = !this.moonMesh.visible;
        moonBtn.classList.toggle('active', this.moonMesh.visible);
      }
    }, { signal: this.ac.signal });

    const cloudBtn = makeToggle('Clouds', this.state.clouds);
    cloudBtn.addEventListener('click', () => {
      this.state.clouds = !this.state.clouds;
      if (this.cloudMesh) this.cloudMesh.visible = this.state.clouds && this.debugMode !== 3;
      if (this.earthMaterial) {
        this.earthMaterial.uniforms.uCloudShadowStrength.value =
          this.state.clouds ? 0.2 : 0.0;
      }
      cloudBtn.classList.toggle('active', this.state.clouds);
      this.syncUIButtons(); // keep the main UI button in lockstep
    }, { signal: this.ac.signal });

    const atmoBtn = makeToggle('Atmosphere', this.state.atmosphere);
    atmoBtn.addEventListener('click', () => {
      this.state.atmosphere = !this.state.atmosphere;
      if (this.atmosphereMesh) this.atmosphereMesh.visible = this.state.atmosphere;
      atmoBtn.classList.toggle('active', this.state.atmosphere);
      this.syncUIButtons(); // keep the main UI button in lockstep
    }, { signal: this.ac.signal });

    const starsBtn = makeToggle('Stars', this.state.stars);
    starsBtn.addEventListener('click', () => {
      this.state.stars = !this.state.stars;
      if (this.starField) this.starField.visible = this.state.stars;
      starsBtn.classList.toggle('active', this.state.stars);
    }, { signal: this.ac.signal });

    // Exclusive render modes: 0 normal, 1 normals, 2 sun ramp, 3 white sphere
    const modes: Array<[string, number]> = [
      ['Normal', 0],
      ['Normals', 1],
      ['Sun ramp', 2],
      ['White sphere', 3],
    ];
    const modeBtns: HTMLButtonElement[] = [];
    const applyDebugMode = (mode: number): void => {
      this.debugMode = mode; // single source of truth for the bare-sphere rule
      if (this.earthMaterial) this.earthMaterial.uniforms.uDebugMode.value = mode;
      if (this.moonMaterial) this.moonMaterial.uniforms.uDebugMode.value = mode;
      if (this.cloudMaterial) this.cloudMaterial.uniforms.uDebugMode.value = mode;
      for (const sys of this.planets.values()) sys.setDebugMode(mode);
      // The white-sphere test must render a BARE sphere — hide the cloud
      // shell in mode 3 so it cannot occlude the surface under validation.
      if (this.cloudMesh) {
        this.cloudMesh.visible = mode !== 3 && this.state.clouds;
      }
      modeBtns.forEach((b, i) => b.classList.toggle('active', i === mode));
    };
    modes.forEach(([label, mode]) => {
      const btn = makeToggle(label, mode === 0);
      modeBtns.push(btn);
      btn.addEventListener('click', () => applyDebugMode(mode), { signal: this.ac.signal });
    });

    const rayBtn = makeToggle('Sun ray', false);
    rayBtn.addEventListener('click', () => {
      this.showSunRay = !this.showSunRay;
      if (this.sunRay) this.sunRay.visible = this.showSunRay;
      rayBtn.classList.toggle('active', this.showSunRay);
    }, { signal: this.ac.signal });

    this.debugPanel = panel;
    document.body.appendChild(panel);
  }

  // ------------------------------------------------------------
  // RESIZE
  // ------------------------------------------------------------
  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    if (this.sunPad) {
      const r = this.sunPad.getBoundingClientRect();
      if (r.width > 0) this.padHalf = Math.min(r.width, r.height) / 2;
      this.updateSunUI();
    }
  };

  // ------------------------------------------------------------
  // ANIMATION LOOP
  // ------------------------------------------------------------
  /** Consecutive throwing frames tolerated before the loop gives up — a single
   *  transient glitch (e.g. one frame in a WebGL context-loss/restore) must not
   *  freeze the canvas, but a sustained streak is a real failure. */
  private consecutiveFrameErrors = 0;
  private readonly maxConsecutiveFrameErrors = 5;

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    try {
      this.frame();
      this.consecutiveFrameErrors = 0; // a clean frame breaks any error streak
    } catch (err) {
      this.consecutiveFrameErrors++;
      if (this.consecutiveFrameErrors < this.maxConsecutiveFrameErrors) {
        // Transient: log it and keep the (already-scheduled) loop alive.
        console.error(
          `Frame error (${this.consecutiveFrameErrors} consecutive, recovering):`,
          err
        );
        return;
      }
      // Sustained failure: stop the loop, free GPU resources, and surface a
      // message instead of re-throwing every frame forever.
      if (this.animationId != null) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      console.error('Render loop halted after sustained frame errors:', err);
      this.dispose();
      this.showFatalOverlay('The 3D scene stopped rendering. Reloading may help.');
    }
  };

  private frame = (): void => {
    // A backgrounded tab returns a dt of seconds-to-minutes. Clamp it: the FPS
    // guard would read it as a stall and downgrade, and the Moon orbit /
    // Auto-Sun sweep would jump a visible step.
    const dt = Math.min(this.clock.getDelta(), 0.25);

    // Runtime FPS guard (Auto mode only): if the device can't sustain the
    // current tier for a sustained window, step one tier down — never back up,
    // to avoid oscillation. Skipped while the user is actively driving the
    // camera (frame cost is not representative) and during load.
    if (this.qualitySetting === 'auto' && !this.isInteracting) {
      this.fpsGuard.acc += dt;
      this.fpsGuard.frames++;
      const now = performance.now();
      if (now > this.fpsGuard.cooldownUntil && now - this.fpsGuard.lastEval > 3000 && this.fpsGuard.frames >= 90) {
        // fpsGuard.acc accumulates clock.getDelta(), which is in *seconds*, so
        // frames / acc is already frames-per-second (no ms conversion needed).
        const fps = this.fpsGuard.frames / this.fpsGuard.acc;
        this.fpsGuard.acc = 0;
        this.fpsGuard.frames = 0;
        this.fpsGuard.lastEval = now;
        if (fps < 28) {
          const lower = nextTierDown(this.quality!.tier);
          if (lower) {
            console.info(`[quality] auto: ${Math.round(fps)} fps — stepping down to ${lower}`);
            const from = this.quality!;
            this.quality = QUALITY_PROFILES[lower];
            this.qualityEpoch++;
            this.applyQualityLevers(from);
            this.syncQualityUI(); // reflect the auto-drop in the Quality buttons
            this.fpsGuard.cooldownUntil = now + 15000;
          }
        }
      }
    }

    if (this.state.autoRotate && !this.isInteracting) {
      // dt-scaled (×60 keeps the previous 60 Hz rate) so 120/144 Hz displays
      // do not spin 2–2.4× faster.
      if (this.earthMesh) this.earthMesh.rotation.y += 0.0001 * dt * 60;
      // Clouds drift very slightly faster than the surface — a slow relative
      // motion, never visibly racing the planet.
      if (this.cloudMesh) this.cloudMesh.rotation.y += 0.00015 * dt * 60;
    }

    // Keep surface cloud shadows tracking the cloud layer: cloud drift is a
    // pure Y-rotation, which is exactly a u-offset in equirectangular UV space.
    if (this.earthMaterial && this.cloudMesh && this.earthMesh) {
      const offset =
        (this.cloudMesh.rotation.y - this.earthMesh.rotation.y) / (Math.PI * 2);
      this.earthMaterial.uniforms.uCloudUVOffset.value = offset;
    }

    // Full Daylight: recompute the Sun direction from the camera every frame
    // (Sun sits behind the viewer) so the visible hemisphere stays sunlit
    // while the user orbits. Mutually exclusive with Auto Sun — it wins.
    if (this.state.fullDaylight) {
      this.updateFullDaylightSun();
    } else if (this.state.autoSun) {
      // Auto Sun: slowly sweep the Sun around Earth (a live day/night cycle).
      // Independent of the camera and of Earth's own auto-rotation.
      const nextAz = wrapAzimuth(this.sun.azimuth + dt * 10);
      this.updateSun(nextAz, this.sun.elevation);
    }
    // Keep the visible Sun parked at the SYSTEM CENTRE (origin) — the fixed
    // light source — so the disk, the corona and the hemisphere they
    // illuminate can never disagree, in manual, auto or full-daylight mode
    // alike. (What moves is the Earth-Moon system — see repositionEarth.)
    this.placeSun();
    // Re-sync the Earth-Moon meshes to earthPos EVERY frame: in manual Sun
    // mode nothing else calls repositionEarth(), and loadEarth() creates the
    // meshes at the origin (the Sun) — without this they would sit at the
    // Sun while the camera frames Earth's orbit point. Idempotent no-op once
    // parked; also covers meshes that arrive later (quality-tier swaps).
    this.repositionEarth();

    // Moon: advance the orbit (Paused / Visualized / Real Time) about the
    // live earthPos.
    if (this.moonOrbit === 'visualized') {
      this.moonAngle += (dt * Math.PI * 2) / MOON_ORBIT_PERIOD_VISUAL;
    } else if (this.moonOrbit === 'realtime') {
      this.moonAngle += (dt * Math.PI * 2) / MOON_ORBIT_PERIOD_REALTIME;
    }
    if (this.moonMesh) {
      this.updateMoonTransform();
    }
    // Free-roam: the camera is unbound — nothing to keep glued to the focused
    // body. roam.update() below still takes focusCenter() so dolly and travel
    // scale with the distance to whatever body we're currently looking at.
    // Planets: advance each spin + moon orbit (same orbit/scale modes as the
    // Earth Moon), shared point-source Sun lighting.
    for (const sys of this.planets.values()) {
      sys.update(dt, {
        autoRotate: this.state.autoRotate,
        orbitMode: this.moonOrbit,
        scaleMode: this.scaleMode,
        sunWorldPos: this.sunWorldPos,
      });
    }
    // Orbit guide rings: keep every ring's plane through its body's live
    // position. Earth's orbit point is Sun-direction driven (sliders, drag,
    // presets, Auto Sun, Full Daylight), so its ring must re-tilt to pass
    // through Earth each frame; the planet rings are a no-op in steady state.
    // Runs after the updates above so all positions are current.
    let ringIdx = 0;
    this.ringBodyPositions[ringIdx++].copy(this.earthPos);
    for (const sys of this.planets.values()) {
      this.ringBodyPositions[ringIdx++].copy(sys.position);
    }
    if (this.orbitRings) orientOrbitRings(this.orbitRings, this.ringBodyPositions);
    // Authoritative lighting: the Moon is lit from the Sun's real world
    // position (the origin) — a true point source — so its phase always
    // matches the Sun–Earth–Moon geometry on screen. For Earth,
    // normalize(origin − earthPos) ≡ sun.direction (earthPos = −R ·
    // sun.direction), so the existing shared uniform is already exact.
    sunDirectionToward(this.sunWorldPos, this.moonPosition, this.moonSunDir);
    if (this.sunMaterial) {
      this.sunMaterial.uniforms.uTime.value = this.clock.elapsedTime;
    }
    this.updateHitProxies();

    this.roam.update(dt, this.focusCenter(this._v));
    // AFTER roam.update(): projecting earlier leaves every pill a frame
    // behind the camera (updatePlanetLabels refreshes the camera matrix).
    this.updatePlanetLabels();
    // Composer path: the scene renders into a linear HDR target (opaque
    // shaders' tone-mapping/color-space includes are no-ops there), the Sun's
    // HDR values drive the bloom, and OutputPass applies ACES + sRGB once.
    // createComposer() runs unconditionally in init(), so this guard is
    // always true — but it keeps the loop null-safe with no dead fallback.
    if (this.composer) this.composer.render();
  };

  // ------------------------------------------------------------
  // LIFECYCLE
  // ------------------------------------------------------------

  /** Full-screen failure surface (the same discipline as the asset-load
   *  failures): a human-readable message instead of a blank page + raw stack. */
  private showFatalOverlay(message: string): void {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
      'justify-content:center;padding:24px;box-sizing:border-box;text-align:center;' +
      'color:#fff;font:16px/1.5 system-ui,sans-serif;background:rgba(0,0,0,0.92)';
    overlay.textContent = message;
    document.body.appendChild(overlay);
  }

  dispose(): void {
    this.disposed = true;
    this.orbitRings = null; // the scene traverse below frees its Line geoms + material
    // Planet systems: stop in-flight texture loads from attaching to disposed
    // materials (their meshes/textures are freed by the shared traverse below).
    for (const sys of this.planets.values()) sys.markDisposed();
    // Remove every DOM listener this class attached (window, document, sheet,
    // sun pad/panel, body click — see the { signal } registrations) in one
    // shot; also lets the detached EarthScene become collectable.
    this.ac.abort();
    // The ?debug panel is our own DOM on <body> (not in the scene graph) —
    // its button listeners die with the signal above; remove the element
    // itself so nothing lingers over a load-failure overlay.
    if (this.debugPanel) {
      this.debugPanel.remove();
      this.debugPanel = null;
    }
    // The planet-name label pills live in #planet-labels (outside the scene
    // graph, so the traverse below never sees them) — remove them so none
    // linger over a load-failure overlay, and clear the references so a
    // re-instantiation against the same document appends one set, not two.
    for (const p of this.planetLabelEls) p.el.remove();
    this.planetLabelEls.length = 0;
    for (const m of this.moonLabelEls) m.el.remove();
    this.moonLabelEls.length = 0;
    if (this.animationId != null) cancelAnimationFrame(this.animationId);
    this.animationId = null;
    if (this.resetAnimId != null) cancelAnimationFrame(this.resetAnimId);
    this.resetAnimId = null;
    if (this.interactionTimeout != null) {
      clearTimeout(this.interactionTimeout);
      this.interactionTimeout = null;
    }
    if (this.reframeTimer != null) clearTimeout(this.reframeTimer);
    // Cover Mesh, Points and Line (the sun-ray ArrowHelper contains a Line
    // whose geometry/material were previously skipped).
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
        (obj as THREE.Mesh).geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
    // material.dispose() does not dispose textures — free them explicitly
    // (the cloud texture alone is several MB of GPU memory).
    this.textures.forEach((t) => t.dispose());
    // The corona sprite is not covered by the Mesh/Points/Line traverse above.
    if (this.sunCorona) {
      const coronaMat = this.sunCorona.material as THREE.SpriteMaterial;
      if (coronaMat.map) coronaMat.map.dispose();
      coronaMat.dispose();
    }
    // (Composer passes/targets are freed via disposeComposer() — see above.)
    this.disposeComposer();
    this.roam.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

