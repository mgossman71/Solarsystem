# Code Review — Web-Earth

**Date:** 2026-09-11
**Branch:** `mobileFriendly` (HEAD `bb84e28`)
**Scope:** `src/` (main.ts, earth/EarthScene.ts, earth/Quality.ts, earth/SunLighting.ts), `index.html`, `scripts/`, config (`package.json`, `tsconfig.json`, `vite.config.ts`, `Dockerfile`, `docker-compose.yml`).

**Verification performed**

- `npm run build` (`tsc --strict` + `vite build`) — **passes** (one >500 kB chunk warning, see N5).
- `node scripts/lighting_math_test.mjs` — **124/124 checks pass**.
- Findings below were checked against the installed `node_modules/three` source (r186), not memory.

**Overall:** This is a well-organized, unusually well-commented codebase — single-source Sun state, allocation-free render loop, epoch-guarded async swaps, careful disposal, real (non-fake) asset fallbacks, and a headless math test for the lighting model. That said, the review found **two functional bugs**, one resource leak, and a batch of lower-severity items.

---

## High severity (functional bugs)

### H1. Runtime FPS auto-downgrade can never trigger (unit error)
`src/earth/EarthScene.ts:2501`

```ts
const fps = (this.fpsGuard.frames / this.fpsGuard.acc) * 1000;
```

`this.fpsGuard.acc` accumulates `this.clock.getDelta()`, and three.js `Clock.getDelta()` returns **seconds** (verified in `node_modules/three/src/core/Clock.js:107-131`: `diff = (newTime - this.oldTime) / 1000`). So `frames / acc` is *already* fps; multiplying by 1000 yields e.g. `60000` for a real 60 fps, and the guard `if (fps < 28)` (line 2505) is **never true**. The entire Auto-tier downgrade feature documented in `Quality.ts` ("steps DOWN one tier if the device can't sustain it") is dead code, and `fpsGuard.appliedDowngrade` can never increment.

Every other `dt` consumer in `animate()` (moon orbit, auto-Sun sweep, cloud drift) correctly treats `dt` as seconds — this one site is the outlier.

