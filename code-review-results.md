# Web-Earth — Full Code Review

- **Date:** 2026-09-12
- **Scope:** entire repository — `src/` (all 14 TS modules), `index.html` (UI + CSS), `package.json`, `tsconfig.json`, `vite.config.ts`, `Dockerfile`, `docker-compose.yml`
- **Method:** line-by-line read of every source file; cross-file invariant checks (shared Sun vector, quality levers, disposal, DOM wiring); DOM id/`data-*` attribute audit against `index.html`; `npx tsc --noEmit` (passes, exit 0); behavior verified against installed `three@0.186.0` sources where relevant.

## Verdict

Well-structured, unusually well-documented code. Strict TypeScript, clean module boundaries, no dead `console.log`s, no TODOs, graceful asset-fallback chains, and genuinely careful memory management. Findings below are real but **none is a security hole or a data-loss bug**; the most important ones are one incorrect technical claim in comments (§A), one listener-leak path in `dispose()` (§B), one dead code path (§C), and a handful of behavioral/edge-case bugs (§D).

---

## A. Correctness & rendering pipeline

### A1. MISLEADING/INCORRECT comment: tone-mapping behavior of scene shaders — HIGH (doc)
`src/earth/EarthScene.ts` lines 738–743 (comment above `createComposer`) states:

> "the transparent layers (clouds' alpha, the additive atmosphere and stars) now blend in LINEAR HDR **before that single tone-map**"

This is not the actual mechanism. In `three@0.186.0` (`node_modules/three/src/renderers/webgl/WebGLPrograms.js` line 177–183), `toneMapping` is only taken from `renderer.toneMapping` **when rendering to the default framebuffer (screen)**. When the scene renders into the `EffectComposer`'s `HalfFloat` render target, every `#include <tonemapping_fragment>` / `<colorspace_fragment>` in the Earth/cloud/atmosphere/star shaders compiles to a no-op (verified against the installed 0.186.0 source). So:

- **Opaque layers** (Earth, Moon): linear values pass through, `OutputPass` applies ACES+sRGB once — correct. ✔
- **Transparent layers** (clouds, atmosphere, stars): also blend un-toned-mapped (linear) — the *observed* behavior the comment claims is incidental, not the stated reason. The comment's *reasoning* is wrong, which matters because it documents an invariant nobody can rely on: any future "fix" that re-enables per-material tone mapping would shift the look without anyone knowing why the comment said it was fine.
- Consequence to be aware of: clouds/atmosphere/star brightness is tone-mapped **after** alpha blending, so their perceived brightness is not independent of the scene behind them.

**Recommendation:** rewrite the comment to state the actual mechanism (tone-mapping chunks are no-ops for all scene shaders when rendering to an RT; `OutputPass` is the single tone-map + color-space stage), and add a note so nobody "helpfully" restores per-shader tone mapping.

### A2. Inverted `smoothstep()` edge order — LOW (portability / GLSL UB)
`src/earth/shaders/earth.ts` line 72 uses `smoothstep(0.28, 0.04, lum)` — edge0 **>** edge1. Per the GLSL spec this is undefined behavior; all major drivers handle it, but it is fragile.
**Recommendation:** write `1.0 - smoothstep(0.04, 0.28, lum)`.

### A3. Moon tidal-lock degeneracy — LOW
`updateMoonTransform()` (EarthScene.ts lines 1239–1252) uses `quaternion.setFromUnitVectors(+X, -normalize(moonPos))`. At `moonAngle ≈ π` (Moon at −X in the orbit plane) the two vectors become anti-parallel and `setFromUnitVectors` picks an **arbitrary** 180° axis, so the near-side face can flip for a frame or two. The orbit is confined to a 5.145°-tilted plane, so the Moon passes close to the degenerate direction twice per orbit.
**Recommendation:** when `dot(from, to) < -0.999`, use a fixed fallback axis (e.g. rotate about Y by π).

### A4. Moon relief epsilon is a UV-space constant — LOW (visual)
`src/moon/shaders/moon.ts` line 88: `e = 0.0025` UV units. Per-pixel relief detail changes with zoom, so crater relief fades in/out with distance. Consider `fwidth(vUv.x)`-scaled offsets (standard in WebGL2) for stable relief.

### A5. `antialias: true` on the renderer is dead config — INFO
`createRenderer()` (EarthScene.ts lines 301–306) enables canvas MSAA, but the scene is always rendered through `EffectComposer` into render targets, where only the RT's `samples` (per-tier `msaaSamples`) matter. Harmless — remove or comment it so no reader believes canvas MSAA is in effect.

---

## B. Lifecycle / resource management

