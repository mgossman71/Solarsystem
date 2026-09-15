# Code Review — `wideView` branch

**Date:** 2026-09-15
**Scope:** `git diff main...HEAD` — commits `8befa6b` (real orbital planes, top-down System view, orbit rings) and `f0483b8` (clickable planet name labels). Files: `index.html`, `src/config/camera.ts`, `src/config/sceneScale.ts`, `src/core/types.ts`, `src/earth/EarthScene.ts`, `src/earth/StarField.ts`, `src/planets/OrbitRings.ts`, `src/planets/PlanetSystem.ts`, `src/planets/orbital.ts`, `src/planets/registry.ts`, `src/__tests__/pure-logic.test.ts`.
**Working tree:** clean (no uncommitted changes).

The `orbitPosition()` helper itself is correct: the rotation is a rigid rotation about +Y, it reduces to the legacy `(r·cos a, 0, −r·sin a)` convention at zero inclination/node, and `PlanetSystem` + `OrbitRings` share it, so each planet does sit on its own ring. The findings below are elsewhere.

---

## High

### 1. `?focus=earth` is now silently ignored — the camera stays in the System view
`src/earth/EarthScene.ts:732`

`applyURLParams()` changed its deferral guard from `if (focusParam !== 'earth')` to `if (focusParam !== 'system')`, so `?focus=earth` now sets `pendingFocus = 'earth'`. But the consumer in `loadEarth()` was not updated and still reads:

```ts
if (this.pendingFocus) {
  const f = this.pendingFocus;
  this.pendingFocus = null;
  if (f !== 'earth') this.setFocus(f);   // <-- 'earth' is dropped on the floor
}
```

That `f !== 'earth'` test was only correct while `'earth'` was the default focus (applying it would have been a no-op). Now it is the one focus value that can be requested and then thrown away. Concrete scenario: load `?focus=earth` — the URL is accepted by the validator, `pendingFocus` is set, load completes, `setFocus` is never called, and the app sits in the top-down System overview instead of on Earth. The guard should be `if (f !== 'system')` (or simply always `setFocus(f)`, which `isFocusReady()` already protects).

---

## Medium

### 2. Earth never lies on the Earth orbit ring the PR draws for it
`src/planets/OrbitRings.ts:62`

`ring(EARTH_ORBIT_RADIUS, 0, 0)` draws Earth's guide circle as a flat radius-600 loop in the `y = 0` ecliptic. But Earth's position is not computed from an orbit angle at all — `EarthScene` derives it from the Sun-direction state:

```ts
earthPos = sun.direction * -EARTH_ORBIT_RADIUS
```

with `INITIAL_SUN_ELEVATION = 18°`. So at startup `earthPos.y ≈ ∓185` and its top-down projected radius is `600·cos 18° ≈ 571`, not 600. In the default System view the Earth dot and its new "Earth" label visibly sit ~29 units *inside* their own ring (~5% of the radius), and dragging the Sun-elevation slider walks Earth anywhere from the ring plane to directly over the Sun (elevation ±90° → projected radius 0) while the ring stays put. Either drive the Earth ring from the live `earthPos` (e.g. radius `hypot(x, z)`, or draw it as a full circle of `|earthPos|` tilted to match) or omit it.

### 3. Planet labels paint over the Explore / Sun panels and swallow their clicks
`index.html:44`

`#planet-labels` is `position: fixed; inset: 0; z-index: 15` and each `.planet-label` re-enables `pointer-events: auto`. The Explore focus panel (`index.html:522`, `z-index: 12`, top-left) and the Sun panel (`index.html:275`, `z-index: 12`, right-centre, 232 px wide) are both *below* 15 and both visible in the default System view. Concrete scenario: in the System overview a planet whose projected position falls over the Sun panel or the Explore panel gets a label pill drawn on top of the panel; clicking that spot hits the label (`data-focus`) and flies to the planet instead of activating the panel control underneath. Give the label layer a `z-index` below 12, or hide labels that intersect the panels.

### 4. `?scale=real` starts with a System view framed for the Exploration radii
`src/earth/EarthScene.ts:317`

