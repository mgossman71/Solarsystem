# Performance Review — free-roam camera frame path

**Date:** 2026-09-15
**Reviewed range:** `HEAD~1..HEAD` (PR #4, "replace OrbitControls with free-fly RoamController")

These are per-frame hot-path items in the code this PR introduced or changed. None are
correctness bugs; see `code-review-results.md` for those.

---

## P1 — `RoamController.update()` does full work every frame even when idle
`src/earth/RoamController.ts:238-313`

With no input at all the update still runs: `scaleFactor()` (a `distanceTo`, i.e. a sqrt),
`getWorldDirection()` (matrix decompose + normalize), a `crossVectors().normalize()`, six
`keys.has()` lookups, `applyOrientation()` (Euler → quaternion), the full collider sweep
and the range check.

**Improvement:** compute a `dirty` flag (`look`/`dolly`/`touchMove` non-zero, or
`keys.size > 0`, or a collider could have moved) and skip steps 1–4 when false. This also
fixes finding #7 — an idle frame would stop rewriting the top-down System pose.

**Impact:** the whole block is removed from every idle frame, which is the common case for
a scene left auto-rotating.

---

## P2 — `updateHitProxies()` does a linear `find` plus a radius recompute per moon per frame
`src/earth/EarthScene.ts:2213-2221`

For each planet-moon proxy, every frame:

```ts
const pdef = PLANET_BY_ID[owner];
const mdef = pdef.moons.find((m) => m.id === p.focus);
const pick = mdef ? this.planetMoonPickRadius(mdef, pdef, this.scaleMode) : 0.8;
```

`moons.find()` is an O(n) scan with a closure allocation per call, and
`planetMoonPickRadius` is recomputed each frame although it only depends on
`(mdef, pdef, scaleMode)` — all of which are stable between scale-mode changes.

**Improvement:** resolve `pdef`/`mdef` once when the proxy is created (store them on the
proxy record) and cache `pick` alongside, invalidating in the same place the colliders are
rebuilt on scale change (`EarthScene.ts:1889`). The existing
`if (p.mesh.scale.x !== pick)` guard then becomes free.

**Impact:** removes ~one array scan + one closure allocation per moon per frame; with all
planetary moons enabled that is dozens of scans/allocations every frame.

---

## P3 — Moon proxies are now tracked and raycast at every zoom level
`src/earth/EarthScene.ts:2224`, `src/earth/EarthScene.ts:1978`

Removing the `here` guard means every moon proxy is repositioned each frame
(`sys.moonWorld(...)`) and included in the click raycast set. The correctness consequence
is finding #4; the cost consequence is a larger `intersectObjects` set on every pick and
more per-frame world-position work.

**Improvement:** re-gate proxy visibility on camera distance to the owning planet. That
restores the old cost profile and removes the click-stealing bug in one change.

---

## P4 — Pick set is rebuilt with two array allocations on every click
`src/earth/EarthScene.ts:1978`

```ts
const meshes = this.hitProxies.filter((p) => p.mesh.visible).map((p) => p.mesh);
```

allocates two arrays per pointer-up. This is per-interaction, not per-frame, so the impact
is small — but a reusable scratch array filled in place costs nothing and avoids GC churn
during rapid tapping.

---

## Checked and *not* a concern

- **Collider sweep** (`RoamController.ts:276`) — plain scalar math over ~30 entries with no
  allocations and no sqrt unless a hit occurs. Fine as written; P1 already skips it when
  idle.
- **Scratch vectors** (`_fwd`, `_right`, `_move`, `_euler`, `_v`) — correctly hoisted to
  fields; no per-frame `Vector3` allocation in the roam path.
- **`buildRoamColliders()`** — only called on init and scale-mode change, not per frame.
