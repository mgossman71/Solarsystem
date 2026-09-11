# Code Review — Web-Earth

**Scope:** `src/earth/EarthScene.ts` (1,091 lines), `src/earth/SunLighting.ts`, `src/main.ts`, `index.html`, build and Docker config.
**Date:** 2026-09-11
**Typecheck:** `npx tsc --noEmit` passes clean.

## Summary

The shading math is sound. I traced the cloud-shadow UV derivation against three.js's `SphereGeometry` φ convention and its Y-rotation direction, and the `fract(vUv.x - uCloudUVOffset)` sign is correct. The single-shared-`Vector3` Sun design is the right call, and the comments explaining it are unusually good.

Findings below are ordered worst-first. The two to fix first are **#1** (it silently changes how every tuned constant in the shaders should be read) and **#3** (users can actually hit it).

---

## Bugs

### 1. `renderer.toneMapping` and `toneMappingExposure` do nothing

`src/earth/EarthScene.ts:421-422`

Every material in this scene is a custom `ShaderMaterial`. In three.js, tone mapping and output color-space encoding are applied via the `<tonemapping_fragment>` / `<colorspace_fragment>` shader includes, which three only injects into its own built-in shaders — confirmed at `node_modules/three/build/three.module.js:497`. None of the four shaders here include them, so both lines are dead config.

The asymmetry is what matters. Texture *input* decoding **is** active: three picks `SRGB8_ALPHA8` as the internal format when `texture.colorSpace === SRGBColorSpace` (`three.module.js:11252`), so the GPU decodes to linear at sample time. The pipeline therefore samples linear, does linear math, then writes linear straight to an sRGB-expecting framebuffer with no encode.

Fix — append to each fragment shader:

```glsl
#include <tonemapping_fragment>
#include <colorspace_fragment>
```

This will visibly change the image. Tuned constants (`uNightIntensity: 2.5`, the `0.85 + 0.15 * sunFacing` day shade, the specular weights) will need re-tuning — they are currently compensating for the missing encode.

### 2. Cloud shader's white-sphere debug branch is unreachable

`src/earth/EarthScene.ts:159-172`

The earth shader orders its tests correctly (`2.5` → `1.5` → `0.5`, lines 59-69). The cloud shader orders them `1.5` → `0.5` → `2.5`, so `uDebugMode == 3` hits the sun-ramp branch and returns; the white-sphere branch at line 169 is dead.

It is masked today only because `applyDebugMode` hides `cloudMesh` in mode 3 — meaning the validation harness has a latent hole exactly where you would least want one. Reorder to match the earth shader.

### 3. URL params desync the toggle buttons

`src/earth/EarthScene.ts:389-392` vs `index.html:346-347`

`?clouds=0`, `?atmosphere=0` and `?rotate=0` mutate `this.state` but never touch the DOM, and the buttons are hardcoded `class="ui-btn active"`. Load `?clouds=0` and the Clouds button reads as on while clouds are off; the first click then turns clouds *on* while removing `active`. Inverted from then on.

`setupUI()` needs an initial sync pass from `this.state` to the buttons' `active` classes.

The `?debug` panel has the same class of problem in reverse: toggling Clouds there (line 960) never updates the main button.

### 4. `dispose()` leaks

`src/earth/EarthScene.ts:1074-1087`

- The three textures are never disposed — `material.dispose()` does not touch them, and these are large (5 MB cloud PNG).
- `this.controls.dispose()` is missing, so OrbitControls' window and element listeners stay attached.
- `traverse` only handles `Mesh` and `Points`; `sunRay` is an `ArrowHelper` containing a `Line`, whose geometry and material are skipped.
- `interactionTimeout` is not cleared.

### 5. `resetView()` is framerate-dependent and re-entrant

`src/earth/EarthScene.ts:658-677`

`t += 0.02` per frame means the transition takes 1 s at 50 fps and 0.42 s at 120 fps. Each click also starts an independent `requestAnimationFrame` chain with its own captured `startPos`, so double-clicking leaves two chains writing `camera.position` on alternating frames.

Drive it off `clock`/elapsed time and guard with a single stored animation handle. It also does not bail when the user grabs the mouse mid-transition.

---

## Performance

### 6. Per-frame DOM work in the render loop

`src/earth/EarthScene.ts:903-920`

In Auto Sun and Full Daylight modes, `updateSunUI()` runs every frame: five `getElementById` calls, four `String(Math.round(...))` allocations, two input-value writes (each invalidating layout) and a `style.transform` write.

Additionally, `this.sunRay.setDirection(this.sun.direction.clone())` allocates a `Vector3` per frame in both `updateSun` (line 705) and `updateFullDaylightSun` (line 729).

Cache the element references once in `setupSunUI`, skip the write when the rounded value has not changed, and reuse a scratch vector for `setDirection`.

### 7. 5 MB cloud PNG

`public/assets/earth/earth-clouds.png`

Dominates the payload and blocks first paint via `Promise.all`. Only `.a` is ever sampled, yet full RGB is shipped. A single-channel source, or WebP, would cut this by most of its size.

### 8. `earth-topology.png` (378 KB) is shipped but never referenced

Committed and present in `public/`, but absent from `src/` and `index.html`. `public/` is copied verbatim into `dist/`, so it is dead weight in every deploy.

---

## Smaller things

- **Error path destroys the app** — `EarthScene.ts:367`: `document.body.innerHTML = ...` wipes the canvas and UI, but `animate()` keeps running `requestAnimationFrame` against a detached canvas forever. Cancel the loop before replacing the DOM, and consider an overlay instead of clobbering `body`.
- **`dragging = true` before the guard** — `EarthScene.ts:851`: `onDown` sets `dragging` then returns early if `fullDaylight`, leaving it true without pointer capture; `onMove`/`setFromPointer` have no `fullDaylight` check either. Unreachable today because `.sun-panel.full-daylight .sun-manual` sets `pointer-events: none` (`index.html:255`) — but that is CSS carrying a correctness invariant. Move the assignment below the guard.
- **Dead state**: `this.debugMode` (line 351) and `this.state.softDaylight` (line 348) are only ever written, never read.
- **Unused varying**: `earthVertexShader` computes and writes `vNormal` (line 17) which the fragment shader never declares.
- **Duplicated constants**: `INITIAL_SUN_AZIMUTH`/`INITIAL_SUN_ELEVATION` (150/18) are hardcoded again in four places in `index.html` (lines 365, 366, 372, 376). They will drift.
- **`updateSunUI()` called twice** at the end of `setupSunUI` — lines 889 and 900.
- **`?sun=az,el` is not range-checked** — only `Number.isFinite`, so `?sun=0,500` yields a nonsense direction. Clamp to ±180/±90.
- **`maximum-scale=1.0, user-scalable=no`** (`index.html:5`) blocks pinch-zoom. The sun pad is also a `<div>` with pointer handlers only — no keyboard path, though the sliders do cover it.
- **Implicit transparent draw order**: `cloudMesh` and `atmosphereMesh` are both centered at the origin, so three's `reversePainterSortStable` (`three.module.js:8078`) ties on `z` and falls through to object id — i.e. insertion order. Deterministic, but accidentally so. Setting explicit `renderOrder` would make the intent survive a reordering of `loadEarth`.

---

## Not an issue

- No security concerns found.
- The absolute `/assets/...` paths are correct for the nginx-at-root deployment in the `Dockerfile` — they would only break under a sub-path.
- The cloud-shadow UV sign convention is correct (verified against `SphereGeometry`'s φ mapping and Y-rotation direction).
- Cloud shell radius (1.01) clears the earth mesh's facet dip at its tessellation — no z-fighting.
