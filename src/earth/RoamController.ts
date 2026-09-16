import * as THREE from 'three';
import { ROAM } from '../config/camera';

/**
 * RoamController — a free-fly, unbound camera controller that replaces
 * OrbitControls. No pivot: the camera is a point you drive anywhere, looking
 * wherever you point.
 *
 * Desktop (mouse / Mac trackpad):  up/down (or wheel) = dolly/zoom,
 * left/right = yaw, left-drag = look (pitch+yaw), WASD = move, Q/E = down/up,
 * Shift = boost.  Mobile: one finger = look, pinch = zoom, two-finger = move.
 *
 * Safety: a soft collider keeps the camera just off every body surface, and a
 * hard range cap keeps you inside the star shell. Travel scales with distance
 * to the focused body so it feels consistent at every zoom level. Emits
 * 'start'/'end' (like OrbitControls) so the dim + auto-rotate logic re-uses it.
 */
export interface RoamControllerEvents {
  start: object;
  end: object;
}

/** A body the camera must not pass through (centre + rendered radius). */
export interface RoamCollider {
  /** Live world-space centre (shared with EarthScene; kept current in place). */
  position: THREE.Vector3;
  /** Rendered world radius of the body (scene units). */
  radius: number;
}

interface PointerEntry { x: number; y: number; }

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

export class RoamController extends THREE.EventDispatcher<RoamControllerEvents> {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;

  /** Bodies to stay outside of — shared with EarthScene (live references). */
  colliders: RoamCollider[];

  /** World centre of the current focus — dolly/move scale with this distance. */
  private readonly focusPoint = new THREE.Vector3();

  // Orientation (YXZ): the camera looks down its local −Z.
  private yaw = 0;
  private pitch = 0;

  // Per-frame input accumulators (reset at the end of update()).
  private readonly look = { x: 0, y: 0 };       // drag + horizontal wheel, px
  private readonly touchMove = { x: 0, y: 0 };  // two-finger drag, px
  private dolly = 0;                            // vertical wheel + pinch, px
  private readonly keys = new Set<string>();
  /** Whether Shift is held (boost). Tracked separately: the `Shift` key is not
   *  in MOVE_KEYS, so `keys.has('shift')` was always false and boost was dead. */
  private shiftHeld = false;

  // Multi-touch tracking.
  private readonly pointers = new Map<number, PointerEntry>();
  private pinchDist = 0;
  private centroid = { x: 0, y: 0 };

  // Interaction events + settling.
  private interacting = false;
  private lastInput = 0;

  // True while a programmatic fly-to (EarthScene-driven) owns the camera.
  private flying = false;

  private disposed = false;

  // Scratch (reused every frame — no render-loop allocations).
  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _move = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _euler = new THREE.Euler();

