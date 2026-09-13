# Code Review — Saturn branch working tree

**Date:** 2026-09-13
**Scope:** working-tree diff vs `HEAD` (`src/`, `vite.config.ts`, `tsconfig.json`, `package.json`, `docs/`) plus new untracked files (`eslint.config.js`, `vitest.config.ts`, `src/__tests__/pure-logic.test.ts`, `.github/workflows/ci.yml`)
**Build/test status:** `npx tsc --noEmit` and `npm test` both pass.

---

## Medium

### 1. Star point size still calibrated for the old shell radius
`src/earth/shaders/starfield.ts:9`

`gl_PointSize = aSize * (600.0 / -mvPosition.z)` — the inline comment still says "stars sit at 200–350", but this change moved the shell to 380–530 without touching the constant. Mean distance goes 275 → 455, so every star renders ~1.65× smaller: the dim end (`aSize = 0.5`) drops from ~1.1 px to ~0.66 px, i.e. sub-pixel, so those stars alias/flicker or disappear entirely and the whole field dims. The star-count bump (12k → 20k) adds fill cost but does not restore per-star size.

**Fix:** scale the `600.0` constant with `STAR_FIELD_RADIUS_MIN`.

### 2. Star-shell invariant does not hold in Real scale
`src/config/sceneScale.ts:31`

The new invariant ("the shell sits behind every body … Saturn |r| ≈ 301") is false in Real scale. `saturnMoonOrbit(def, 'real')` returns `orbitKm / 6371`: Titan = 191.8 and Iapetus = 558.9 units from Saturn's center, with Saturn at |r| = 301. So with `?scale=real`, Titan reaches ~493 units and Iapetus ~860 units from the origin — inside and beyond the 380–530 band. Stars are additive with `depthWrite: false`, so they render in front of those moons: exactly the "stars through the body" artifact this change was meant to eliminate.

### 3. Saturn planet hit proxy is unreachable
`src/earth/EarthScene.ts:1728` (pre-existing, but this hunk edits the branch)

The Saturn *planet* proxy is built at `:1695` as `make(SATURN_RADIUS * 1.3, 'saturn')` with no third argument, so its `saturnIndex` is `undefined` and `else if (p.saturnIndex != null)` never matches it. `make()` leaves `mesh.visible = false`, and `bindSelection` filters on `p.mesh.visible`, so tapping Saturn's globe never selects it — and the `if (p.focus === 'saturn')` sub-branch inside is dead code.

**Fix:** gate on `isSaturnFocus(p.focus)` instead.

### 4. Startup `try` block over-claims a WebGL failure and leaks a half-built scene
`src/main.ts:11`

The `try` wraps the constructor *and* all of `init()`, but the overlay text asserts a WebGL failure. Any unrelated startup throw (a missing DOM node in `setupUI`/`setupSunUI`, a shader-compile throw in `createComposer`, a bad `?sun=` parse) shows "This browser could not start WebGL" — a wrong diagnosis. Nothing is disposed either: by then the canvas is appended and the `resize`/`orientationchange`/`pageshow` listeners are registered, and on a constructor throw `scene` is still `null`, so the half-built scene can never be cleaned up and keeps running under the overlay.

**Fix:** narrow the `try` to renderer creation, or dispose in the catch and use generic wording.

---

## Low

### 5. `__earth` can now be `null`
`src/main.ts:29`

The CDP test driver's `window.__earth.getFocus()` will fail with a bare `TypeError` instead of the previous clearer failure. Consider leaving a marker object or setting a separate `__earthError`.

### 6. One transient frame exception permanently kills the render loop
`src/earth/EarthScene.ts:2182`

The new `animate` catch cancels the already-scheduled frame and rethrows, so a single transient exception (e.g. one frame during a WebGL context-loss/restore cycle) stops rendering for good: frozen canvas, no message, no recovery. Previously the loop kept running. Consider disposing + showing the failure overlay, or tolerating N consecutive failures.

### 7. Quality heuristic regresses on Apple mobile
`src/core/Quality.ts:162`

Dropping `apple gpu` from `weakGpu` means no Apple mobile device can reach `performance` from the GPU signal, and on Safari `navigator.deviceMemory` is undefined (falls back to 8), so only `hardwareConcurrency <= 3` remains. A thermally-limited 6-core iPhone now starts at `balanced` — with bloom and, after this change, 13k stars instead of 8k. The runtime FPS guard mitigates it, but the first seconds of every session on such devices regress. Worth gating on screen size or a first-frame timing probe as well.

### 8. `applyURLParams` bypasses the new `setFocus` invariant
`src/earth/EarthScene.ts:294`

`setFocus` was changed so `this.focus` is committed only once the body exists, but `applyURLParams` still assigns `this.focus = focusParam` directly *and* sets `pendingFocus`. During load, `getFocus()` (public, used by tests) reports a focus that was never committed, and `focusCenter()` resolves it against a non-existent body (falls through to the origin).

**Fix:** set only `pendingFocus` here.
