# AGENT START HERE

**Read me first.** This is an interactive, cinematic 3D Earth built with **Three.js +
TypeScript + Vite** (no React). The globe uses **real NASA / SDO satellite imagery** —
never procedural continents.

## The one rule that outranks everything
> **Preserve existing behavior and visuals.** This project has no automated visual /
> behavioral test suite, only the type-checker and the production build. Treat
> `npx tsc --noEmit` and `npm run build` going green as the *minimum* bar, not the goal —
> they catch compilation errors, **not** rendering regressions. When in doubt, make the
> smallest verifiable change and verify visually before moving on.

## Before you change anything
1. Read `PROJECT_MAP.md` (what lives where, and how pieces call each other).
2. Read the **REFACTOR CHECKPOINT** section at the bottom of `AGENT_CHECKPOINT.md`
   (current session scope + the exact remaining steps).
3. Read the feature doc in `docs/` for the area you're touching.
4. `npx tsc --noEmit` to establish a green baseline.

## Commands
| Task | Command |
|------|---------|
| Type-check (fast) | `npx tsc --noEmit` |
| Dev server | `npm run dev` |
| Production build (type-check + bundle) | `npm run build` |
| Preview production build | `npm run preview` |
| Lighting-math sanity | `node scripts/lighting_math_test.mjs` |

## Where things are (quick view)
- `src/earth/EarthScene.ts` — the **orchestrator**: wires renderer/camera/controls,
  runs the load + quality + selection + UI + animation. It coordinates the modules below
  but (still) owns the interactive state.
- `src/earth/` — Earth domain: `StarField.ts` + `shaders/` (earth, cloud, atmosphere, starfield).
- `src/moon/` — Moon domain: `shaders/moon.ts` (+ the `Moon` class, next increment — see checkpoint).
- `src/sun/` — Sun domain: `shaders/sun.ts` (+ the `Sun` class, next increment).
- `src/lighting/SunLighting.ts` — the **authoritative Sun state** (az/elev → direction) + vector math.
- `src/core/` — `Quality.ts` (adaptive tiers), `types.ts` (shared types).
- `src/config/` — `sceneScale.ts` (all sizes/distances), `camera.ts` (camera/controls), `mobile.ts`.
- `index.html` — the entire UI DOM + CSS (one set of elements, two CSS layouts).

## Refactor methodology (use it for every change)
**Leaf-first, verbatim, compiler-checked.** Move *self-contained* code (shaders,
constants, types, pure factories) first and **copy it byte-for-byte** — do not rewrite
while relocating. After each logical step, `npx tsc --noEmit` **and** `npm run build`
must stay green. Only once the leaves are stable, extract stateful objects (Moon, Sun,
Earth/Clouds/Atmosphere) and finally the interactive orchestration (camera/focus, UI,
quality application) — and do those **with a browser open**, because they can't be
verified by the compiler alone. See the checkpoint for the exact ordered steps.

## Feature docs
`docs/earth.md` · `docs/moon.md` · `docs/sun.md` · `docs/camera.md` ·
`docs/quality.md` · `docs/ui.md`

## Gotchas (learned the hard way)
- The scene is **normalized to Earth radius = 1**; every size/distance is relative
  (see `src/config/sceneScale.ts`). Don't hardcode numbers in scene code.
- The Moon is lit by a **true point source** (`sunDirectionToward(sunWorldPos, moonPos, …)`),
  *not* the shared parallel-ray direction — that's what makes lunar phases correct.
- Transparent draw order is explicit: `renderOrder` stars 0 < clouds 1 < atmosphere 2.
- UI is **one DOM, two layouts** (CSS media queries) with a single delegated `body`
  click handler; the Sun panel keeps its own listeners. Don't double-bind.
- `dispose()` must free every geometry/material/texture/passed it created — repeated
  create/dispose must not exhaust the GPU texture budget.