  // Bound handlers (kept for precise removal in dispose()).
  private readonly hWheel = (e: WheelEvent): void => this.onWheel(e);
  private readonly hPointerDown = (e: PointerEvent): void => this.onPointerDown(e);
  private readonly hPointerMove = (e: PointerEvent): void => this.onPointerMove(e);
  private readonly hPointerUp = (e: PointerEvent): void => this.onPointerUp(e);
  private readonly hKeyDown = (e: KeyboardEvent): void => this.onKeyDown(e);
  private readonly hKeyUp = (e: KeyboardEvent): void => this.onKeyUp(e);
  private readonly hContext = (e: Event): void => e.preventDefault();
  private readonly hBlur = (): void => this.clearTransientInput();
  private readonly hVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.clearTransientInput();
  };

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, colliders: RoamCollider[] = []) {
    super();
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.syncFromCamera();
    dom.style.touchAction = 'none';
    dom.addEventListener('wheel', this.hWheel, { passive: false });
    dom.addEventListener('pointerdown', this.hPointerDown);
    window.addEventListener('pointermove', this.hPointerMove);
    window.addEventListener('pointerup', this.hPointerUp);
    window.addEventListener('pointercancel', this.hPointerUp);
    window.addEventListener('keydown', this.hKeyDown);
    window.addEventListener('keyup', this.hKeyUp);
    window.addEventListener('blur', this.hBlur);
    document.addEventListener('visibilitychange', this.hVisibility);
    dom.addEventListener('contextmenu', this.hContext);
  }

  // --------------------------------------------------------------
  // INPUT (mouse / trackpad / touch / keyboard)
  // --------------------------------------------------------------
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.dolly += e.deltaY;       // vertical = zoom/dolly
    this.look.x += e.deltaX;      // horizontal = rotate (yaw)
    this.markInput();
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) this.resetPinch();
    this.markInput();
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return; // no button held → ignore hover so it never steers
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1) {
      this.look.x += dx; // one finger / mouse drag = free look
      this.look.y += dy;
    } else if (this.pointers.size === 2) {
      const pts = Array.from(this.pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      if (this.pinchDist > 0) this.dolly -= (dist - this.pinchDist) * 2; // pinch out = zoom in
      this.pinchDist = dist;
      this.touchMove.x += cx - this.centroid.x; // two-finger drag = move
      this.touchMove.y += cy - this.centroid.y;
      this.centroid.x = cx;
      this.centroid.y = cy;
    }
    this.markInput();
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.pinchDist = 0;
    if (this.pointers.size === 1) {
      const [rest] = this.pointers.values();
      this.centroid.x = rest.x;
      this.centroid.y = rest.y;
    } else if (this.pointers.size === 2) {
      // 3→2 transition: re-seed pinch + centroid from the two live fingers so
      // the next pointermove doesn't delta against a long-stale centroid.
      this.resetPinch();
    }
    this.markInput();
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Ignore browser/IME shortcut combos (Cmd/Ctrl/Alt): they can claim the key
    // and suppress its keyup, which would leave the camera moving with no input.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'shift') { this.shiftHeld = true; return; }
    if (MOVE_KEYS.has(k)) {
      this.keys.add(k);
      this.shiftHeld = e.shiftKey; // reflect a Shift already held before this key
      this.markInput();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === 'shift') { this.shiftHeld = false; return; }
    this.keys.delete(k); // always clean up — never gate on modifiers
    if (MOVE_KEYS.has(k)) this.shiftHeld = e.shiftKey;
  }

  /** Drop transient input (stuck keys / in-flight pointers / queued deltas).
   *  Called on window blur and when the tab is hidden, where a keyup may never
   *  arrive — without this a held key stays in `keys` forever, so update() can
   *  never settle to 'end' and the dim/auto-rotate release is stuck off. */
  private clearTransientInput(): void {
    this.keys.clear();
    this.shiftHeld = false;
    this.pointers.clear();
    this.pinchDist = 0;
    this.look.x = this.look.y = 0;
    this.dolly = 0;
    this.touchMove.x = this.touchMove.y = 0;
  }

  private resetPinch(): void {
    const pts = Array.from(this.pointers.values());
    this.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    this.centroid.x = (pts[0].x + pts[1].x) / 2;
    this.centroid.y = (pts[0].y + pts[1].y) / 2;
  }

  /** Register user input: fire 'start' once, then refresh the settle clock. */
  private markInput(): void {
    if (this.disposed) return;
    this.lastInput = performance.now();
    if (!this.interacting) {
      this.interacting = true;
      this.dispatchEvent({ type: 'start' });
    }
  }

  // --------------------------------------------------------------
  // ORIENTATION
  // --------------------------------------------------------------
  /** Capture yaw/pitch from the camera's current orientation (after lookAt). */
  syncFromCamera(): void {
    this.camera.getWorldDirection(this._fwd);
    this.yaw = Math.atan2(-this._fwd.x, -this._fwd.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(this._fwd.y, -1, 1));
  }

  private applyOrientation(): void {
    const clamped = THREE.MathUtils.clamp(this.pitch, -ROAM.maxPitch, ROAM.maxPitch);
    this._euler.set(clamped, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);
  }

  // --------------------------------------------------------------
  // PROGRAMMATIC FLY (driven by EarthScene)
  // --------------------------------------------------------------
  /** Pause user input while a fly-to transition is in flight. */
  beginFly(): void {
    this.flying = true;
    this.look.x = this.look.y = 0;
    this.dolly = 0;
    this.touchMove.x = this.touchMove.y = 0;
    this.keys.clear();
    this.pointers.clear();
  }

  /** Resume user input (re-capture orientation from the just-set camera). */
  endFly(): void {
    this.flying = false;
    this.syncFromCamera();
  }

  /** Distance-scaled factor so dolly/move feel consistent at every scale. */
  private scaleFactor(): number {
    const d = this.camera.position.distanceTo(this.focusPoint);
    return Math.max(1, d * ROAM.distanceScale);
  }

  // --------------------------------------------------------------
  // PER-FRAME
  // --------------------------------------------------------------
  /**
   * Advance the camera. `focusPoint` is the world centre the current focus is
   * on — used to scale dolly/move so they feel the same at every zoom level.
   */
  update(dt: number, focusPoint?: THREE.Vector3): void {
    if (this.disposed) return;
    if (this.interacting) {
      const idle = performance.now() - this.lastInput > ROAM.settleMs;
      if (idle && this.pointers.size === 0 && this.keys.size === 0) {
        this.interacting = false;
        this.dispatchEvent({ type: 'end' });
      }
    }
    if (this.flying) {
      // A fly-to owns the camera: drop input that accumulated DURING the
      // transition so it can't replay as a one-frame burst the instant it ends.
      this.look.x = this.look.y = 0;
      this.dolly = 0;
      this.touchMove.x = this.touchMove.y = 0;
      return;
    }
    // IDLE FAST PATH — with no queued input nothing can move: skip the whole
    // input pipeline (scaleFactor's distanceTo sqrt, getWorldDirection's
    // matrix decompose + normalize, the six key checks and the Euler →
    // quaternion commit). The common case is a scene left auto-rotating with
    // zero input, and this also stops an idle frame from ever rewriting the
    // camera pose. The accumulators are zero by definition here, so the
    // end-of-frame reset is a no-op and is skipped with the rest.
    // Safety (5-6) is deliberately NOT gated: a body's collider orbits
    // independently of input and can drift toward a parked camera, so the
    // sweep must still run every frame.
    const dirty =
      this.look.x !== 0 || this.look.y !== 0 ||
      this.dolly !== 0 ||
      this.touchMove.x !== 0 || this.touchMove.y !== 0 ||
      this.keys.size > 0;
    if (dirty) {
      if (focusPoint) this.focusPoint.copy(focusPoint);
      const scale = this.scaleFactor();

      // 1) LOOK — drag + horizontal wheel, yaw about world-up.
      const hasLook = this.look.x !== 0 || this.look.y !== 0;
      if (hasLook) {
        this.yaw -= this.look.x * ROAM.lookSpeed;
        // Clamp the STORED pitch (not just a local copy in applyOrientation) so
        // it can't run past the pole and leave a dead-zone of unresponsive drag.
        this.pitch = THREE.MathUtils.clamp(
          this.pitch - this.look.y * ROAM.lookSpeed, -ROAM.maxPitch, ROAM.maxPitch);
      }

      // 2) MOVE — WASD/QE (view-relative) + two-finger touch drag.
      this.camera.getWorldDirection(this._fwd);
      this._right.crossVectors(this._fwd, this._up).normalize();
      this._move.set(0, 0, 0);
      if (this.keys.has('w')) this._move.addScaledVector(this._fwd, 1);
      if (this.keys.has('s')) this._move.addScaledVector(this._fwd, -1);
      if (this.keys.has('d')) this._move.addScaledVector(this._right, 1);
      if (this.keys.has('a')) this._move.addScaledVector(this._right, -1);
      if (this.keys.has('e')) this._move.addScaledVector(this._up, 1);
      if (this.keys.has('q')) this._move.addScaledVector(this._up, -1);
      if (this.touchMove.x !== 0) this._move.addScaledVector(this._right, this.touchMove.x * ROAM.touchMoveSpeed);
      if (this.touchMove.y !== 0) this._move.addScaledVector(this._up, -this.touchMove.y * ROAM.touchMoveSpeed);
      if (this._move.lengthSq() > 0) {
        const boost = this.shiftHeld ? ROAM.boost : 1;
        this.camera.position.addScaledVector(this._move.normalize(), ROAM.moveSpeed * scale * boost * dt);
      }

      // 3) DOLLY — vertical wheel / pinch (zoom along the view).
      if (this.dolly !== 0) {
        const dir = this.dolly > 0 ? -1 : 1; // scroll-down / pinch-in = zoom out
        const amount = Math.abs(this.dolly) * ROAM.zoomSpeed * scale;
        this.camera.position.addScaledVector(this._fwd, dir * amount);
      }

      // 4) COMMIT orientation — only when look input changed it, so a frame
      //    without look input (e.g. right after a tilted System fly-to)
      //    can't rewrite the pose past maxPitch and tilt it away from the
      //    intended framing.
      if (hasLook) this.applyOrientation();

      // 7) RESET accumulators (only meaningful on an input frame).
      this.look.x = this.look.y = 0;
      this.dolly = 0;
      this.touchMove.x = this.touchMove.y = 0;
    }

    // 5) SAFETY — soft collider: stay just outside every body.
    for (const c of this.colliders) {
      const dx = this.camera.position.x - c.position.x;
      const dy = this.camera.position.y - c.position.y;
      const dz = this.camera.position.z - c.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const min = c.radius * (1 + ROAM.surfaceMarginFrac) + ROAM.surfaceMarginPad;
      if (distSq < min * min) {
        const dist = Math.sqrt(distSq) || 1e-6;
        const s = min / dist;
        this.camera.position.set(c.position.x + dx * s, c.position.y + dy * s, c.position.z + dz * s);
      }
    }

    // 6) SAFETY — hard range cap: stay inside the star shell.
    const range = this.camera.position.length();
    if (range > ROAM.maxRange) this.camera.position.multiplyScalar(ROAM.maxRange / range);
  }

  // --------------------------------------------------------------
  // LIFECYCLE
  // --------------------------------------------------------------
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const dom = this.dom;
    dom.removeEventListener('wheel', this.hWheel);
    dom.removeEventListener('pointerdown', this.hPointerDown);
    window.removeEventListener('pointermove', this.hPointerMove);
    window.removeEventListener('pointerup', this.hPointerUp);
    window.removeEventListener('pointercancel', this.hPointerUp);
    window.removeEventListener('keydown', this.hKeyDown);
    window.removeEventListener('keyup', this.hKeyUp);
    window.removeEventListener('blur', this.hBlur);
    document.removeEventListener('visibilitychange', this.hVisibility);
    dom.removeEventListener('contextmenu', this.hContext);
    this.pointers.clear();
    this.keys.clear();
    this.shiftHeld = false;
  }
}