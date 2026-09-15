# Earth

The Earth is the hero object: a real albedo sphere with a day/night terminator, ocean
specular, a drifting cloud shell, and an additive atmospheric limb glow. Earth radius is
**1 scene unit**; all other sizes are relative to it (`src/config/sceneScale.ts`).

## Components (all created in `EarthScene.loadEarth()`)
| Piece | Shader | Geometry | renderOrder |
|-------|--------|----------|-------------|
| Surface | `earth/shaders/earth.ts` | `SphereGeometry(1, seg.earth)` | 0 (opaque) |
| Clouds | `earth/shaders/cloud.ts` | `SphereGeometry(1.01, seg.cloud)` | 1 |
| Atmosphere | `earth/shaders/atmosphere.ts` | `SphereGeometry(1.08, seg.atmo)` | 2 |

Transparent draw order is **explicit** (`stars 0 < clouds 1 < atmosphere 2`) — keep it.

## Surface shader (`earth.ts`) — key uniforms
- `uDayTexture` / `uNightTexture` — real albedo + NASA city lights.
- `uSunDirection` — the **shared** normalized Sun direction (`SunLightingState.direction`).
  Earth sits at `earthPos = −EARTH_ORBIT_RADIUS × sun.direction` (it orbits the fixed Sun
  at the origin), so `normalize(origin − earthPos) ≡ sun.direction` — bit-identical to the
  old Earth-at-origin model.
- `uCloudTexture` (alpha-only) + `uCloudShadowStrength` + `uCloudUVOffset` — cloud shadows
  on the surface. The offset tracks the cloud shell's relative Y-rotation (a pure Y-spin is
  exactly a U-offset in equirectangular space).
- `uOceanSpecular` (0.45), `uNightIntensity` (2.5), `uSoftFill` (full-daylight fill),
  `uDebugMode` (0–3 QA render modes).
- **No bump map**: relief is derived from albedo luminance (bright highlands high, dark
  maria low) sampled in a tangent basis.

## Cloud layer (`cloud.ts`)
Semi-transparent shell, samples **only `.a`** (density), so a 1×1 transparent placeholder
is pixel-identical to "no clouds". Drifts slightly faster than the surface
(`+0.00015` vs `+0.0001` Y-rot/frame under auto-rotate).

## Atmosphere (`atmosphere.ts`)
Fresnel limb glow, `AdditiveBlending`, sun-direction aware (bright on the lit limb).

## Load pipeline & graceful degradation
- **Awaited:** day + night (first paint). **Background:** clouds (placeholder → map).
- A missing cloud map degrades to a cloudless Earth; it never fails the load.
- `?mode=1|2|3` (URL) applies a debug render mode once materials exist (`pendingDebugMode`).

## Per-frame (`animate()`)
- Auto-rotate: surface `+0.0001`, clouds `+0.00015` (only when `state.autoRotate && !isInteracting`).
- Cloud shadow offset recomputed from the cloud/surface relative rotation.

## QA / debug surface
- `setupDebugPanel()` (`?debug`) exposes `uDebugMode` 0–3, `uSoftFill`, `uCloudShadowStrength`,
  and a `sunRay` ArrowHelper (the shared Sun direction).

## Extract / checkpoint
- Shaders: ✅ isolated in `earth/shaders/*.ts`.
- `StarField`: ✅ `earth/StarField.ts`.
- **Earth/Cloud/Atmosphere object classes: next increment** (see `AGENT_CHECKPOINT.md`) —
  they are coupled to `applyQualityLevers`, `swapGeometry`, `swapTextureSet`, `animate`,
  `dispose`, and the debug state, so do them **with a browser open**.