### B1. `dispose()` leaks DOM event listeners — MEDIUM
`dispose()` (EarthScene.ts lines 2067–2117) removes `window`/`visualViewport`/`body`-click listeners and disposes GPU resources, but **does not remove**:

- the `pointerdown/move/up/cancel` listeners on `#sheet` (setupSheet, lines 950–953),
- the `document` `keydown` (Escape) listener (line 955),
- the `pointerdown/move/up/cancel` listeners on `#sun-pad` (lines 1768–1771),
- all per-button `click` listeners in `setupSunUI` (presets, reset-sun, auto-sun, softfill, collapse — lines 1774–1800),
- the `document` `fullscreenchange` listener (line 852),
- the sheet toggle/close/handle click listeners (lines 901–910).

`main.ts` today creates exactly one instance, so this is latent — but the class is designed to be re-creatable (and `window.__earth` exposes it), and any HMR/SPA/test harness that does `dispose(); new EarthScene(...)` accumulates duplicate listeners. **Recommendation:** collect listeners in one array (or use `AbortController` signals) and tear them all down in `dispose()`.

### B2. Double dispose of day/night textures — INFO (benign)
`loadTextureKey` pushes every successful texture into `this.textures` (line 436), and `loadEarth` pushes the day/night textures **again** (line 460). `dispose()` therefore disposes them twice. `Texture.dispose()` is idempotent so nothing breaks — but dedupe (push in exactly one place) to keep "one owner per texture" honest.

### B3. `visibilitychange` / battery — INFO
The render loop keeps running while the tab is hidden (rAF is throttled, so cost is ~zero), but `clock.getDelta()` returns a large `dt` on tab return, which feeds the FPS guard (see D3) and the Auto-Sun sweep. Consider pausing the clock or clamping `dt` (e.g. `Math.min(dt, 0.25)`).

---

## C. Dead / unreachable code

### C1. Auto-Sun branch is dead code; the button is a silent no-op — LOW (user-visible)
EarthScene.ts lines 2017–2024:

```ts
if (this.state.fullDaylight) {
  this.updateFullDaylightSun();
} else if (this.state.autoSun) {
  const nextAz = wrapAzimuth(this.sun.azimuth + dt * 10);
  this.updateSun(nextAz, this.sun.elevation);
}
```

`setAutoSun(true)` first calls `this.setFullDaylight(false)` when full-daylight is on (line 1700), and every other path that sets `autoSun = true` (URL params, UI toggle) goes through `setAutoSun`. So `state.autoSun && state.fullDaylight` is impossible — the `else if` branch is **never executed**, and the "Auto" Sun button (a live UI control, wired at line 1784) does nothing when pressed. **Recommendation:** either delete the Auto-Sun sweep + the `[data-action="auto-sun"]` button (if deprecated) or make the two modes coexist as intended.

### C2. Pending debug URL flags are never cleared after application — LOW
`?frontlight=1`, `?softfill=1`, `?sunray=1`, `?mode=…` set `pending*` flags applied at the end of `loadEarth()` (lines 589–595). They are never reset to their defaults after use, so the object's state remains misleading for anyone inspecting `window.__earth`. Clear them after application.

---

## D. Behavioral / edge-case bugs

### D1. `?quality=` URL param does not sync the Quality UI — MEDIUM
Sequence: `constructor` resolves `'auto'` → `init()` → `applyURLParams()` sets `qualitySetting` from the URL (lines 248–250) — but **nobody calls `applyQuality()` as a result of the URL param alone**. The tier levers are eventually reconciled at the end of `loadEarth()` via the `loadedAtTier` comparison (lines 600–604), which calls `applyQualityLevers`, but `syncQualityUI()` is only invoked from `setupUI()` (line 859), which runs **before** the async `loadEarth` completes. Net effect with e.g. `?quality=performance`:

- the scene ends up at the correct tier ✔
- the Quality segmented control still highlights **Auto** (or whatever the saved preference was), lying about the active setting ✘

**Recommendation:** in `applyURLParams`, after the URL param wins, call `this.applyQuality()` (renderer already exists at that point — safe). This also updates the UI immediately.

### D2. Old composer not disposed on tier switch (GPU leak per switch) — MEDIUM
`applyQualityLevers` (lines 1070–1073) does:

```ts
this.composer = null;
this.bloomPass = null;
this.createComposer();
```

without disposing the old composer's passes and render targets. This contradicts the explicit comment in `dispose()` (lines 2102–2106) that composer passes must be disposed "so repeated create/dispose cycles don't exhaust the GPU texture budget" — yet the quality-tier-switch path (which runs on every Auto→explicit switch and every FPS-guard downgrade that changes bloom/MSAA topology) performs exactly that cycle and leaks the old targets (UnrealBloomPass alone owns 11 render targets). **Recommendation:** extract the pass-disposal block from `dispose()` into a `disposeComposer()` helper and call it here before `createComposer()`.

