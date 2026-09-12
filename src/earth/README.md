# `src/earth/` — Earth domain

The **orchestrator** `EarthScene.ts` lives here (it wires the whole app), alongside the
Earth-specific rendering modules that have already been carved out of it.

```
earth/
  EarthScene.ts          # orchestrator — renderer/camera/controls, load pipeline,
                         #   quality application, selection, UI, animate(), dispose()
  StarField.ts           # createStarField(scene, count) — additive star backdrop
  shaders/               # GLSL as TS template strings, one file per concern
    earth.ts             #   surface: day/night, ocean specular, terminator, cloud shadow
    cloud.ts             #   cloud shell (alpha-only) + surface cloud shadow
    atmosphere.ts        #   fresnel limb glow
    starfield.ts         #   additive star sprites
```

**Not here (by design):**
- `../lighting/SunLighting.ts` — Sun state + vector math (shared by all bodies).
- `../core/Quality.ts`, `../core/types.ts` — adaptive quality + shared types.
- `../config/{sceneScale,camera,mobile}.ts` — sizes/distances, camera defaults, motion pref.
- `../moon/` and `../sun/` — their own domains (shaders now; classes next increment).

Docs: `../docs/earth.md`, `../docs/quality.md`. Map: `../../PROJECT_MAP.md`.