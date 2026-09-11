# Code Review — Web-Earth (verification pass)

**Scope:** audit of commit `e38aad4` ("Address code review findings") against the original
review, plus the two fixes that audit produced.
**Branch:** `fix/code-review-findings`
**Date:** 2026-09-11
**Typecheck:** `npx tsc --noEmit` passes clean.
**Runtime:** verified in a browser against `npm run dev` — no shader compile errors.

## Summary

The original review raised 8 numbered findings plus 10 smaller items. **16 of 18 were correctly
fixed** by `e38aad4`. Two were deliberately deferred (both performance-only). The commit also
introduced **one user-visible regression** and left **one internal inconsistency created by its
own fix** — both are now fixed on top, in the working tree.

The two fixes are small: `&deg;` moved back outside the Sun-readout spans, and the shader debug
branches converted from early `return`s to an `if / else if / else` chain. The `EarthScene.ts`
diff looks large (≈104 lines) but `git diff -w` shows the substantive change is 19 lines — the
rest is the re-indent of the production block into the new `else`.

---

## Verified fixed

| # | Finding | Evidence |
|---|---|---|
| 1 | `toneMapping` / `toneMappingExposure` dead | `#include <tonemapping_fragment>` / `<colorspace_fragment>` appended to all four fragment shaders. Confirmed these actually compile for a non-raw `ShaderMaterial`: three r186 emits `tonemapping_pars_fragment`, the `toneMapping()` function, `colorspace_pars_fragment` and `linearToOutputTexel` into `prefixFragment` in the **non-raw** branch (`three.module.js:6833` block, injections at `:6933-6941`). Confirmed again at runtime — no `THREE.WebGLProgram: Shader Error`. |
| 2 | Cloud white-sphere branch unreachable | Reordered to `2.5 → 1.5 → 0.5`, matching the earth shader. `?mode=3` renders the white sphere. |
| 3 | URL params desync the toggle buttons | New `syncUIButtons()`, called at the end of `setupUI()` (after `applyURLParams`) and from both debug-panel toggles. Verified: `?clouds=0&atmosphere=0&rotate=0` leaves all three buttons reading *off*, and clicking Clouds turns them *on* with `active` set — no longer inverted. |
| 4 | `dispose()` leaks | Textures tracked in `this.textures` and disposed; `controls.dispose()` added; `traverse` now covers `THREE.Line` (the sun-ray `ArrowHelper`); `interactionTimeout` cleared. |
| 5 | `resetView()` framerate-dependent / re-entrant | Now `performance.now()`-driven over a fixed 600 ms, single `resetAnimId` handle, cancelled by the OrbitControls `start` listener. |
| 6 | Per-frame DOM work | Refs cached in `this.sunUI`; writes guarded by `lastAzShown` / `lastElShown` / `lastKnobTransform`. Both `setDirection(...clone())` allocations removed. |
| 8 | `earth-topology.png` shipped unused | Deleted from `public/assets/earth/`. |
| — | Error path destroyed the app | `dispose()` runs before an appended overlay `<div>`; no more `body.innerHTML` clobber. |
| — | `dragging = true` before the guard | Assignment moved below the `fullDaylight` guard. |
| — | Dead state / unused varying | `this.debugMode`, `state.softDaylight` and `vNormal` all removed. |
| — | Duplicated Sun constants | Removed from `index.html`; the panel is populated from the TS constants on startup. |
| — | `updateSunUI()` called twice | One call removed; the initialising call survives at `EarthScene.ts:973`. |
| — | `?sun=az,el` not range-checked | Clamped via `THREE.MathUtils.clamp` to ±180 / ±90. |
| — | Pinch-zoom blocked | `maximum-scale` / `user-scalable=no` dropped from the viewport meta. |
| — | Implicit transparent draw order | Explicit `renderOrder` 0/0/1/2 on earth, stars, clouds, atmosphere. |

### One false alarm, recorded so it isn't re-raised