### D3. FPS guard can misfire after tab background — LOW
`fpsGuard.acc += dt` (line 1973) uses raw `clock.getDelta()`. After the tab was backgrounded, the first returned `dt` can be seconds, dragging the measured FPS below 28 and triggering an unjustified downgrade (the cooldown only protects *after* a downgrade). Clamp `dt` or reset `acc`/`frames` on `visibilitychange`.

### D4. Auto-rotation speed is frame-rate dependent — LOW
Lines 1999–2004: `earthMesh.rotation.y += 0.0001` per frame. At 144 Hz the globe rotates 2.4× faster than at 60 Hz. Use a `dt`-scaled increment (e.g. `+= 0.0001 * dt * 60`) so speed is wall-clock constant.

### D5. `updateMoonLabel` writes DOM every frame even when hidden — INFO
Lines 1547–1553: when focus ≠ `system` it still assigns `el.style.display = 'none'` every frame (redundant style write). Cache the last written state and skip.

### D6. `setQuality`/`applyQuality` asymmetry vs FPS-guard path — INFO
The FPS-guard downgrade (lines 1983–1994) mutates `this.quality`, `qualityEpoch`, and calls `applyQualityLevers` + `syncQualityUI` directly, bypassing `applyQuality()`. It works, but it is a second, hand-rolled copy of that logic — if `applyQuality` ever gains a step (e.g. an event hook, analytics), the guard path silently skips it. Route the guard through `applyQuality` (guarding against setting changes) or a shared private helper.

---

## E. Accessibility & browser-compat

- **E1 — MEDIUM (WCAG):** `index.html` line 5: `maximum-scale=1.0, user-scalable=no` in the viewport meta disables pinch-zoom for **everyone**, including the DOM UI (sliders, buttons, panels). It's fine for the canvas (OrbitControls owns the gesture, and `touch-action: none` on the canvas already covers that at line 30), but it also prevents zooming the DOM chrome, a WCAG 1.4.4 concern. **Recommendation:** drop `maximum-scale=1.0, user-scalable=no` from the viewport meta.
- **E2 — GOOD:** `[hidden] { display:none !important }` (line 33), `aria-pressed`/`aria-expanded` kept in sync, `Escape` closes the sheet, `prefers-reduced-motion` respected for auto-rotate and camera tweens, fullscreen button hidden on iOS Safari. Solid a11y base.
- **E3 — INFO:** no `<noscript>` fallback; without JS the page is a black screen with a stuck loading bar. A one-line noscript message would help.
- **E4 — GOOD:** all DOM ids and `data-*` attributes referenced in `EarthScene.ts` were verified present in `index.html` (audit run 2026-09-12 — 100% match).

---

## F. Architecture, style, process

**Strengths (keep these intact in any refactor):**

1. Single-source-of-truth config split (`config/sceneScale.ts`, `config/camera.ts`, `config/mobile.ts`) is clean and actually used everywhere.
2. The shared `SunLightingState.direction` Vector3 referenced by all three `uSunDirection` uniforms is an elegant invariant — verified all three consumers (earth line 485, cloud line 511, atmosphere line 560) reference the same instance, and the Moon correctly uses a *separate* per-frame point-source direction (`moonSunDir`, line 2048).
3. No allocations in the hot loop (scratch `_v`, `_moonDir`, `_moonQuat`, `_sunTmp` reused).
4. Asset fallback chains + 1×1 `DataTexture` placeholders for clouds/moon mean first paint never fails.
5. `qualityEpoch` staleness guard for in-flight texture swaps (line 1139) — correct.
6. Disposal is 90% there (geometry/material/texture/composer/controls/renderer all covered).
7. `tsc --noEmit` passes with `strict: true`; no unused imports; no debug leftovers.

**Suggestions:**

