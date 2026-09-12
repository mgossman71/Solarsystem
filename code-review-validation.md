# Web-Earth — Code Review (validated, actionable)

**Date:** 2026-09-12 · **Branch:** `codeReview` · **Reviewer:** Claude Opus 5 (second pass)

**Scope:** whole repository — `src/` (15 TS modules), `index.html`, `package.json`,
`tsconfig.json`, `vite.config.ts`, `Dockerfile`, `docker-compose.yml`.

**Method:** full read of every source file, plus **live verification in headless Chrome 153**
driven over CDP against a production `vite build`, using the `window.__earth` debug hook.
Findings tagged **VERIFIED** were reproduced in a real browser; the rest are source-level.
`npx tsc --noEmit` and `npm run build` both pass on the current tree.

This document supersedes the first-pass review. It is self-contained — you do not need any
other file to execute from it. Every item below is either actionable (§2) or explicitly
closed (§3); nothing in between.

---

## 1. Summary

Well-structured, unusually well-documented code: strict TypeScript, clean module
boundaries, no stray `console.log`s, graceful asset-fallback chains, careful disposal.
**No security vulnerabilities.** No data-loss bugs.

Two HIGH issues are worth scheduling promptly — both are silent (no error, no console
warning) and both degrade exactly the low-end devices the adaptive-quality system exists to
protect:

- **H1** — a user's saved quality preference never reaches the renderer.
- **H2** — GPU render targets leak on every quality-tier change, measured unbounded.

| Sev | Count | Items |
|---|---|---|
| HIGH | 2 | H1, H2 |
| MEDIUM | 4 | M1–M4 |
| LOW | 6 | L1–L6 |
| INFO | 3 | N1–N3 |

A first-pass review raised 15 findings; 11 held up, 2 were invalidated, 1 was corrected, and
1 was correct about the location but described the symptom backwards. The invalidated and
corrected items are listed in **§3 — Do not action**, because acting on them would remove
working behavior or replace accurate documentation. Ten further findings were added here.

---

## 2. Actionable findings

Each item gives the location, the defect, the fix, and how to confirm it.

### H1 — A saved or URL-specified quality preference never reaches the renderer
**Severity:** HIGH · **VERIFIED** · `src/earth/EarthScene.ts:197`, `:245-296`, `:1041`

**Defect.** The constructor sets `this.quality = resolveProfile(this.qualitySetting)` at
line 197, while `qualitySetting` is still its `'auto'` default. `init()` then calls
`applyURLParams()`, which overwrites `qualitySetting` from `?quality=` or from the
`earth-quality` localStorage key (lines 248–258) — but nothing re-resolves `this.quality`
from the new setting. `applyQuality()` has exactly one caller, `setQuality()` (line 1030),
which is reachable only from a UI click.

**Evidence.** Production build loaded with `?quality=performance`:

```json
{"setting":"performance","activeTier":"high","uiActive":["performance"],
 "starCount":12000,"bloom":true,"pixelRatioCap":2}
```

The Quality button correctly reads "Performance" while the renderer runs the **high**
tier — 12 000 stars, bloom on, high-res texture set.

**Impact.** `setQuality()` persists the user's choice to localStorage, and that persisted
value is read back through the same dead-end path. So **a user's saved quality choice is
silently ignored on every reload.** Someone who selects *Performance* on a phone because the
page stutters gets it for that session only; next visit they are back on the auto-detected
tier, with the button still lit "Performance". The `?quality=` QA flag is inert for the same
reason.

**Fix.** Re-resolve the profile at the end of `applyURLParams()` — *before* `createSun()`,
`createComposer()` and `loadEarth()` build anything from it:

```ts
// applyURLParams(), just before the closing brace (line 296)

// The constructor resolved 'auto' before the URL / localStorage preference was
// known. Re-resolve here, BEFORE createSun / createComposer / loadEarth build
// anything from the profile, so every consumer is constructed at the right tier.
const resolved = resolveProfile(this.qualitySetting);
if (resolved.tier !== this.quality!.tier) {
  this.quality = resolved;
  this.qualityEpoch++;
  this.renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, resolved.pixelRatioCap),
  );
}
```

