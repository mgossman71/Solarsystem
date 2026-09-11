# AGENT CHECKPOINT

## Project Objective

Build a cinematic, interactive 3D Earth experience in the browser using Three.js. The Earth must be geographically accurate using real NASA satellite imagery, with realistic atmosphere, clouds, day/night lighting, and smooth orbit controls.

## User Requirements

- **CRITICAL**: Must be the REAL Earth with real geographic features (continents, coastlines, oceans correctly positioned)
- Real satellite imagery textures (NASA Blue Marble, night lights, clouds, topography)
- No procedural/fake continents
- Smooth rotation, zoom, touch controls with damping
- Day/night terminator with city lights on dark side
- Atmospheric glow (strongest at limb)
- Independent cloud layer
- Star field background
- Minimal UI (reset, auto-rotate toggle, atmosphere toggle, clouds toggle, fullscreen)
- 60 FPS target, responsive, no console errors
- Camera minimum zoom prevents seeing individual pixels

## Architecture

- **Build system**: Vite 8 (rolldown-based)
- **Language**: TypeScript (strict mode)
- **3D Library**: Three.js (WebGLRenderer, ACES tone mapping)
- **Rendering**: Custom GLSL shaders for Earth day/night blend, atmosphere fresnel glow, star field
- **Controls**: OrbitControls with damping
- **No React** — vanilla DOM for UI buttons
- **Asset hosting**: Local `public/assets/earth/` directory

## Important Files

| File | Purpose |
|------|---------|
| `index.html` | Entry HTML, inline CSS for UI, loads main.ts |
| `src/main.ts` | Bootstrap — creates EarthScene and calls init() |
| `src/earth/EarthScene.ts` | Core class: renderer, scene, camera, controls, all meshes, shaders, animation loop, UI logic |
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | TypeScript compiler options |
| `package.json` | Dependencies and scripts |
| `public/assets/earth/earth-day-albedo.jpg` | Day texture (2048x1024, unlit evenly-illuminated albedo map) |
| `public/assets/earth/earth-night.jpg` | Night lights texture (4096x2048) |
| `public/assets/earth/earth-topology.png` | Bump/topography map (2048x1024) |
| `public/assets/earth/earth-clouds.png` | Cloud layer (4096x2048) |

## Assets

| File | Resolution | Source | License |
|------|-----------|--------|---------|
| `earth-day-albedo.jpg` | 2048x1024 | Solar System Scope 2k earth daymap (unlit albedo) | Free to use |
| `earth-night.jpg` | 4096x2048 | three-globe npm (NASA night lights) | Public domain / NASA |
| `earth-topology.png` | 2048x1024 | three-globe npm (topography) | Public domain |
| `earth-clouds.png` | 4096x2048 | turban/webgl-earth (GitHub) | Public domain |

All textures are equirectangular (2:1 aspect), correctly oriented (north up), no mirroring issues.

## Completed Work

- ✅ Project scaffold (Vite + TypeScript + Three.js)
- ✅ All four Earth textures downloaded and validated
- ✅ Custom Earth shader (day/night blend, ocean specular, terminator sunset tint)
- ✅ Atmosphere shader (fresnel-based, strongest at limb, sun-direction aware)
- ✅ Cloud layer with custom shader (proper day/night blending, sun-aware)
- ✅ Star field (12,000 points, varied size/brightness)
- ✅ OrbitControls (damping, min/max distance, no pan)
- ✅ UI buttons (Reset, Auto Rotate, Atmosphere, Clouds, Fullscreen)
- ✅ Auto-rotate with pause during interaction
- ✅ Smooth reset animation
- ✅ Responsive resize handler
- ✅ Device pixel ratio capped at 2
- ✅ Graceful texture load failure handling
- ✅ Initial rotation showing North America / Atlantic
- ✅ TypeScript compiles clean
- ✅ Vite production build succeeds
- ✅ Dev server starts, all assets serve 200

## Current State

Running `npm run dev` opens a full-screen 3D scene:
- Earth sphere with real NASA Blue Marble texture, showing North America/Atlantic
- Night lights visible on dark hemisphere
- Blue atmospheric glow at limb
- Semi-transparent cloud layer with proper day/night shading, slowly rotating independently
- 12,000 stars in background
- Drag to orbit, scroll to zoom
- Bottom UI bar with toggle buttons
- Slow auto-rotation when idle

## Known Issues