Swapping `setDirection(this._sunTmp.clone())` for `setDirection(this.sun.direction)` in
`updateFullDaylightSun` **is safe**, despite `azimuth`/`elevation` being assigned directly rather
than through `set()`. `this.sun.direction` is copied from `_sunTmp` four lines earlier
(`EarthScene.ts:805`), so it is not stale.

The commit's comment justifying the change was wrong, though — it claimed "setDirection copies
the vector into its geometry". `ArrowHelper.setDirection` derives a quaternion and retains no
reference to the vector. Dropping the `clone()` is correct; the stated reason was not. Comment
corrected.

---

## Problems found in the commit — now fixed

### A. The degree symbol disappeared from the Sun readout (regression)

De-duplicating the hardcoded `150` / `18` moved `&deg;` *inside* the span:

```html
<!-- as committed in e38aad4 -->
<div>Azimuth&nbsp; <b><span id="sun-az-val">&deg;</span></b></div>
```

`updateSunUI()` writes `ui.azVal.textContent = String(az)`, which replaces the span's entire
contents — so the `°` was destroyed on the very first update and the panel read `150` / `18`
with no unit, permanently. Before the commit the `&deg;` sat outside the span and survived.

**Fixed** in `index.html:368-369` — span left empty, `&deg;` back outside it. The intent of the
original change (no hardcoded values) is preserved.

Verified: reads `150°` / `18°` on load, and still `0°` after clicking the Sunset preset.

### B. Debug modes bypassed tone mapping (inconsistency created by fix #1)

In both the earth and cloud shaders, every `uDebugMode` branch ended in `return;` — placed
*before* the two new includes at the end of `main()`. The production path was therefore
ACES-tone-mapped and sRGB-encoded while the validation views stayed raw linear.

This partly defeated finding #2's purpose: the white-sphere harness exists to be compared against
the real render, and it was left in a different color space than the thing it validates.

**Fixed** — both shaders restructured to a single exit (`if / else if / else`, no early returns),
with the includes after the chain. Branch ordering stays identical in the two shaders
(`2.5 → 1.5 → 0.5`), which was the point of #2.

Verified: `?mode=1`, `?mode=2` and `?mode=3` all render, with no shader compile errors.

---

## Still open

### 7. 5 MB cloud PNG — not addressed

`public/assets/earth/earth-clouds.png` is still 5,033,486 bytes and still blocks first paint via
`Promise.all`. Only `.a` is ever sampled, yet full RGB is shipped. Deferred by decision, not an
oversight.

### 1 (follow-up). Shader constants were never re-tuned

The original review warned that fixing the tone-mapping gap would visibly change the image and
that the tuned constants were compensating for the missing encode. ACES + exposure 1.1 + sRGB
encode are now live, but `uNightIntensity: 2.5` (`EarthScene.ts:541`), the
`0.85 + 0.15 * sunFacing` day shade (`EarthScene.ts:93`) and the specular weights are unchanged.
The render is plausible as it stands, but it is not the tuning anyone signed off on. Deferred by
decision.

### Housekeeping

The `e38aad4` commit message body is corrupted: a repeated `- Clamp ?sun=az,el to` fragment, a
`-----rd-----rd` run, and a stray `EOF` line. It has already merged to `main` via PR #1, so it is
now permanent short of a history rewrite — recorded here rather than as an action item. Worth a
glance at whatever produced it, since the garbling looks like a truncated heredoc rather than
anything the author typed.

---

## Not an issue

- No security concerns found.
- The absolute `/assets/...` paths are correct for the nginx-at-root deployment in the
  `Dockerfile` — they would only break under a sub-path.
- The cloud-shadow UV sign convention is correct (verified against `SphereGeometry`'s φ mapping
  and Y-rotation direction).
- Cloud shell radius (1.01) clears the earth mesh's facet dip at its tessellation — no z-fighting.
- `onMove` / `setFromPointer` still lack their own `fullDaylight` guard, but `dragging` can no
  longer be set in Full Daylight, so the path is unreachable. Only enabling Full Daylight
  *mid-drag* could still fight — narrow enough to leave.