> **Do not call `applyQuality()` here instead.** At this point in `init()` the composer does
> not exist yet, so `applyQualityLevers` would take its rebuild branch (lines 1070–1073) and
> construct a composer; `init()` then calls `createComposer()` again at line 208, orphaning
> the first one — reintroducing H2. Re-resolving the profile directly is correct because no
> consumer has been built yet, so there are no levers to re-apply. `syncQualityUI()` already
> runs later via `setupUI()` (line 859).

**Verify.** Load `?quality=performance`; `__earth.getActiveTier()` must be `'performance'`,
star count 5000, `__earth.bloomPass === null`. Then pick a tier in the UI, reload with no
query string, and confirm the tier survives.

---

### H2 — Composer render targets leak on every quality-tier change
**Severity:** HIGH · **VERIFIED** · `src/earth/EarthScene.ts:1070-1073`

**Defect.** `applyQualityLevers` nulls `this.composer` and calls `createComposer()` without
disposing the old composer's passes or render targets:

```ts
this.composer = null;
this.bloomPass = null;
this.createComposer();
```

This contradicts the explicit comment already in `dispose()` (lines 2102–2106) warning that
`EffectComposer.dispose()` does not free passes added via `addPass()`, and that
`UnrealBloomPass` alone owns 11 render targets.

**Evidence.** `renderer.info.memory.textures` across live tier switches:

| Step | Textures |
|---|---|
| baseline (auto → high) | 17 |
| → performance | 21 |
| → high | 34 |
| + two more cycles | **49** |

Monotonic, never reclaimed. Geometries stayed flat at 6, confirming `swapGeometry` disposes
correctly — the leak is specific to the composer.

**Impact.** Not a latent path. The runtime FPS guard (lines 1983–1994) takes it
*automatically* on slow devices, and the Quality control takes it on every user click. The
devices most likely to trigger repeated downgrades are the ones least able to absorb leaked
GPU memory.

**Fix.** Extract the disposal block from `dispose()` into a helper and call it from both
places:

```ts
/** Free composer passes + targets. EffectComposer.dispose() does NOT free
 *  passes added via addPass() — UnrealBloomPass owns 11 render targets. */
private disposeComposer(): void {
  if (!this.composer) return;
  for (const pass of this.composer.passes) {
    (pass as { dispose?: () => void }).dispose?.();
  }
  this.composer.dispose();
  this.composer = null;
  this.bloomPass = null;
}
```

Then at lines 1070–1073:

```ts
if (prevBloom !== wantBloom || from.msaaSamples !== profile.msaaSamples) {
  this.disposeComposer();
  this.createComposer();
}
```

and replace the inline block in `dispose()` (lines 2107–2113) with `this.disposeComposer();`.

**Verify.** Cycle `__earth.setQuality('performance')` ⇄ `'high'` four times and confirm
`renderer.info.memory.textures` returns to its baseline rather than climbing.

---

### M1 — Bottom-sheet handle tap never opens the sheet
**Severity:** MEDIUM · **VERIFIED** · `src/earth/EarthScene.ts:906-910`, `:947`

**Defect.** `onUp` ends with `this.sheetDrag.moved = true` unconditionally (line 947), on
every pointerup on `#sheet` — not only after a real drag (`moved` is otherwise set at line
924 when `|dy| > 8`). `pointerup` fires before `click`, so the handle's click listener always
observes `moved === true`, resets it, and returns. The handle's tap-to-cycle
(collapsed → half → full) is **permanently dead**, not merely suppressed after a drag.

**Evidence.** 420×800, touch emulation: three consecutive taps on `.sheet-grabber` left
`dataset.sheet === "collapsed"`. The ⚙ `#sheet-toggle` — which has its own listener and does
not consult `moved` — opened it to `half` immediately.

**Impact.** An interaction documented in `docs/ui.md` and `AGENT_CHECKPOINT.md:555` does
nothing. The sheet is still reachable via ⚙ and by dragging, so this is a degraded
affordance rather than a lockout.

**Fix.** Fold into M2 below — one change resolves both.

---

### M2 — Every control inside the sheet is dead for mouse input at ≤768 px
**Severity:** MEDIUM · **VERIFIED** · `src/earth/EarthScene.ts:915-920`

