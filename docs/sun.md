# Sun

Two distinct jobs that live in **two places on purpose**:
- **The Sun's *lighting* state** — azimuth/elevation → a shared direction the Earth,
  clouds, and atmosphere sample. Owned by `src/lighting/SunLighting.ts` (already extracted).
- **The Sun as a *visible object*** — the photosphere shader, corona, and world placement.
  Currently in `EarthScene` (`createSun`/`placeSun`/`loadSun`) + `sun/shaders/sun.ts`.

## State + math (`lighting/SunLighting.ts`)
- `SunLightingState` — single source of truth for `{azimuth, elevation}`; `direction` is a
  **shared, normalized** `THREE.Vector3` (avoid allocation in the render loop).
- `updateSun(azimuthDeg, elevationDeg)` — azimuth measured from +Z toward +X; elevation
  clamped to `[−89°, +89°]` to stay away from the poles.
- `sunDirectionToward(worldPosition, point, out)` — the **point-source** direction used only
  by the Moon (for correct phases). See `docs/moon.md`.

## Visible object
- **Radius 2.8 / distance 600** (`SUN_RADIUS`, and `EARTH_ORBIT_RADIUS = 600` — the Sun is
  fixed at the scene origin and Earth orbits it at 600) → apparent diameter ≈ **0.53°**
  (the real Sun's ~0.53° at 1 AU) from the default camera. At the closest allowed
  orbit (1.3 units) it's still only ~1.9° — never the dominant frame.
- Shader `sun/shaders/sun.ts` — SDO photosphere + **procedural granulation** + limb
  darkening; renders **HDR ≈ 1.55** so bloom picks it up. `uMap` is optional → with no
  texture it's a realistic procedural sun.
- **Corona** — a `Sprite` (radial gradient, `AdditiveBlending`) sized `SUN_CORONA_SCALE = 4`×
  radius; opacity follows the quality tier (`coronaOpacity`).
- Bloom (`createComposer()`): `RenderPass → UnrealBloom → OutputPass`, HDR linear
  render target; tuned so *only* the Sun blooms while the real-luminance Earth/night lights stay natural.

## Lighting modes (`state` + `setupSunUI()`)
| Mode | Behavior |
|------|----------|
| **Manual** | Az/El sliders + the sun-pad; `updateSun(az, el)` each change. |
| **Auto** (`autoSun`) | Continuous azimuth sweep; elevation held; paused while interacting. |
| **Full-daylight** (`fullDaylight`) | Sun placed *behind the camera* (`updateFullDaylightSun`) → no terminator. |
| **Soft-fill** | `uSoftFill` raises the night-side fill (perceptual clamp, not a linear %). |
- Presets (`data-preset`): full-daylight / day / sunset / night / backlit.
- `placeSun()` parks the visible Sun + corona + hit proxy at the **system centre (origin)**
  — the fixed light source. `repositionEarth()` moves the Earth-Moon system to
  `−EARTH_ORBIT_RADIUS × sun.direction` whenever the apparent Sun direction changes
  ("moving the Sun" = moving Earth), and shifts camera + controls target by the same
  delta so the frame never jumps.

## Extract / checkpoint
- Lighting state: ✅ `lighting/SunLighting.ts`. Shader: ✅ `sun/shaders/sun.ts`.
- **`Sun` object class (visuals: mesh, corona, placement) + the Sun UI controller: next
  increment** (see `AGENT_CHECKPOINT.md`).