# Code Review Results

Branch: `addSun` (commit `13fd958` — Add navigable textured Sun with bloom and point-source Moon lighting)
Date: 2026-09-11

Consolidated from two review passes. Ordered by severity.

---

## High

### 1. Full Daylight + Sun focus is a divergent feedback loop
`src/earth/EarthScene.ts:1538`

`updateFullDaylightSun()` sets `sun.direction = normalize(camera.position - controls.target)`, and `placeSun()` (animate, line 1917) then moves the Sun to `direction * 600`. When `focus === 'sun'`, `controls.target` is copied from `focusCenter()` = `sunWorldPos` every frame — so the target *is* the thing the direction is measured from.

Repro: click "Sun", then "Full Daylight". Each frame the Sun teleports ~600 units to a new position, the target chases it, OrbitControls clamps the camera, and the view whips around indefinitely. The same class of problem hits Auto Sun with Sun focus (the Sun sweeps at ~100 units/s while the camera stays put) and any pad/slider/preset Sun move while focused on the Sun.

**Fix:** derive the Full Daylight direction from a fixed reference (e.g. Earth's centre) rather than `controls.target`, or suppress the coupling while `focus === 'sun'`.

---

## Medium

### 2. Focus transitions to/from the Sun snap instead of animating
`src/earth/EarthScene.ts:1376`

`animateCameraTo()` applies `controls.minDistance`/`maxDistance` immediately, before the 900 ms lerp, and each `step()` calls `controls.update()`, which clamps the camera radius into that range.

Repro: focus Sun (camera ends ~617 units from Earth), then click "Earth" — `maxDistance` becomes 8 on frame 1, so `update()` yanks the camera to within 8 units of Earth instantly and the cinematic fly-back is destroyed. The reverse (Earth → Sun, `minDistance` 11 while the camera is ~2.5 from the lerping target) produces a visible jolt at the start. This was harmless before because all poses shared a similar distance scale; the Sun pose is ~100× larger.

**Fix:** lerp the distance clamps alongside the camera, or apply them only once the transition completes.

### 3. `dispose()` leaks bloom/output pass GPU resources
`src/earth/EarthScene.ts:1986`

`EffectComposer.dispose()` only frees its own two render targets and internal copy pass — it never calls `dispose()` on passes added via `addPass()`. `UnrealBloomPass` alone owns 11 `WebGLRenderTarget`s (bright + 5 horizontal + 5 vertical blur buffers) plus several materials and a full-screen quad; `OutputPass` owns its own material and quad. Neither is stored on `this` (the `bloom`/`outputPass` locals in `createComposer()` are discarded), so `dispose()` has no reference to free them.

Every `EarthScene` create/dispose cycle — the "Failed to load Earth" error path, or re-instantiation via the `window.__earth` test hook — leaks 11+ GPU render targets and their textures/programs, eventually exhausting the browser's WebGL context and texture budget.

**Fix:** store the passes on the instance and dispose them in `dispose()`.

### 4. Moving to the composer changed the blending space for every transparent layer
`src/earth/EarthScene.ts:1066`

Clouds (alpha), atmosphere (additive) and stars (additive) previously blended into an sRGB-encoded, already tone-mapped framebuffer. With `RenderPass` → HalfFloat target, their `tonemapping_fragment`/`colorspace_fragment` includes become no-ops and blending now happens in linear HDR, with ACES applied once at the end.

Consequence: additive star and atmosphere accumulation no longer matches the previous look (stars dim, atmosphere rim brightens). The claim that "Earth/Moon/clouds look exactly as before" does not hold.

**Fix:** re-tune the star/atmosphere intensities against the new pipeline, or confirm the shift is the intended look and update the commit's claim.

### 5. The 1.0 bloom threshold is not exclusive to the Sun
`src/earth/EarthScene.ts:1078`

With linear-HDR additive blending (see #4), the atmosphere rim added on top of the lit Earth limb, and the ocean specular highlight, can exceed 1.0 pre-tone-map.

Repro: sunset/day preset with the atmosphere on — the Earth's limb and the ocean glint bloom too, not just the Sun, which the inline comment explicitly assumes cannot happen.

**Fix:** raise the threshold, or isolate the Sun with a selective-bloom layer.

---

## Low

### 6. `composer.setPixelRatio()` is called before `setSize()` with a device-pixel width
`src/earth/EarthScene.ts:1870`

`EffectComposer` sets `_width = renderTarget.width` when a render target is supplied — i.e. `innerWidth * pixelRatio` (2560), not logical pixels. `setPixelRatio()` internally calls `setSize(_width, _height)`, resizing the targets to `2560 * 2 = 5120`. The following explicit `setSize(w, h)` corrects it before any render, so it is currently benign, but the composer's `_width`/`_height` are wrong from construction and any future path that resizes without that explicit call will allocate 4× the intended buffers.

**Fix:** call `setSize()` before `setPixelRatio()`, or drop the redundant `setPixelRatio()` call.

### 7. The `logdepthbuf` includes are dead code
`src/earth/EarthScene.ts:19` (renderer at `:673`)

`createRenderer()` does not pass `logarithmicDepthBuffer: true`, so `USE_LOGDEPTHBUF` is never defined and both `#include <logdepthbuf_pars_vertex>` and `#include <logdepthbuf_vertex>` compile to nothing. There are also no fragment-side counterparts in `earthFragmentShader`, and the cloud/atmosphere/moon/star/sun shaders have no includes at all — so if anyone enables the flag to deal with the new far plane (widened 1200 → 2400 for the Sun), depth output would be inconsistent across layers.

**Fix:** either enable the flag and add includes to every custom shader (vertex *and* fragment), or remove the dead includes.

### 8. The Sun's apparent size is ~2× the stated value
`src/earth/EarthScene.ts:446`

`2 * atan(5 / 600) = 0.955°`, not the 0.5° the comment claims in order to match the real Sun's 0.53°. The constant looks to have been derived from `atan()` without the factor of two; matching 0.53° at distance 600 needs `SUN_RADIUS ≈ 2.8`.

**Fix:** correct the constant or the comment, depending on which is intended.

### 9. Stale comment contradicts the new point-source Moon lighting
`src/earth/EarthScene.ts:292`

The header comment (lines 292–295) still states the Moon "shares the SAME Sun direction uniform as Earth … so lunar phase geometry is exactly consistent with the Earth lighting." The code now wires the Moon's `uSunDirection` to `this.moonSunDir` (line 1241), a distinct per-frame vector computed via `sunDirectionToward(sunWorldPos, moonPosition, …)`.

**Fix:** update the comment to describe the point-source derivation.

### 10. `channel_avg` divides by the wrong sample count
`scripts/verify_sun_texture.py:61`

The loops iterate `range(0, w, cstep)` × `range(0, h, cstep)`, yielding `ceil(w/cstep) * ceil(h/cstep)` samples, but `n = (w // cstep) * (h // cstep)` floors. For any image whose dimensions are not exact multiples of `cstep`, the averages come out inflated — which can flip the `nr > 200` gate and pass a texture it should reject.

Also minor: a corrupt JPEG makes `Image.open`/`load` raise an unhandled traceback instead of printing a FAIL.

### 11. Duplicated Sun world-position math
`src/earth/EarthScene.ts:1027`

`sunWorldPositionFromAzEl(az, el, distance, out)` was added to `SunLighting.ts` and imported here, but `placeSun()` instead computes `this.sunWorldPos.copy(this.sun.direction).multiplyScalar(SUN_DISTANCE)` inline. Functionally equivalent, but two copies of the same math must be kept in sync by hand. `sunDirectionFromAzEl` and `sunWorldPositionFromAzEl` are both unused imports in this file.

**Fix:** call the helper, or drop the unused imports.

### 12. Unreachable direct-render fallback in `animate()`
`src/earth/EarthScene.ts:1946`

`createComposer()` is called unconditionally in `init()`, so `this.composer` is always truthy and the `else { this.renderer.render(…) }` branch can never execute. It reads as a supported no-post-processing path but is untested dead code.

**Fix:** remove the branch, or make composer creation genuinely conditional (e.g. a fallback when post-processing is unsupported).