`createCamera()` (constructor) computes the initial straight-down distance via `systemFrameDistance()`, which reads `this.scaleMode` — still `'explore'`, because `applyURLParams()` runs later, in `init()`. With `?scale=real` the outermost orbit becomes Pluto at 3100 instead of 2300, requiring ~8000 units of standoff, but the camera is parked at the explore fit distance (~6100 on a 16:9 desktop). Result: the outer orbit rings (Neptune 2750, Pluto 3100) are cropped off-screen on first paint, and `reframeIfOutOfFrame()` only runs on an orientation change, so nothing corrects it. Re-frame after `applyURLParams()` (or resolve the scale mode before building the camera).

### 5. Stars near the top-down camera render as oversized blobs
`src/earth/StarField.ts:12`

`STAR_POINT_SCALE = 600 * (STAR_SHELL_MEAN / 275)` is now ≈ 27 270, calibrated so a star at the shell mean (12 500) keeps its intended pixel size — `gl_PointSize = aSize * (uScale / depth)`. That calibration assumes the camera is near the origin. The new default view puts the camera 6100–10 000 units up, so stars on the near side of the shell are only 2000–6000 units away and render 2–6× their intended size (`aSize = 2.0` goes from ~4 px to ~27 px at the 10 000 zoom-out ceiling). Concrete scenario: zoom out in the System view and a ring of fat additive blobs appears around the frame edge instead of a uniform star field. Scaling `uScale` by the *camera* distance to each star's shell (or clamping `gl_PointSize`) would fix it.

---

## Low

### 6. The Explore panel shows "Earth" as the active focus on startup
`index.html:637`, `index.html:751`

The default focus changed from `'earth'` to `'system'`, but both Earth buttons still ship `class="ui-btn active" aria-pressed="true"` in the markup, and `syncFocusUI()` is never called during `init()` (only from `setFocus()`). So on first paint the app is in the System overview while the UI — and the accessibility tree — claims Earth is selected. There is also no `data-focus="system"` control, so once the user leaves the System view the only way back is Reset, and `syncFocusUI()` then leaves every Explore button inactive.

### 7. `dispose()` leaves the label pills in the DOM
`src/earth/EarthScene.ts:219`

The field doc says the pills are "removed from the DOM in `dispose()`", but `dispose()` only nulls `orbitRings`; `planetLabelEls` is neither emptied nor detached. Concrete scenario: `loadEarth()` rejects → `dispose()` → fatal overlay, and the (already-visible) Earth label pill stays in `#planet-labels` frozen at its last position, with the array still holding element references. Any future re-instantiation of `EarthScene` against the same document would also append a second full set of pills.

### 8. `group.renderOrder = 1` on the ring group has no effect
`src/planets/OrbitRings.ts:42`

Three.js does not inherit `renderOrder` from parents — the renderer sorts by each *rendered object's* own `renderOrder`, and the `LineLoop` children keep the default `0`. So the comment's claim ("after the star field (0), before clouds/atmosphere") is not what happens; the rings are ordered purely by the transparent-pass distance sort. It works today only because the rings happen to be nearer than the star shell. Set `renderOrder` on each line instead.

### 9. Labels lag the camera by one frame
`src/earth/EarthScene.ts:2635`

`updatePlanetLabels()` runs *before* `this.controls.update()` and before `render()`, and `Vector3.project()` uses `camera.matrixWorldInverse`, which is only refreshed inside `renderer.render()`. So every projection is computed against the previous frame's camera matrix. Concrete scenario: drag or zoom in the System view and the pills visibly trail their dots until motion stops. Moving the call after `controls.update()` fixes it.

### 10. Stale / contradictory comments
- `src/config/camera.ts:13` — the two lines left over from the old value ("a Pluto focus sees the far side of the shell at ~6550, so 7000 leaves headroom") now contradict `CAMERA_FAR = 25000` directly above them.
- `src/config/camera.ts:32` — `SYSTEM_VIEW_MAX_DISTANCE`'s comment still cites the star shell as "3300–3450"; the same commit moved it to 12 000–13 000.
- `src/planets/OrbitRings.ts:9` — "drawn in the ecliptic (XZ) plane — the same plane the planets orbit in" is exactly what the change stops doing; the rings are now inclined per planet.
- `src/earth/EarthScene.ts:1960` — "tapping a dot still selects the planet through the enlarged hit proxies" does not hold in the System view: the proxies are `max(0.8, r·1.6)` units, which at ~6100 units of standoff is well under one pixel, so the labels are the only usable affordance there.
