import { EarthScene } from './earth/EarthScene';

const app = document.getElementById('app');
if (!app) throw new Error('#app element not found');

// Startup failure handling. The WebGL renderer is created in the CONSTRUCTOR,
// so a failed `new EarthScene(...)` almost always means the browser could not
// produce a WebGL context (hardware acceleration disabled/blocked, or no GPU).
// Scene setup in init() is a separate failure domain (sun, composer, UI) and
// must not be mislabelled as "WebGL". Both surface a human-readable overlay
// (instead of a blank page + raw stack) and expose the underlying error for
// debugging (CDP test driver / devtools).
function overlayError(message: string, err: unknown): void {
  (window as unknown as Record<string, unknown>).__earthError = err;
  console.error('Failed to start the 3D scene:', err);
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;' +
    'gap:12px;align-items:center;justify-content:center;padding:24px;' +
    'box-sizing:border-box;text-align:center;color:#fff;' +
    'font:16px/1.5 system-ui,sans-serif;background:rgba(0,0,0,0.92)';
  const title = document.createElement('div');
  title.textContent = message;
  root.appendChild(title);
  // Show the real cause — a WebGL failure and an asset/init failure otherwise
  // look identical, so this detail line is the primary diagnostic.
  const detailText =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (detailText) {
    const detail = document.createElement('div');
    detail.style.cssText =
      'max-width:60ch;color:rgba(255,255,255,0.6);font:13px/1.45 ' +
      'ui-monospace,SFMono-Regular,Menlo,monospace;';
    detail.textContent = detailText;
    root.appendChild(detail);
  }
  document.body.appendChild(root);
}

let scene: EarthScene | null = null;

// Phase 1 — constructor: create the WebGL renderer / context.
try {
  scene = new EarthScene(app);
} catch (err) {
  overlayError(
    'This browser could not start WebGL. Hardware acceleration may be ' +
      'disabled or blocked — enable it in browser settings, or try a ' +
      'different browser.',
    err,
  );
}

// Phase 2 — scene setup (sun, composer, UI, render loop). A synchronous throw
// here is a scene-init problem, NOT a WebGL one. Release GPU resources before
// showing the overlay so we don't leak a live renderer / requestAnimationFrame
// loop on a half-built scene. (loadEarth() failures are already handled inside
// init() with a specific message, so they never reach this catch.)
if (scene) {
  try {
    scene.init();
  } catch (err) {
    try {
      scene.dispose();
    } catch {
      /* best-effort cleanup */
    }
    overlayError('The scene failed to initialise. Check the console for details.', err);
  }
}

// Debug/test hook (used by the CDP test driver; harmless in production).
(window as unknown as Record<string, unknown>).__earth = scene;