**Fix:** `const fps = this.fpsGuard.frames / this.fpsGuard.acc;` — and add a headless unit test around the fps computation (it's the one piece of the quality system with no coverage).

### H2. Saved / URL quality setting is not applied at startup
`src/earth/EarthScene.ts:621` (constructor) vs `669-682` (`applyURLParams`)

`this.quality` is resolved **exactly once, in the constructor**, before `init()` runs `applyURLParams()`. `applyURLParams()` then assigns `this.qualitySetting` from `?quality=…` or the `earth-quality` localStorage value, but **never re-resolves `this.quality` and never calls `applyQuality()`**. Consequences:

- A user who selected **Performance** (persisted) reloads the page and gets whatever `detectAutoTier()` picked (e.g. High) — pixel ratio, bloom, MSAA, star count, tessellation, and texture set all stay at the constructor's profile.
- `?quality=performance`, which is explicitly supported "for deterministic scenes for debugging / QA" (comment at line 657), silently does nothing until the user clicks a quality button.
- The UI is inconsistent: `syncQualityUI()` highlights buttons from `this.qualitySetting`, so the "Performance" button shows active while the renderer is actually running the auto-resolved tier. The "Auto — rendering at …" tooltip (line 1694) likewise reports the stale tier.

`resolveProfile` is only otherwise called from `applyQuality()` (line 1566), which fires only on `setQuality()` user action.

**Fix:** In `init()`, after `applyURLParams()`, re-resolve the profile (e.g. `this.quality = resolveProfile(this.qualitySetting); this.applyQuality();`) when the setting changed. Note `applyQualityLevers` at the end of `loadEarth()` (line 1024-1028) also keys off the stale `this.quality`, so fixing the resolution point fixes that path too.

---

## Medium severity

### M1. Composer rebuild on tier switch leaks the old composer's GPU resources
`src/earth/EarthScene.ts:1592-1597`

```ts
if (prevBloom !== wantBloom || from.msaaSamples !== profile.msaaSamples) {
  this.composer = null;
  this.bloomPass = null;
  this.createComposer();
}
```

The old `EffectComposer` (2 HalfFloat render targets), its `UnrealBloomPass` (11 render targets + materials + quads), `RenderPass` and `OutputPass` are simply abandoned when a topology change forces a rebuild — e.g. toggling High ⇄ Performance at runtime, a normal user action. `dispose()` (lines 2629-2635) shows the correct pattern (dispose every pass, then the composer) and even documents "repeated create/dispose cycles … GPU texture budget", but the rebuild path here never applies it. Repeated toggling on a memory-constrained mobile device will keep allocating until the context runs dry.

**Fix:** Before reassigning, dispose the old composer's passes and the composer itself (extract a `destroyComposer()` helper shared with `dispose()`).

### M2. `THREE.Clock` is deprecated in the installed three (r186) — console noise + future breakage
`src/earth/EarthScene.ts:546, 618`

In three r186, `Clock`'s constructor calls `warn('Clock: This module has been deprecated. Please use THREE.Timer instead.')` (verified in `node_modules/three/src/core/Clock.js:61`), so every app startup logs a deprecation warning. `THREE.Timer` is present in the installed build (`src/core/Timer.js`) and is the intended replacement.

**Fix:** Migrate `this.clock` to `THREE.Timer` (careful: `Timer` also reports time in seconds, so the H1 fps math stays valid). Worth doing in the same pass as the H1 fps-guard fix, since both touch timing.

### M3. `apple gpu` in the "weak GPU" list demotes *all* Apple devices
`src/earth/Quality.ts:159`

```ts
const weakGpu = /adreno (…) |^mali (…) |apple gpu/i.test(gpu);
```

The unmasked renderer string on every iPhone, iPad and Apple-Silicon Mac contains "Apple GPU". On mobile this means **every** iOS device — including iPhone 16 Pro class hardware — is forced to the `performance` tier (no bloom, 5k stars, 1.5 DPR cap) via `if (weakGpu || cores <= 3 || mem <= 3) return 'performance'` (line 162). On desktops the compound `cores <= 4 && mem <= 4` guard mostly saves it, but the classification itself is unsound: an M3 Max is no more "weak" than an Adreno 1050, yet both match. This contradicts the module's stated goal of "renders at the right cost for the device — not a shrunken desktop".

**Fix:** Remove `|apple gpu` from the weak list (or match only specific old families), and rely on the measurable `cores`/`deviceMemory` signals — which is exactly the no-sniffing principle the file's header advertises.

---

## Low severity / robustness

### L1. Textures registered twice → redundant double-dispose
`src/earth/EarthScene.ts:860` and `:884`

`loadTextureKey()` pushes every successful texture into `this.textures`, and `loadEarth()` additionally pushes `dayTexture, nightTexture` again (line 884). `dispose()` then disposes each twice (harmless — three's `Texture.dispose()` is idempotent — but it makes the array unreliable as a registry). Pick one registration point (the loader is the natural owner).

### L2. Cloud-texture swap can race the background cloud load
`src/earth/EarthScene.ts:963-975` vs `1651-1680`

The non-blocking cloud `.then()` (line 964) writes `uCloudTexture` unconditionally when it resolves, while `swapTextureSet()` (tier change) writes the same uniforms with an epoch guard. If a tier switch lands between the cloud load resolving and its `.then` executing, the *older set's* cloud map wins (last write, no epoch check). Visually minor (1k vs 2k clouds), but it's the one unguarded async write in an otherwise epoch-disciplined design.

**Fix:** Capture `this.qualityEpoch` when the cloud load starts in `loadEarth()` and skip the write if it changed.

### L3. `dispose()` leaves a tail of DOM listeners and the GL context behind
`src/earth/EarthScene.ts:2589-2639`

Disposed: window resize/orientation/pageshow, body click, rAF chains, timers, GPU objects. **Not** disposed: the sun-pad pointer listeners, sun-panel button listeners, sheet listeners, the document `keydown` (Escape) listener, and `renderer.forceContextLoss()` is never called (the WebGL context lives on until GC). `dispose()` currently only runs on the fatal load-failure path, so impact is small — but any driver that repeatedly constructs/disposes `EarthScene` (the `window.__earth` hook invites this) will accumulate dead listeners and orphaned GL contexts (browsers cap these at ~16).

### L4. `INITIAL_MOON_ANGLE` comment contradicts the geometry
`src/earth/EarthScene.ts:470`

`INITIAL_MOON_ANGLE = -60°` places the Moon at `z ≈ −8.6` — i.e. **behind** the Earth from the default +Z camera, not "right of Earth, not behind it" as the comment claims. Either the comment or the constant is wrong; decide the intended initial composition and align them.

### L5. URL-parameter documentation omits `?focus=sun`
`src/earth/EarthScene.ts:659-662` lists `?focus=earth|moon|system`, but `applyURLParams()` (line 703) also accepts `focus=sun`, and the shipped UI exposes a Sun focus button. Update the comment — it's the de-facto QA reference for this app.

### L6. Accessibility
- `index.html:5` — `maximum-scale=1.0, user-scalable=no` disables user pinch-zoom, which trips WCAG 1.4.4. Understandable for a full-screen WebGL canvas (the CSS already pins canvas gestures with `touch-action:none`), so the viewport ban may be redundant — consider allowing it and keeping `touch-action` scoped to the canvas.
- The loading progress bar has no `role="progressbar"`/`aria-live`; screen-reader users get a static "Loading…" label with no completion signal.
- No `<noscript>` fallback (the page is otherwise 100% JS).

---

## Nits

- **N1. `Quality.ts:136`** — `gpuRendererString()` re-acquires `WEBGL_lose_context` via a second `getExtension()` call through an `unknown` cast; simpler to keep one reference: `const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();`
- **N2. Stale one-off diagnostic scripts** — `scripts/check_baked_lighting.py` and `scripts/verify_new_texture.py` reference `earth-blue-marble.jpg` and `/tmp/earth-daymap-2k.jpg`, which no longer exist (renamed to `earth-day-albedo.jpg`); `scripts/verify_moon_texture.py:19` hardcodes an absolute `/Users/gozz/...` path. They now fail out of the box — make paths relative like the other scripts, or mark them as historical.
- **N3. `package.json`** — no `test` script; `node scripts/lighting_math_test.mjs` is the only test and discoverable only by reading `scripts/`. Add `"test": "node scripts/lighting_math_test.mjs"`.
- **N4. `Dockerfile`** — no nginx cache-header config for `public/assets/*` (multi-MB JPEGs). A small `nginx.conf` with `Cache-Control` for `/assets/` is cheap bandwidth/UX for the mobile audience this app targets.
- **N5. Build** — Vite reports a 643 kB (161 kB gzip) single chunk (all of three.js + app). Fine at this app size, but code-splitting `three` + postprocessing into their own chunks would trim initial parse on mobile.
- **N6. `EarthScene.ts:577`** — `fpsGuard.appliedDowngrade` is written but never read; surface it in a `?debug` panel or drop it.
- **N7. `EarthScene.ts:2039`** — comment "raycast ignores visible" is easy to misread (the intended behavior — raycasting still *hits* `visible:false` proxies — does work); consider "raycast hits despite visible=false".

---

## What's notably good (keep doing)

- **Single source of truth for Sun state** (`SunLightingState` shared by reference into every `uSunDirection` uniform) — no lighting consumer can drift from another.
- **Headless lighting-math test** replicating the exact shader pipeline (124 assertions) — rare and valuable for shader work.
- **No per-frame allocations** in `animate()` (scratch vectors, cached DOM refs, skip-unchanged writes in `updateSunUI`).
- **Epoch-guarded async texture swaps** and real lower-res fallbacks (never procedural fakes), with graceful non-blocking cloud/moon/sun loads.
- **Thorough disposal** in `dispose()` (pass-level bloom teardown, explicit texture disposal, corona sprite) — the M1 rebuild path is the one exception.
- **Reduced-motion respect** (auto-rotate off, zero-duration camera transitions), generous invisible hit proxies for touch, and pointer-capture discipline on pad/sheet.
- Sensible defensive details: `?sun=` clamping, localStorage in try/catch, iOS fullscreen detection, bfcache `pageshow` resize, `overscroll-behavior:none`.

---

## Suggested order of fixes

1. **H1** fps-guard units (one line + a test) — the advertised auto-degrade is currently never running.
2. **H2** quality-setting resolution at startup (a few lines) — persisted/URL settings are currently ignored.
3. **M1** composer teardown on rebuild (extract a shared helper).
4. **M3** drop `apple gpu` from the weak-GPU regex (one line, big real-world effect on iOS).
5. **M2** `Clock` → `Timer` migration (bundles naturally with #1).
6. L1–L3, then nits as they get touched.

