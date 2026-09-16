# Code Review — RoamController / free-roam camera

**Date:** 2026-09-15
**Branch:** `codeReview-PerfReview`
**Reviewed range:** `HEAD~1..HEAD` (PR #4, "replace OrbitControls with free-fly RoamController")

> Scope note: `codeReview-PerfReview` has no commits relative to `main`, and the only
> working-tree change was emptying this file. The most recent substantive change was
> reviewed instead. `tsc --noEmit` and `eslint` both pass clean.

Findings, most severe first.

---

## 1. Shift boost is dead code
`src/earth/RoamController.ts:261`

`MOVE_KEYS = new Set(['w','a','s','d','q','e'])` gates `onKeyDown`, so `'shift'` is never
inserted into `this.keys`. `this.keys.has('shift')` at line 261 is therefore always false
and `ROAM.boost` (3.5) never applies — while README, `docs/camera.md` and the `ROAM` doc
block all advertise "Shift = boost".

**Repro:** hold Shift+W anywhere — travel speed is identical to plain W.

**Fix:** track Shift separately (e.g. read `e.shiftKey` on the move keys, or add `'shift'`
to the accepted key set).

---

## 2. Pitch accumulates unclamped, creating a look dead-zone
`src/earth/RoamController.ts:245`

`this.pitch -= look.y * lookSpeed` is never clamped; only a local copy is clamped inside
`applyOrientation` (line 192).

**Repro:** drag down continuously past the pole for ~1 s — `this.pitch` runs to roughly
−3.0 rad while the camera stays pinned at −1.55. Dragging back up then does nothing
visible until the user "unwinds" ~1.5 rad (~450 px of drag); the camera appears frozen.

**Fix:** clamp `this.pitch` itself at the assignment.

---

## 3. Input accumulated during a fly-to is replayed in one burst
`src/earth/RoamController.ts:238`

`if (this.flying) return;` sits above the step-7 accumulator reset (lines 311–313), so
`dolly` / `look` / `touchMove` keep summing while `flying` is true. `beginFly()` only
clears them at the *start*. Input during the fly usually cannot cancel it either:
`markInput()` only dispatches `'start'` (the listener that calls `endFly()`) when
`interacting` is false, and continuous input keeps refreshing `lastInput`, so `'end'`
never fires and `interacting` never drops.

**Repro:** tap a planet, then keep pinching/dragging through the 900 ms fly — nothing
moves, then on the first frame after `endFly()` the whole accumulated dolly applies at
once, jumping the camera thousands of units (possibly straight into the `maxRange` clamp).

**Fix:** reset the accumulators before the `flying` early-return.

---

## 4. Planet-moon hit proxies are always visible and steal clicks from their planet
`src/earth/EarthScene.ts:2224`

The `here` guard was removed, so every moon's pick sphere is raycast at every zoom level.
In Explore mode Pluto's proxy radius is `planetRadius*1.3 = 1188/6371*1.3 ≈ 0.24`, while
Charon/Styx/Nix/Kerberos/Hydra each get `max(0.8, r*1.6) = 0.8` at `exploreOrbit`
0.55–1.25 — five spheres that completely enclose Pluto.

**Repro:** click Pluto's dot (or Mars, whose 0.69 proxy loses to a near-side Phobos sphere
spanning 0.8–2.4) and `hits[0]` is the moon; the camera flies to a moon the user never
aimed at. Previously these proxies were hidden unless already inside that planet's system.

**Fix:** prefer the planet on ties/containment, or restore a distance/zoom guard for moon
proxies.

---

## 5. No blur/visibility handler and no modifier filter — keys stick on
`src/earth/RoamController.ts:160`

`onKeyUp` is the only path that clears `this.keys`. On macOS, keyup is not delivered for a
plain key while Cmd is held, and no keyup arrives at all if the window loses focus
mid-press.

**Repro:** press Cmd+S, or Alt-Tab while holding W — `'s'`/`'w'` stays in the set and the
camera flies backward/forward indefinitely with no input. Because `update()` requires
`this.keys.size === 0` to emit `'end'` (line 235), `isInteracting` stays true forever, so
the UI dim never restores and auto-rotate/reframe never resume.

**Fix:** reset on `blur`/`visibilitychange`, and ignore events carrying
`metaKey`/`ctrlKey`/`altKey`.

---

## 6. Sun soft collider is far smaller than the old zoom clamp — camera enters the corona
`src/earth/EarthScene.ts:498`

The collider stops the camera at `SUN_RADIUS*1.04 + 0.02 ≈ 2.93`, but the Sun pose's old
`minDistance` was `SUN_RADIUS*2.2 = 6.16`, and `SYSTEM_VIEW_MIN_DISTANCE`'s own comment
puts the corona halo at ~7.7.

**Repro:** focus the Sun and keep scrolling in — the camera parks inside the corona sprite
and the bloom pass white-outs the frame. No clamp remains to prevent it.

Same class of gap one line below: Earth's collider uses `radius: 1` while the atmosphere
shell renders at 1.08, so the camera can sit inside the shell.

---

## 7. `applyOrientation()` runs unconditionally, so the "straight-down" System view never is
`src/earth/RoamController.ts:192`

The reset/system pose is `(0, dist, 0)` looking at the origin (`EarthScene.ts:1594`), i.e.
pitch = −π/2, which `maxPitch` (`π/2 − 0.02`) rewrites on the very next frame — including
when there was no input at all.

**Repro:** press Reset; the fly-to lands exactly top-down, then the next frame tilts 1.15°,
sliding the view centre ~122 world units off the Sun at a 6100-unit standoff. The user can
never return to a true top-down view.

**Fix:** only apply orientation when input changed it (see also perf finding P1).

---

## 8. Stale two-finger centroid on a 3→2 finger transition causes a camera lurch
`src/earth/RoamController.ts:147`

With three pointers down, `onPointerMove` matches neither branch, so `this.centroid` keeps
the value from when two fingers were down. `onPointerUp` only refreshes the centroid when
the remaining count is 1, not 2.

**Repro:** rest three fingers on the canvas, move them, lift one — the next `pointermove`
computes `touchMove += cx - centroid.x` against a long-stale centroid and the camera jumps
by the whole accumulated offset.

---

## 9. Dead pose fields and a doc comment describing removed behaviour
`src/earth/EarthScene.ts:1743`

`animateCameraTo`'s comment still says "The zoom clamps (min/maxDistance) animate with the
camera (see body)" and points at `createControls`; neither exists any more.
`CameraPose.minDistance`/`maxDistance` (`src/core/types.ts:52-53`) are still populated at
six sites (`EarthScene.ts:1598, 1615, 1631, 1646, 1670, 1692`) but read by nobody — the
per-pose zoom limits (e.g. "never clip inside the photosphere") are silently gone, which
is what enables finding #6.

---

## 10. Rewritten doc lines carry stale numbers
`docs/camera.md:7`

The new text states `far 7000` and "star shell (3300–3450)", but `CAMERA_FAR = 25000` and
the shell is 12000–13000 (as `src/config/camera.ts:20` itself says). This PR rewrote these
lines, so the numbers should have been updated with them.