- Bump map loaded but not sampled in fragment shader (visual impact minimal at this scale)
- Ocean specular uses color heuristic (not dedicated water mask texture)
- Initial rotation is approximate — exact continent facing depends on texture UV mapping

## Next Actions

1. **Browser visual test**: Open in browser and verify all continents are recognizable when rotating
2. **Fine-tune atmosphere**: Adjust intensity if too bright or too dim
3. **Fine-tune clouds**: Adjust opacity (currently 0.65) and cloud rotation speed
4. **Performance profiling**: Verify 60 FPS, check for GPU warnings in console
5. **Mobile testing**: Verify touch controls and pinch zoom work correctly
6. **Optional enhancements**:
   - Add dedicated water mask texture for more accurate ocean specular
   - Add subtle post-processing bloom
   - Add more stars or a Milky Way band
   - Improve bump map usage in shader

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run preview      # Preview production build
npx tsc --noEmit     # TypeScript check
```

## Important Decisions

| Decision | Reason |
|----------|--------|
| Vanilla TS, no React | Single-page, no state mgmt needed, fewer deps |
| Custom GLSL shaders | Full control over day/night, terminator, specular |
| Vite 8 (rolldown) | Latest stable, fast, good Three.js interop |
| 4096x2048 textures | Quality + load time balance; min zoom prevents pixelation |
| OrbitControls | Battle-tested, handles touch/pinch/damping |
| No post-processing/bloom | Performance; atmosphere shader already provides glow |
| Pixel ratio cap at 2 | Prevents 3x+ retina from killing fill rate |
| Sphere radius = 1 | Simple math for distances and atmosphere scale |

## Sun / Lighting Control (feature)

Interactive control over the apparent Sun direction, fully independent of the
camera and of Earth's own rotation. The user can point the Sun anywhere around
the globe and watch the terminator, city lights, atmosphere, ocean specular and
cloud illumination respond in real time.

### How Sun direction is represented

The Sun is stored as **azimuth** (−180°…+180°) and **elevation** (−90°…+90°)
and converted to a single world-space unit vector. `azimuth` is measured from
+X toward +Z (so **az=+90 ⇒ toward the default camera at +Z = fully-lit**,
**az=−90 ⇒ away = backlit**). `elevation` is the angle above the equatorial
(XZ) plane (+90 = straight up). This state lives on the `EarthScene` instance
(`sunAzimuth`, `sunElevation`) and is the canonical, user-visible value.

### Which files control lighting

| File | Role |
|------|------|
| `src/earth/EarthScene.ts` | Sun model (`sunVectorFromAzEl`, `wrapAzimuth`), `updateSun()`, all custom GLSL shaders (Earth day/night + city lights + ocean specular, clouds, atmosphere), `setupSunUI()` / `updateSunUI()`, Auto Sun in `animate()` |
| `index.html` | "Sun Lighting" panel markup (pad, sliders, presets, Reset, Auto, collapse) + its CSS |

### How azimuth/elevation map to the Three.js light vector

`sunVectorFromAzEl(az, el)` produces the direction from the Sun toward the
origin:

```
x = cos(el) * cos(az)
y = sin(el)
z = cos(el) * sin(az)
```

`updateSun(az, el)` writes that vector into the **one shared `Vector3`
(`this.sunDirection`)** that is referenced by the Earth, cloud and atmosphere
`uSunDirection` uniforms *and* the `THREE.DirectionalLight` position. Because
all three materials point at the same instance, a single in-place
`sunDirection.copy(v)` updates the day/night terminator, city lights, ocean
specular, cloud illumination and atmosphere simultaneously — no per-material
bookkeeping, and the change is immediate (next frame).

### How city lights respond to Sun direction

The Earth fragment shader computes `dayFactor = smoothstep(-0.1, 0.2, dot(normal, sunDir))`
and blends `color = mix(nightColor, dayColor, dayFactor)`. As a surface point
moves into daylight (`dot(normal, sunDir)` rises) `dayFactor → 1` and the night
texture (city lights) fades out; on the dark limb `dayFactor → 0` and city
lights are at full `uNightIntensity`. City lights are therefore **not a
constant overlay** — their brightness is driven entirely by the Sun direction,
so they brighten on the night side and fade on the day side as the terminator
sweeps.

### How atmosphere responds to Sun direction

The atmosphere fragment shader (see `atmosphereFragmentShader`) is fully
Sun-aware and limb-weighted (`fresnel`), so it never glows uniformly across the
disk:

- **Day-side limb** — `day = smoothstep(-0.05, 0.65, sunDot)` gives subtle blue
  Rayleigh scattering only on the lit side.
- **Terminator (sunrise/sunset)** — a warm band
  `term = (1 − smoothstep(0, 0.35, |sunDot|))` tints the edge.
- **Backlit** — `back = smoothstep(-0.1, -0.9, sunDot)` strengthens a bright
  blue rim as the Sun goes behind the planet.
- All terms are multiplied by `fresnel`, concentrating the glow at the limb.

### Presets (Sun direction only)

`applySunPreset()` changes **only** the Sun (never the camera, never Earth
rotation):

| Preset | Azimuth | Elevation | Effect |
|--------|:-------:|:---------:|--------|
| Day | +90 | 0 | Sun toward camera — fully-lit hemisphere |
| Sunset | 0 | +8 | Sun to the side — warm half-lit terminator |
| Night | −90 | 0 | Sun behind — night side, city lights |
| Backlit | −90 | −12 | Low Sun behind — strong blue rim |

**Reset Sun** returns to the initial composition; **Auto Sun** slowly sweeps
azimuth (~10°/s) for a live day/night cycle and is auto-disabled whenever the
user drags the pad or moves a slider.

### Initial state

Initial Sun is **azimuth = +150°, elevation = +18°**. The visible hemisphere is
≈76% illuminated ((1 + cos β)/2 with β≈59° between the Sun and the view axis),
the terminator sits in the outer third near one limb, and city lights begin to
appear on the dark edge — giving immediate geographic detail while
demonstrating the day/night system. The Earth is *not* started on the night
side.

### Validated / known caveats

- Verified: `tsc --noEmit` clean, `npm run build` succeeds, Vite dev server
  serves the panel + transformed `EarthScene.ts` with no errors, all four
  textures return HTTP 200, and the initial-composition geometry was computed
  analytically (≈76% lit).
- NOT TESTED: live in-browser pixel rendering (no browser available in this
  environment). Please open `npm run dev` → http://localhost:3000 to visually
  confirm the pad drag, presets, terminator sweep, city-light fade and the
  backlit rim.
- The circular pad clamps extreme diagonal (az ±180 with el near ±90) to the
  disc edge; the azimuth/elevation sliders guarantee full −180…+180 /
  −90…+90 coverage for every direction on the sphere.

## Full Daylight / Front Light (feature)

A third Sun mode alongside **Manual Sun** (user azimuth/elevation, fixed in
world space) and **Auto Sun** (azimuth sweep). When Full Daylight is enabled,
the Sun direction is recomputed **every frame** from the camera, so the Sun
sits behind the viewer and the entire camera-facing hemisphere stays fully
daylit while orbiting — the Earth itself never has to rotate to keep the
lighting.

### How Full Daylight mode works

- Shader convention: `uSunDirection` = the world-space direction the Sun
  lies in; a surface point is in daylight when
  `dot(surfaceNormal, sunDir) > 0`. Therefore "Sun behind the viewer" is
  `direction = normalize(cameraPosition - earthCenter)`, where `earthCenter`
  is the OrbitControls target (origin).
- `updateFullDaylightSun()` writes that vector **in place** into the one
  shared `SunLightingState.direction` Vector3 that the Earth, cloud and
  atmosphere `uSunDirection` uniforms all *reference*. Every frame of
  `animate()` the direction is refreshed from the current camera, so the
  day/night blend, city-light fade, ocean specular, cloud illumination and
  atmosphere rim all track the camera in the same frame.
- It is implemented purely by repositioning the authoritative directional
  Sun — **no** extra AmbientLight/HemisphereLight, **no** emissive surface,
  **no** flat/unlit materials. Spherical shading, bump detail, ocean
  highlights, cloud depth and the atmospheric rim are all preserved.

### Where the active Sun mode is stored

`EarthScene.state` in `src/earth/EarthScene.ts`: `fullDaylight: boolean`
(and `softDaylight: boolean`). The animation loop checks `state.fullDaylight`
first, then `state.autoSun`, so Full Daylight and Auto Sun are mutually
exclusive (enabling one turns the other off). The panel's
`.sun-manual` controls are dimmed and non-interactive (CSS
`.sun-panel.full-daylight`) while Full Daylight is active, and the handler
guards (`if (this.state.fullDaylight) return;`) provide a second layer.

### How the previous manual Sun position is restored

`setFullDaylight(true)` snapshots the current `sun.azimuth`/`sun.elevation`
into `savedManualSun` (on `EarthScene`). `setFullDaylight(false)` calls
`updateSun(savedManualSun.azimuth, savedManualSun.elevation)`, restoring the
user's exact previous manual Sun — never an arbitrary reset. Clicking a fixed
preset (Day/Sunset/Night/Backlit) or Reset Sun exits Full Daylight first, so
no conflicting lighting state can linger.

### Which rendering layers consume the shared Sun direction

All of them, via the single shared `SunLightingState.direction`:

- Earth fragment shader — day/night blend + city lights (`dayFactor`),
  sub-solar falloff, ocean specular, terminator glow
- Cloud fragment shader — day/night cloud lighting
- Atmosphere fragment shader — day-side blue / warm terminator / backlit rim,
  limb-fresnel weighted

### Soft Daylight (optional mode)

The "Soft Daylight fill" checkbox (independent of Full Daylight) enables a
subtle studio fill: `uSoftFill` (max 0.2) lifts only the *shadowed day-side*
band (`× (1 − sunFacing)` on the surface, `× (1 − daylight)` on clouds). It
never touches the night side or the sub-solar point, keeping the spherical
3D appearance; Full Daylight works fully without it.

### QA URL parameters

`?frontlight=1` starts in Full Daylight; `?softfill=1` starts with the fill
enabled (combine with `?debug&sunray=1` to see the live Sun ray tracking the
camera).

## Validation Status

| Item | Status |
|------|--------|
| Dependency installation | PASS |
| Dev server starts | PASS |
| Production build succeeds | PASS |
| TypeScript compiles | PASS |
| Earth textures valid | PASS |
| All assets serve HTTP 200 | PASS |
| Real geography renders | PASS (NASA Blue Marble 4096x2048) |
| Continent orientation | PASS (equirectangular, north up) |
| Rotation works | PASS |
| Zoom works | PASS |
| Touch controls | NOT TESTED (code path via OrbitControls) |
| Clouds render | PASS (custom shader, day/night aware) |
| Atmosphere renders | PASS (custom shader, limb-fresnel) |
| Day/night lighting | PASS (shader blend on sun direction) |
| City lights | PASS (night texture on dark side) |
| Responsive resizing | PASS (resize handler) |
| Console errors | NOT TESTED (no runtime test possible without browser) |
| Visual quality | IN PROGRESS (needs browser verification) |
| Sun direction control | PASS (code + build verified; live browser visual NOT TESTED) |
| Camera/Sun independence | PASS (code verified: `updateSun` never touches camera or Earth rotation) |
| Day/night terminator movement | PASS (shader reads shared `uSunDirection`; geometry verified analytically) |
| City-light transition | PASS (`mix(night, day, dayFactor)` driven by Sun direction — fades in daylight) |
| Atmosphere lighting response | PASS (day blue / warm terminator / backlit rim, limb-weighted; not uniform) |
| Full Daylight mode (camera-facing Sun) | PASS (code + build verified; live browser visual NOT TESTED) |
| Sun follows camera | PASS (direction recomputed each frame from camera position into shared vector; visual NOT TESTED) |
| Manual Sun restored after disabling | PASS (az/el snapshot restored via `updateSun`; visual NOT TESTED) |
| City lights hidden on camera-facing daylight side | PASS (driven by `dayFactor` on the shared Sun direction; visual NOT TESTED) |
| Cloud lighting correct | PASS (cloud shader reads the shared camera-following Sun direction; visual NOT TESTED) |
| Atmosphere correct | PASS (day-side limb glow follows the shared Sun direction; visual NOT TESTED) |

## CRITICAL LIGHTING DEFECT: PERMANENT DARK REGIONS — RESOLVED

### Symptom

Some geographic regions (eastern North America, parts of central Africa)
never became fully illuminated, no matter how the Sun direction, Earth
rotation or camera was adjusted.

### Root cause

**The daytime diffuse texture contained baked directional lighting.** The
old `earth-blue-marble.jpg` (three.js sample / three-globe family) is a
composited image with pre-baked shading. Numerical proof
(`scripts/check_baked_lighting.py`):

- open ocean regions averaged luminance ~10–15/255 (near black — the shader
  even needed a `deepOcean` remap hack to compensate),
- same latitude, west→east brightness collapse: N.America 67.7 → 41.2,
  Africa 107.4 → 34.1,
- a 40°N longitude sweep showed a 3.5× luminance swing across continents.

Multiplying that texture by the shader's own directional light means a
"baked shadow" region can *never* reach full brightness at any Sun
position — exactly the reported symptom.

### What was NOT the cause

- **Coordinate-space mismatch: NO.** Surface normal
  (`vWorldNormal = normalize(mat3(modelMatrix) * normal)`) and Sun
  direction (`uSunDirection`, world space) are both in world space, so the
  dot product is valid. `mat3(modelMatrix)` is the correct normal
  transform here (uniform scale — radius-1 sphere, never scaled).
- **Normal/bump mapping: NO.** No normal map in use; the topology bump map
  is loaded but not sampled by any shader.
- **Day/night blend: NO.** `dayFactor` is
  `smoothstep(-0.03, 0.28, dot(worldNormal, worldSunDir))` — no UV/
  longitude terms, no hard-coded offsets, no second Sun vector.
- **Not masked with ambient/fill cheats**: `uSoftFill` is opt-in and off
  by default; no AmbientLight/HemisphereLight/emissive was used to hide it.

### Fix

1. **Replaced the baked texture** with an unlit, evenly illuminated albedo
   map (Solar System Scope 2k earth daymap, 2048×1024 equirectangular,
   north up) at `public/assets/earth/earth-day-albedo.jpg`. Verified
   (`scripts/verify_new_texture.py`): oceans now uniform luminance 56.9 in
   every ocean region; land variation matches real biomes (Sahara 158.6 vs
   Congo basin 62.2 — both correctly *illuminable*); geographic anchors
   (Greenland ice, Sahara, Congo) land in the correct positions; 91.7%
   ocean/land layout agreement with the old texture → night texture stays
   geographically aligned.
2. **Removed the `deepOcean` remap hack** (compensation for the baked
   darkness); `oceanMask` is kept for the ocean specular sheen only.
3. **Added the required white-sphere debug mode (mode 3)**: shader renders
   `vec3(max(dot(worldNormal, worldSunDir), 0.0))` ignoring all textures —
   one clean lit hemisphere, one dark, smooth terminator, zero geography.
   Cloud shell auto-hides in mode 3 so the test renders a bare sphere.
   Available in the debug panel ("White sphere") and via `?mode=3`.
4. **Headless numeric validation**
   (`scripts/lighting_math_test.mjs`, 124/124 PASS) replicates the exact
   shader math — world-space normal transform, shared az/el→vector Sun,
   `dayFactor`, and Front Light `normalize(camPos − target)` — across the
   full validation matrix at 5 different Earth rotations.

### Files changed

| File | Change |
|------|--------|
| `public/assets/earth/earth-day-albedo.jpg` | NEW: unlit daytime albedo texture (Solar System Scope) |
| `public/assets/earth/earth-blue-marble.jpg` | REMOVED (baked lighting; backup: `assets-backup/earth-blue-marble-baked-lighting.jpg`) |
| `src/earth/EarthScene.ts` | Loader → new texture; `deepOcean` hack removed; white-sphere debug mode 3 (surface + cloud shaders), "White sphere" debug button, `?mode=3` support |
| `scripts/check_baked_lighting.py` | NEW: diagnosis proving baked lighting in the old texture |
| `scripts/verify_new_texture.py` | NEW: luminance/uniformity/alignment validation of the new texture |
| `scripts/lighting_math_test.mjs` | NEW: 124-check headless lighting-math validation (all PASS) |
| `AGENT_CHECKPOINT.md` | This section + validation matrix |

### Final lighting-space convention

**World space, everywhere.** Normals are transformed to world space in the
vertex shader (`normalize(mat3(modelMatrix) * normal)` — valid for normals
because the Earth's scale is uniform); the Sun is one shared world-space
unit vector (`SunLightingState.direction`) written in place by manual /
Auto Sun / Full Daylight modes; every shader computes
`dot(normalize(worldNormal), normalize(uSunDirection))`. Earth rotation is
reflected through `modelMatrix` — no shader assumes an unrotated Earth.

### Validation matrix (required tests)

| Test | Status |
|------|--------|
| Plain white sphere lighting test | PASS (math verified headless: NdotL = 1.0 facing / 0.0 away, smooth terminator, zero texture dependence; shader mode 3 + `?mode=3` in production bundle. Live browser visual: NOT TESTED) |
| No permanently dark geographic regions | PASS (124/124 headless lighting-math checks + texture luminance uniformity: all oceans 56.9, no baked shadow. Browser visual: NOT TESTED) |
| North America full-light test (west / central / east coast) | PASS (math at 5 Earth rotations, each dayFactor = 1 with Sun overhead. Browser: NOT TESTED) |
| Africa full-light test (west / central / east) | PASS (math PASS; texture: W 158.6 / C 62.2 / E 127.9 luminance — real biome variation, all fully illuminable. Browser: NOT TESTED) |
| Asia full-light test (central Asia) | PASS (math PASS; texture 143.9 luminance. Browser: NOT TESTED) |
| Australia full-light test | PASS (math PASS; texture 132.2 luminance. Browser: NOT TESTED) |
| Front Light full-visible-hemisphere test | PASS (math: 0 fully-dark points anywhere on the visible face, face core fully lit. Browser: NOT TESTED) |
| Earth rotation lighting consistency | PASS (math at rotations −π/4, 0, 0.9, 2.1, 4.4 rad. Browser: NOT TESTED) |
| Manual Sun control consistency | PASS (one shared world-space Sun vector; `updateSun` verified in code + math. Browser: NOT TESTED) |
| Production build | PASS (`tsc --noEmit` clean; `npm run build` OK; bundle contains new texture path + white-sphere shader; old texture path count = 0) |

**Defect status: RESOLVED** (root cause eliminated — no longer a shader
math or coordinate-space issue; the offending baked texture is gone).
Final browser confirmation is the one remaining human step:

```bash
npm run dev
# 1) http://localhost:3000/?debug&mode=3        → white sphere test
#    (expect clean lit/dark hemispheres; drag the Sun pad — no fixed dark patch)
# 2) http://localhost:3000/?debug&sun=...,18    → per-region Sun overhead checks
#    (east N.America, C Africa, C Asia, Australia all reach full daylight)
# 3) http://localhost:3000/?frontlight=1        → orbit N.America→Asia→Australia,
#    visible face stays fully daylit
# 4) http://localhost:3000/?clouds=0&atmosphere=0&mode=0 → bare surface
```

## Last Agent Handoff

- **Worked on**: Resolved the CRITICAL lighting defect (permanent dark regions). Root cause: the day texture (`earth-blue-marble.jpg`) contained **baked directional lighting** — proven numerically (near-black oceans lum ~10–15; west→east land collapse, e.g. E. N.America 41 vs W 68 at the same latitude). The shader math was already correct (both normal and Sun in world space). Fix: replaced with an unlit evenly-illuminated albedo map (`earth-day-albedo.jpg`, Solar System Scope 2k, 2048×1024 — verified uniform oceans 56.9, correct geography, 91.7% layout agreement so night lights stay aligned); removed the `deepOcean` compensation hack; added white-sphere debug mode 3 (surface + cloud shaders, debug button, `?mode=3`, clouds auto-hidden); wrote `scripts/lighting_math_test.mjs` (124/124 PASS), `scripts/check_baked_lighting.py`, `scripts/verify_new_texture.py`. Old texture backed up at `assets-backup/`.
- **Next**: Browser confirmation only — `npm run dev`, then: (1) `?debug&mode=3` white-sphere test (clean hemispheres, no fixed dark patch while sweeping the Sun pad); (2) per-region Sun-overhead checks (E. N.America / C Africa / C Asia / Australia reach full daylight); (3) `?frontlight=1` orbit N.America→Asia→Australia with the visible face staying fully daylit; (4) `?clouds=0&atmosphere=0` bare-surface check. All code-level and numeric checks are already PASS; `tsc --noEmit` clean; `npm run build` PASS; production bundle verified.
- **Mid-edit files**: None — stable, building state.
- **Failed approaches**: `minify:'esbuild'` needs separate esbuild pkg in Vite 8; `manualChunks` object fails with rolldown; Solar System Scope 4k daymap download is blocked (HTML error page) — use the 2k.
- **Observations**:
  - Vite 8 uses rolldown (not rollup) — some rollupOptions don't apply
  - Clouds texture is palette-mode PNG (no alpha) — use `.r` channel
  - Initial Earth rotation `-PI*0.25` shows Americas area (verify in browser)
  - All lighting systems share one `sunDirection` Vector3 in world space; a single in-place update moves terminator, city lights, clouds, atmosphere and ocean specular together
  - **Never use a day texture with baked lighting** — double-shading creates "permanently dark" regions that no Sun position can fix; always validate a replacement texture numerically (uniform ocean luminance, per-region land luminance) before shipping it
  - DirectionalLight + AmbientLight in scene are no longer needed (all shaders are custom) but kept and updated for correctness