# PROJECT MAP

A guided map of the codebase: what lives where, and how the pieces depend on each other.
Companion to `AGENT_START_HERE.md`. Feature detail lives in `docs/`.

## Directory layout
```
index.html                 # UI DOM + all CSS (one set of elements, two CSS layouts)
src/
  main.ts                  # bootstrap: new EarthScene(#app).init(); window.__earth debug hook
  earth/
    EarthScene.ts          # ORCHESTRATOR — renderer/camera/controls, load pipeline,
                           #   quality application, selection, UI wiring, animate(), dispose()
    StarField.ts           # createStarField(scene, count) — additive backdrop (extracted)
    shaders/               # GLSL as TS template strings (extracted, one file per concern)
      earth.ts             #   surface day/night blend, ocean specular, terminator, cloud shadow
      cloud.ts             #   cloud shell (alpha-only) + surface cloud shadow
      atmosphere.ts        #   fresnel limb glow
      starfield.ts         #   additive star sprites
  moon/
    shaders/moon.ts        # lunar surface: point-source phase, albedo-derived relief
    # Moon.ts (class)      # NEXT INCREMENT — see AGENT_CHECKPOINT.md
  sun/
    shaders/sun.ts         # photosphere: SDO map + procedural granulation + limb darkening
    # Sun.ts (class)       # NEXT INCREMENT — see AGENT_CHECKPOINT.md
  lighting/
    SunLighting.ts         # SunLightingState (az/elev -> direction) + sunDirectionToward()
  core/
    Quality.ts             # tiers, profiles, auto-detect, texture paths, FPS-guard helpers
    types.ts               # Focus, MoonOrbitMode, ScaleMode, CameraPose
  config/
    sceneScale.ts          # ALL sizes/distances (SUN_*, MOON_*, STAR_*, INITIAL_SUN_*, wrapAzimuth)
    camera.ts              # FOV/near/far, initial pose, OrbitControls defaults, settle timing
    mobile.ts              # prefersReducedMotion()
assets / public assets/    # real satellite imagery (see ASSETS.md)
scripts/                   # python texture/verify helpers + lighting_math_test.mjs
docs/                      # feature documentation (earth/moon/sun/camera/quality/ui)
```

## Dependency & call flow (runtime)
```
main.ts
  └─ EarthScene.init()
       ├─ createRenderer() / createCamera() / createControls()
       ├─ createSun() ─┐            (uses sun/shaders/sun.ts, SunLighting state)
       ├─ loadSun()    │
       ├─ createComposer()          (RenderPass -> UnrealBloom -> OutputPass)
       ├─ loadEarth()               (async; the "5-asset" pipeline)
       │    ├─ day + night textures (awaited — first paint)
       │    ├─ Earth mesh + shader   (earth/shaders/earth.ts)
       │    ├─ Cloud layer + shader  (earth/shaders/cloud.ts)
       │    │     └─ cloud map (background load)
       │    ├─ Atmosphere + shader   (earth/shaders/atmosphere.ts)
       │    ├─ createMoon(loader)    (moon/shaders/moon.ts)
       │    └─ createStarField()     (earth/StarField.ts + starfield shader)
       ├─ setupUI() / setupSheet() / setupSunUI()   (index.html DOM)
       ├─ bindSelection()            (raycast hit-proxies)
       └─ animate() (per frame)
            ├─ FPS guard (auto) -> applyQualityLevers()
            ├─ auto-rotate + cloud UV drift
            ├─ sun mode (manual/auto/full-daylight) -> placeSun()
            ├─ moon advance + updateMoonTransform() + sunDirectionToward() (moon phase)
            ├─ updateMoonLabel() + updateHitProxies()
            └─ composer.render()
```

## Who owns what (single responsibility)
| Concern | Owner | Notes |
|---------|-------|-------|
| Sun state + vector math | `lighting/SunLighting.ts` | one shared direction vector |
| All sizes/distances | `config/sceneScale.ts` | Earth radius = 1 |
| Camera/controls defaults | `config/camera.ts` | |
| Adaptive quality | `core/Quality.ts` | pure data + detection, no scene |
| Shared types | `core/types.ts` | |
| Earth/Cloud/Atmo/Star/Moon/Sun **shaders** | `*/shaders/*.ts` | one file per concern |
| Star backdrop | `earth/StarField.ts` | pure factory |
| Everything interactive + lifecycle | `earth/EarthScene.ts` | the orchestrator |
| Moon/Sun/Earth **object classes** | (next increment) | see checkpoint |

## Invariants / coupling to respect
- `uSunDirection` on Earth/Clouds/Atmosphere is the **same shared vector**
  (`SunLightingState.direction`). The Moon's is **separate** (`moonSunDir`), computed
  per-frame from the Sun's real world position.
- Quality tiers swap **geometry + texture set** live (`applyQualityLevers`,
  `swapGeometry`, `swapTextureSet`) without rebuilding the scene.
- Asset loads are tracked (`trackAsset`, `loadingAssets {total:5}`) and are
  non-blocking for first paint except day+night.
- `dispose()` traverses the scene to free geometry/material and disposes every tracked
  texture + the corona sprite + composer passes.