- **F1 — the 2119-line `EarthScene.ts` is the single biggest structural risk.** The refactor direction in `PROJECT_MAP.md` (extract `Moon`, `Sun`, `Earth` object classes; a `UIController` for the ~600 lines of sheet/sun-panel/debug-panel wiring) is the right next step. The UI section alone (`setupUI`/`setupSheet`/`setupSunUI`/`setupDebugPanel`/`syncUIButtons`/`syncQualityUI`/`syncFocusUI`) is already cohesive, and extracting it would also fix the B1 listener-leak in one place.
- **F2 — `this.quality!` non-null assertions appear 20+ times.** Invariant-safe today, but a single `assertQuality()` helper (or resolving quality in a place TS can narrow) would remove them.
- **F3 — `applyURLParams` mixes two concerns** (quality-setting precedence: URL > localStorage > auto; and state parsing). Split into `resolveQualitySetting()` + `applyStateParams()` — `Quality.ts` is already a pure module and the resolution logic belongs with it (also enables unit testing, see F4).
- **F4 — no automated tests.** `scripts/lighting_math_test.mjs` is the only one. The pure modules (`Quality.ts`, `SunLighting.ts`, `sceneScale.ts`) are trivially unit-testable (tier detection, `wrapAzimuth`, az/el ↔ vector round-trips) and would guard the A1/D1 regressions. Vitest fits the existing Node 22 toolchain in ~30 lines of config.
- **F5 — `package.json`:** `three` `^0.186.0` vs `@types/three` `^0.185.4` — the minors drift; align them or comment the tolerated skew. Also no `engines` field.
- **F6 — Docker:** multi-stage build is correct, healthcheck is good, `.dockerignore` correctly keeps `node_modules`/`dist` out of the build context.
- **F7 — `vite.config.ts` `build.target: 'esnext'`** while `tsconfig` targets ES2020 — fine for a self-hosted site; align if browser support ever matters.

---

## G. Security

- **G1 — GOOD:** no `innerHTML`/`eval`/`new Function` anywhere; all dynamic DOM is `textContent` or attribute writes with static values.
- **G2 — GOOD:** URL parameters are strictly validated (enum sets, numeric parsing with `Number.isFinite`, explicit clamps to `[-180,180]`/`[-90,90]`) — no injection surface.
- **G3 — INFO:** `window.__earth` is intentionally exposed (main.ts line 9) — documented as a debug hook; acceptable for a public site, just be aware it exposes the full scene graph and `dispose()` to the console.
- **G4 — GOOD:** `localStorage` access is wrapped in try/catch (private-mode safe).
- **G5 — INFO:** no security headers (static site on nginx defaults). Low risk for a static-only app, but consider a basic `Content-Security-Policy` + `X-Content-Type-Options: nosniff` in an nginx `server { }` block for hygiene.

---

## H. Summary of actionable items (prioritized)

| # | Sev | Location | Issue | Fix |
|---|-----|----------|-------|-----|
| 1 | MED | EarthScene.ts 1070–1073 | Old composer not disposed on tier switch (GPU leak per switch) | Extract `disposeComposer()` and call before `createComposer()` |
| 2 | MED | EarthScene.ts 2067–2117 | `dispose()` leaves sheet/pad/sun-panel/Escape/fullscreen listeners bound | Collect & remove in `dispose()` (or `AbortController`) |
| 3 | MED | EarthScene.ts 245–258, 859 | `?quality=` URL param doesn't update Quality UI highlight | Call `applyQuality()` after the URL param wins |
| 4 | MED | index.html 5 | `user-scalable=no, maximum-scale=1.0` blocks UI zoom (WCAG 1.4.4) | Drop from viewport meta; `touch-action:none` stays scoped to canvas |
| 5 | LOW | EarthScene.ts 2017–2024 | Auto-Sun branch unreachable; button is a silent no-op | Delete feature or fix `setAutoSun` interplay |
| 6 | LOW | EarthScene.ts 738–743 | Comment incorrectly explains tone-mapping behavior | Rewrite to match `three@0.186` actual behavior (A1) |
| 7 | LOW | shaders/earth.ts 72 | `smoothstep(0.28, 0.04, …)` reversed edges = GLSL UB | `1.0 - smoothstep(0.04, 0.28, lum)` |
| 8 | LOW | EarthScene.ts 1239–1252 | Moon quaternion degenerate near `angle = π` | Fallback axis for anti-parallel case |
| 9 | LOW | EarthScene.ts 1999–2004 | Auto-rotation speed ∝ frame rate | Scale increment by `dt` |
| 10 | LOW | EarthScene.ts 1973 | FPS guard reads un-clamped `dt` after tab return | Clamp `dt` or reset guard on `visibilitychange` |
| 11 | LOW | EarthScene.ts 436 + 460 | Day/night textures tracked twice (double dispose — benign) | Push into `textures` in one place only |
| 12 | INFO | EarthScene.ts 301–306 | `antialias: true` unused (composer renders to RT) | Remove or comment |
| 13 | INFO | EarthScene.ts 1547 | `display:none` written every frame when hidden | Cache last state |
| 14 | INFO | package.json | `three` 0.186 vs `@types/three` 0.185 skew; no `engines` | Align minors |
| 15 | INFO | — | No unit tests for pure modules | Vitest for `Quality.ts`, `SunLighting.ts`, `sceneScale.ts` |

---

*End of review — 15 prioritized findings, 4 medium, 7 low, 4 info. No blockers, no security vulnerabilities found.*