**Defect.** `onDown` calls `this.sheetEl.setPointerCapture(e.pointerId)` on **any**
pointerdown anywhere in `#sheet`, including on its buttons. Per Pointer Events Level 3,
`click` is retargeted to the capture element, so the delegated `uiHandler`'s
`e.target.closest('[data-focus],[data-orbit],[data-scale],[data-action],[data-quality]')`
resolves against `#sheet`, returns `null`, and the handler silently does nothing.

**Evidence.** Isolated repro, Chrome 153:

```
mouse:  click target = #sheet   → closest([data-focus]) = NULL
touch:  click target = #btn     → closest([data-focus]) = btn
```

Against the real app at 420 px wide: a synthetic **mouse** click on the sheet's
`[data-focus="moon"]` left `getFocus() === "earth"`; the identical **touch** tap moved it to
`"moon"`.

**Impact.** `.sheet` is `display:none` above 768 px, so this affects mouse/trackpad users at
a viewport ≤ 768 px: a narrowed desktop window, a small laptop, a touchscreen laptop driven
by trackpad, and anyone testing in responsive mode. Touch users are unaffected — which is
why it has not been noticed.

**Fix.** Capture lazily, once the gesture is actually a drag. This also fixes M1, because
`moved` then only becomes true for real drags:

```ts
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
    if (Math.abs(dy) <= 8) return;        // still a tap — leave the click alone
    this.sheetDrag.moved = true;
    this.sheetEl!.style.transition = 'none';
    this.sheetEl!.setPointerCapture(e.pointerId);
  }
  const maxOff = this.sheetOffset('collapsed');
  const target = Math.max(0, Math.min(this.sheetDragFrom + dy, maxOff));
  this.sheetEl!.style.transform = `translateY(${target}px)`;
};

const onUp = (e: PointerEvent): void => {
  if (!this.sheetDrag.active) return;
  this.sheetDrag.active = false;
  if (!this.sheetDrag.moved) return;      // a tap: let the click through
  try { this.sheetEl!.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  this.sheetEl!.style.transition = '';
  // …existing snap-to-nearest-state logic, unchanged…
  this.setSheetState(best);
  // `moved` stays true so the click that follows this drag is suppressed;
  // the handle's click listener resets it.
};
```

**Verify.** At 420 px with a **mouse**: every sheet button responds. With touch: tapping the
grabber cycles collapsed → half → full, and dragging still scrubs and snaps.

---

### M3 — Viewport meta disables pinch-zoom for the whole UI
**Severity:** MEDIUM (WCAG 1.4.4) · `index.html:5`

**Defect.** `maximum-scale=1.0, user-scalable=no` blocks zoom for everyone, including the
DOM chrome — sliders, buttons, panels — not just the canvas.

**Impact.** The canvas does not need it: OrbitControls owns the gesture and `touch-action:
none` is already scoped to `canvas` (line 30) and `.sun-pad` (line 290). The meta tag only
costs accessibility.

**Fix.**

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

**Verify.** Pinch-zoom works on the sheet and Sun panel; dragging the globe and the Sun pad
still does not scroll or zoom the page.

---

### M4 — `dispose()` leaves document-level listeners bound
**Severity:** MEDIUM · `src/earth/EarthScene.ts:2067-2117`

**Defect.** `dispose()` removes the `window` / `visualViewport` / `body`-click listeners but
not:

| Listener | Line | Retains the scene? |
|---|---|---|
| `document` `keydown` (Escape closes sheet) | 955 | **yes** |
| `document` `fullscreenchange` | 852 | **yes** |
| `#sheet` pointerdown/move/up/cancel | 950–953 | no (element persists, closure does) |
| `#sun-pad` pointerdown/move/up/cancel | 1768–1771 | no |
| `setupSunUI` per-button clicks (presets, reset-sun, auto-sun, softfill, collapse) | 1774–1800 | no |
| sheet toggle / close / handle clicks | 901–910 | no |
| `renderer.domElement` pointerdown/up (`bindSelection`) | 1479, 1484 | no — dies with the element |
| `controls` start/end (`setupInteractionDim`) | 871, 875 | no — dies with `controls.dispose()` |

The two `document`-level listeners hold a reference to the whole `EarthScene`, including its
scene graph, after disposal.

**Impact.** `main.ts` creates one instance, so this is mostly latent — but `dispose()` **is**
reachable in production via the `loadEarth()` failure path (line 214), and any
HMR/SPA/test harness doing `dispose(); new EarthScene(...)` accumulates duplicates.

**Fix.** Create one `AbortController` in the constructor, pass `{ signal: this.ac.signal }`
to every `addEventListener` in the class, and call `this.ac.abort()` at the top of
`dispose()`. That covers all of the above in one line and cannot drift out of sync as
listeners are added.

**Verify.** `__earth.dispose()`, then press Escape and toggle fullscreen — no handler should
run. In DevTools, the detached `EarthScene` should be collectable.

---

### L1 — FPS guard misfires after the tab is backgrounded
**Severity:** LOW · `src/earth/EarthScene.ts:1966`, `:1973`

**Defect.** `clock.getDelta()` returns the full elapsed wall-clock time on the first frame
after a hidden tab resumes — potentially minutes. `fpsGuard.acc += dt` then drags the
computed `fps = frames / acc` far below the 28 fps threshold, triggering an unjustified
permanent tier downgrade. The cooldown only guards *after* a downgrade, not before the
first.

The same unclamped `dt` also jumps `moonAngle` (lines 2033, 2035) and the Auto-Sun sweep
(line 2022) by a large step on resume.

**Fix.** Clamp once, at the top of `animate()`:

```ts
// A backgrounded tab returns a dt of seconds-to-minutes. Clamp it: the FPS
// guard would read it as a stall and downgrade, and the Moon orbit / Auto-Sun
// sweep would jump a visible step.
const dt = Math.min(this.clock.getDelta(), 0.25);
```

**Verify.** Background the tab for a minute, return, and confirm no
`[quality] auto: … stepping down` line appears and the Moon does not jump.

---

### L2 — Auto-rotation speed is frame-rate dependent
**Severity:** LOW · `src/earth/EarthScene.ts:1999-2004`

**Defect.** `earthMesh.rotation.y += 0.0001` per *frame*. At 144 Hz the globe spins 2.4×
faster than at 60 Hz; the cloud layer (`+= 0.00015`) drifts likewise.

**Fix.** Scale by `dt`, preserving the current 60 Hz appearance:

```ts
if (this.earthMesh) this.earthMesh.rotation.y += 0.0001 * dt * 60;
if (this.cloudMesh) this.cloudMesh.rotation.y += 0.00015 * dt * 60;
```

**Verify.** Rotation rate matches on a 60 Hz and a 120/144 Hz display.

---

### L3 — Stale comment: "there is no post-processing in this app"
**Severity:** LOW · `src/earth/EarthScene.ts:1841-1845`

**Defect.** The comment above `setupDebugPanel` reads:

> *"There is no post-processing in this app (no composer — final output is each shader's
> tone-mapping/color-space includes + the renderer's tone-mapping settings), so there is
> nothing extra to disable here."*

Untrue since the Sun/bloom work landed: `createComposer()` runs unconditionally in `init()`
(line 208) and `animate()` renders only through it (line 2061).

**Impact.** It documents an invariant that no longer holds, and it hides a real limitation:
because bloom is never disabled, the debug panel's "White sphere" and "Sun ramp" validation
views are still tone-mapped and bloomed by `OutputPass` — so they do not isolate the surface
shading as cleanly as the comment implies.

**Fix.** Rewrite to state that a composer *is* active, and either add a debug toggle that
bypasses bloom or note the caveat explicitly.

---

### L4 — Sun shader omits the tone-mapping / color-space includes
**Severity:** LOW · `src/sun/shaders/sun.ts:58`

**Defect.** Every other scene shader — `earth`, `cloud`, `atmosphere`, `starfield`, `moon` —
ends with `#include <tonemapping_fragment>` + `#include <colorspace_fragment>`. The Sun
writes `gl_FragColor` raw.

**Impact.** None today: both chunks compile to no-ops when rendering into the composer's
render target, so output is identical. It is a latent inconsistency that diverges the moment
anything renders to the default framebuffer.

**Fix.** Add both includes after the `gl_FragColor` assignment, for parity with the other
five shaders.

---

### L5 — Star-field material leaked on every tier switch
**Severity:** LOW · `src/earth/EarthScene.ts:1094-1095`

**Defect.** `createStarField()` always builds a fresh `ShaderMaterial`; the caller
immediately discards it with `fresh.material = material` (reusing the previous one) and never
disposes it.

**Impact.** `renderer.info.programs` stayed flat at 13 across four tier switches — three
dedupes shader programs by source, so the GPU cost is nil. This is a leaked JS material
object per switch, not a GPU leak. Same class of oversight as H2.

**Fix.** Give `createStarField` an optional material parameter, or call
`fresh.material.dispose()` before reassigning.

---

### L6 — Pending debug URL flags are never cleared
**Severity:** LOW · `src/earth/EarthScene.ts:240-243`, `:589-595`

**Defect.** `pendingDebugMode`, `pendingSunRay`, `pendingFrontlight` and `pendingSoftfill`
are applied at the end of `loadEarth()` but never reset, so the instance keeps reporting
state that has already been consumed.

**Impact.** Cosmetic; misleading when inspecting `window.__earth`.

**Fix.** Reset each to its default immediately after application.

---

### N1 — Informational: dead or redundant code
- `createRenderer()` line 303: `antialias: true` has no effect — the scene always renders
  through `EffectComposer` into a render target, where only the RT's `samples` (per-tier
  `msaaSamples`) apply. Remove it, or comment it so no reader believes canvas MSAA is live.
- `applyQualityLevers` lines 1060–1063 resize a composer that may be discarded three lines
  later.
- `fpsGuard.appliedDowngrade` (lines 153, 1993) is written and never read.
- `loadTextureKey` pushes into `this.textures` at line 436 and `loadEarth` pushes the same
  day/night textures again at line 460 — `Texture.dispose()` is idempotent so this is benign,
  but push in one place only.
- `updateMoonLabel` (line 1547) writes `el.style.display = 'none'` every frame while hidden.

### N2 — Informational: shader portability
`shaders/earth.ts:72` (`smoothstep(0.28, 0.04, lum)`) and `shaders/starfield.ts:20`
(`smoothstep(0.5, 0.0, dist)`) both pass `edge0 > edge1`, which the GLSL ES spec leaves
undefined. Every shipping driver handles it as the expected inversion. Rewrite as
`1.0 - smoothstep(edge1, edge0, x)` if strict conformance matters.

### N3 — Informational: project hygiene
- `three@^0.186.0` vs `@types/three@^0.185.4` — minors drift; align them or document the
  tolerated skew. No `engines` field.
- No `<noscript>`: with JS disabled the page is a black screen with a stuck progress bar.
- `vite.config.ts` `build.target: 'esnext'` vs `tsconfig` `target: ES2020` — harmless for a
  self-hosted site.
- No automated tests beyond `scripts/lighting_math_test.mjs`. `Quality.ts`, `SunLighting.ts`
  and `sceneScale.ts` are pure and trivially testable (tier detection, `wrapAzimuth`,
  az/el ↔ vector round-trips); Vitest fits the existing Node 22 toolchain in ~30 lines. Such
  tests would have caught H1.
- `setupInteractionDim`'s comment (lines 866–868) says the primary bar is "intentionally left
  alone", but `index.html:172` dims `.primary-bar` with the rest of the chrome.
- `EarthScene.ts` is 2119 lines and is the main structural risk. The direction already
  recorded in `PROJECT_MAP.md` — extract `Moon` / `Sun` / `Earth` object classes and a
  `UIController` for the ~600 lines of sheet / Sun-panel / debug-panel wiring — is the right
  next step, and would fix M4 structurally rather than by discipline.

---

## 3. Do not action

These were raised by the first-pass review and are **wrong**. They are recorded here so they
are not re-opened, and so nobody executes them: each would remove working behavior or replace
accurate documentation.

### ✗ "The Auto-Sun branch is dead code; the button is a silent no-op"
**Invalidated — verified working.** The claim was that `state.autoSun && state.fullDaylight`
is unreachable, so the `else if` at line 2019 never runs. That inverts the condition: the
branch requires `!fullDaylight && autoSun`, which is exactly what `setAutoSun(true)`
produces — it turns Full Daylight *off* (line 1700), then sets `autoSun = true`. Live test:
clicking `[data-action="auto-sun"]` set `state.autoSun === true` and swept `sun.azimuth`
from 150° to 165.1° over 1.5 s. **Do not delete the Auto-Sun feature or the sweep branch.**

### ✗ "The tone-mapping comment at lines 738–743 is incorrect"
**Invalidated — the comment is accurate.** Lines 734–743 already state the exact mechanism
the finding proposed as its correction: *"three only enables TONE_MAPPING when rendering to
the screen, so the OPAQUE layers' … includes are no-ops there."* That matches
`node_modules/three/src/renderers/webgl/WebGLPrograms.js:176-186` verbatim. The finding
quoted one clause out of context; that clause is a statement about *blend order*
(transparent layers blend before the single tone-map), and it is also true. **No change
needed.** The genuinely stale comment is at lines 1841–1845 — tracked as **L3**.

### ✗ "Moon tidal-lock quaternion is degenerate at `moonAngle ≈ π`"
**Corrected — wrong location, and a non-issue.** `_moonDir` points *toward Earth*
(`-normalize(moonPos)`), so at `moonAngle = π` the Moon is at −X and `_moonDir = +X`,
**parallel** to `_plusX` — the well-behaved case. The anti-parallel case is `moonAngle ≈ 0`
(Moon at +X). Further, `Quaternion.setFromUnitVectors` has a deterministic anti-parallel
fallback rather than an arbitrary axis, and across the crossing the returned quaternion flips
to its antipode — the same rotation — so orientation is continuous and no face-flip occurs.
Only an exactly-`0.0` angle (measure-zero in floating point) would produce a ~5.1° one-frame
roll pop. **Won't fix.**

### ✗ "`?quality=` does not update the Quality UI highlight"
**Symptom described backwards.** The UI highlight is correct — `syncQualityUI()` compares
against `qualitySetting`, which the URL param has already set. The **scene** is what is
wrong. Re-diagnosed and promoted to **H1**; fix that instead.

---

## 4. Confirmed strengths — preserve through any refactor

1. Single-source-of-truth config split (`config/sceneScale.ts`, `config/camera.ts`,
   `config/mobile.ts`), used consistently everywhere.
2. The shared `SunLightingState.direction` Vector3 referenced by all three `uSunDirection`
   uniforms — verified all three consumers (earth 485, cloud 511, atmosphere 560) hold the
   same instance, while the Moon correctly uses a separate per-frame point-source direction
   (`moonSunDir`, line 2048). This is what makes lunar phases geometrically correct.
3. No allocations in the hot loop — scratch `_v`, `_moonDir`, `_moonQuat`, `_sunTmp` reused.
4. Asset fallback chains + 1×1 `DataTexture` placeholders for clouds and Moon: first paint
   never blocks on the largest assets and never fails.
5. `qualityEpoch` staleness guard for in-flight texture swaps (line 1139).
6. Composer sizing: normalising `_width`/`_height` to logical pixels after construction
   (line 775) is subtle and correct — without it the bloom's 11 blur targets allocate 2× too
   large.
7. **Security.** No `innerHTML` / `eval` / `new Function`; all dynamic DOM is `textContent`
   or static attribute writes. URL params are enum-checked or `Number.isFinite`-parsed and
   clamped to `[-180,180]` / `[-90,90]`. `localStorage` is try/catch-wrapped for private
   mode. `window.__earth` is an intentional, documented debug hook. Docker: correct
   multi-stage build, healthcheck present, `.dockerignore` keeps `node_modules`/`dist` out of
   the context. Consider adding `Content-Security-Policy` and `X-Content-Type-Options:
   nosniff` to an nginx `server { }` block for hygiene — low risk either way for a
   static-only app.

---

## 5. Suggested sequencing

1. **H1** and **H2** — small, independent, both silent today. Land together.
2. **M2** (which resolves **M1**) and **M3** — user-visible, low-risk.
3. **L1** and **L2** — one-line correctness fixes in `animate()`.
4. **M4** — best done as part of the `UIController` extraction in `PROJECT_MAP.md`, not
   before it.
5. **L3–L6, N1–N3** — opportunistic.

Add the Vitest suite from **N3** alongside H1: a round-trip test over `resolveProfile` /
`detectAutoTier` would have caught it, and it is the regression most likely to recur.

---

*Validated second pass. 15 prior findings reviewed — 11 confirmed, 2 invalidated, 1
corrected, 1 re-diagnosed. 10 new findings added. Merged total: 2 high, 4 medium, 6 low,
3 info. No security vulnerabilities.*
