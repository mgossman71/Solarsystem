# Web-Earth

An interactive, cinematic 3D **solar system** in the browser — starting from a top-down **System** overview of all **eight planets** (each on its real inclined orbital plane, with its major moons), zooming in to a textured **Earth** with a phase-correct **Moon** and a navigable, bloom-lit **Sun** — built with **Three.js**. The globe uses real NASA/satellite imagery (correctly georeferenced continents, coastlines and oceans — no procedural fakes), with a day/night terminator, city lights, ocean specular, an independent drifting cloud layer, and a sun-aware atmospheric limb glow. Mobile-first, with adaptive quality that renders at the right cost for each device.

## Features

- **Real Earth** — equirectangular NASA day albedo + night-lights maps, correctly oriented (north up).
- **Physically-motivated lighting** — a single shared sun direction drives the day/night terminator, city lights, ocean specular, cloud illumination, and atmosphere all at once.
- **Independent Moon** — real Moon texture, phase driven by the Sun, three orbit modes (*Paused / Visualized / Real Time*).
- **Navigable Sun** — focus, orbit, and look at a real 4k solar texture with bloom + corona; presets and an auto-orbiting Sun.
- **Eight planets + moons** — Mercury through Pluto, each on its **real inclined orbital plane** (inclination + ascending node), with its major moons (Io, Europa, Ganymede, Callisto; Titan, Iapetus; Triton; Charon; …), Saturn's rings, and lazily-loaded textures.
- **System overview (the default view)** — a straight-down, Sun-centred framing of the whole system with faint **orbit guide rings** (one per planet, in its own inclined plane) and optional **planet name labels** that are themselves clickable and fly you to that planet.
- **Selection & focus** — click/tap any body, its label, or the **System · Sun · planets** buttons to focus; *Real Scale* shows true relative sizes/distances.
- **Adaptive quality** — `high / balanced / performance` tiers (pixel-ratio cap, star count, tessellation, bloom, MSAA, texture set), auto-detected from measurable device signals (not user-agent sniffing) with a runtime FPS guard that steps down when a device can't keep up.
- **Mobile-first UI** — touch orbit/pinch-zoom, a draggable bottom "Controls" sheet, a touch sun pad (azimuth/elevation), safe-area insets, and respect for `prefers-reduced-motion`.

## Tech stack

- **TypeScript** (strict) + **Vite 8** (rolldown)
- **Three.js** — `WebGLRenderer`, ACES tone mapping, `UnrealBloomPass`
- **Custom GLSL shaders** for Earth day/night blend, cloud shading, atmosphere fresnel, star field, and Moon phase
- **OrbitControls** (damped, pan disabled)
- **No UI framework** — vanilla DOM for the panels, sheet, and toggles

## Quick start

```bash
npm install          # install dependencies
npm run dev          # dev server at http://localhost:3000 (auto-opens)
npm run build        # production build to dist/ (tsc + vite)
npm run preview      # serve the production build locally
npx tsc --noEmit     # type-check only
```

The app is a static site — `npm run build` + `npm run preview` (or serving `dist/`) is all it needs.

## Controls

| Action | How |
|--------|-----|
| Orbit | Drag (mouse) / one-finger touch |
| Zoom | Scroll / pinch |
| Focus a body | Click/tap the body (or its name label in the System view), or use the **System · Sun · Mercury … Pluto** buttons; moons via the **Moons** picker (shown when a planet is focused) |
| Sun position | **Sun Lighting** panel: azimuth/elevation pad or sliders, presets (**Day · Sunset · Night · Backlit**), **Full Daylight**, **Reset Sun**, **Auto** (Sun orbits the camera) |
| Toggles | **Atmosphere**, **Clouds**, **Stars**, **Auto Rotate**, **Labels**, **Fullscreen**, **Reset** (back to the System overview) |
| Quality | **Auto · High · Balanced · Performance** |
| Moon orbit | **Paused · Visualized · Real Time** |
| Scale | **Exploration · Real Scale** |

On mobile the controls live in a draggable bottom sheet; the Sun panel collapses to a top-anchored bar.

## Quality tiers

| Tier | Pixel-ratio cap | Stars | Bloom | MSAA | Texture set | Tessellation |
|------|-----------------|-------|-------|------|-------------|--------------|
| **High** | 2 | 12 000 | on | 4× | 2k/4k | dense |
| **Balanced** | 1.75 | 8 000 | softer | off | 1k/2k | medium |
| **Performance** | 1.5 | 5 000 | off | off | 1k/2k | light |

`Auto` (default) resolves to a tier at startup from **measurable** signals — pointer type, screen size, `hardwareConcurrency`, `deviceMemory`, and the unmasked GPU renderer string — never user-agent sniffing. In `Auto` it also watches measured frame rate and steps *down* one tier if the device can't sustain it (never back up, to avoid oscillation).

## URL parameters

Useful for deterministic screenshots / QA / debugging. All optional; defaults apply otherwise.

| Param | Values | Effect |
|-------|--------|--------|
| `quality` | `auto \| high \| balanced \| performance` | Override the quality tier (beats the saved preference) |
| `focus` | `system \| earth \| moon \| sun \| mercury … pluto`, plus planet moons (e.g. `io`, `titan`, `triton`, `charon`) | Initial camera focus (default `system`) |
| `sun` | `azimuth,elevation` (e.g. `90,20`) | Initial Sun direction (az −180…180, el −90…90; clamped) |
| `orbit` | `paused \| visualized \| realtime` | Moon orbit mode |
| `scale` | `explore \| real` | Exploration vs. real relative scale |
| `clouds` / `atmosphere` / `stars` / `rotate` / `labels` | `0 \| 1` | Show / hide each layer, or auto-rotate / planet name labels |
| `mode` | `1 \| 2 \| 3` | Debug shading mode |
| `sunray` / `frontlight` / `softfill` | `1` | Enable each optional lighting effect |
| `debug` | _(present)_ | Show the debug panel |

Example: `?focus=sun&quality=high&sun=90,0&scale=real`.

## Project structure

```
index.html                 # Entry HTML + inline UI CSS; loads main.ts
src/main.ts                # Bootstrap — creates EarthScene, exposes window.__earth
src/config/
  camera.ts                # Camera + OrbitControls + System-view framing constants
  sceneScale.ts            # World-scale constants (orbit radii, Sun, star shell)
  mobile.ts                # Mobile layout constants
src/core/
  Quality.ts               # Adaptive quality: tiers, auto-detection, texture paths
  types.ts                 # Shared types (Focus, ScaleMode, OrbitMode, …)
src/earth/
  EarthScene.ts            # Core: renderer, scene, camera, controls, meshes,
                           #   animation loop, UI, quality, sun, moon, labels
  StarField.ts             # Additive star-sprite backdrop shell
  shaders/                 # Earth day/night, clouds, atmosphere, starfield GLSL
src/sun/shaders/sun.ts     # Solar photosphere shader
src/moon/shaders/moon.ts   # Moon phase shader
src/lighting/SunLighting.ts# Shared azimuth/elevation sun state + vector math
src/planets/
  registry.ts              # The eight planets + moons (sizes, inclinations, nodes)
  orbital.ts               # Shared inclined-circular-orbit position helper
  PlanetSystem.ts          # One planet: body, rings, moons, spin, lazy textures
  OrbitRings.ts            # Faint per-planet orbit guide rings (System overview)
  shaders/                 # Planet, ring, and haze GLSL
scripts/                   # Texture generation + verification (dev-only)
  generate_mobile_textures.py   # Build the 1k/2k mobile set from the high-res maps
  verify_sun_texture.py         # Sanity-check the solar maps
  verify_moon_texture.py        # Sanity-check the moon maps
  check_baked_lighting.py       # Baked-lighting diagnostics
  analyze_assets.py             # Report texture sizes
  lighting_math_test.mjs        # Headless test of the lighting math (no WebGL)
public/assets/
  earth/  moon/  sun/      # Real satellite/solar imagery (see Assets below)
  mercury/ … pluto/        # Real planet imagery (+ moon maps, Saturn ring)
Dockerfile                 # Multi-stage: Vite build → nginx:alpine
docker-compose.yml         # `docker compose up` → http://localhost:3000
```

## Testing

- **Type-check / build:** `npx tsc --noEmit` and `npm run build` should both pass cleanly before committing.
- **Lighting math:** `node scripts/lighting_math_test.mjs` — a headless, WebGL-free test that replays the exact shader pipeline and asserts sun-over-region illumination, a full azimuth/elevation sweep reaching day-side, front-light and white-sphere `N·L` invariants.
- **Visual:** `npm run dev` and exercise orbit/zoom, focus, sun presets, quality switching, and the mobile bottom sheet in a browser.

## Docker

```bash
docker compose up --build    # builds the Vite app and serves it via nginx
# → http://localhost:3000
```

## Assets

Real equirectangular imagery (2:1, north up). Each tier loads the largest available file and falls back to a smaller real image on failure — never a procedural stand-in.

| Asset | File(s) | Source |
|-------|---------|--------|
| Earth day | `earth/earth-day-albedo.jpg` | Solar System Scope 2k day map (unlit albedo) |
| Earth night | `earth/earth-night.jpg`, `earth/earth-night-1k.jpg` | three-globe (NASA night lights) |
| Clouds | `earth/earth-clouds.png`, `earth/earth-clouds-1k.png` | turban/webgl-earth (alpha-only) |
| Moon | `moon/moon-day-2k.jpg`, `moon/moon-day-1k.jpg` | Lunar imagery |
| Sun | `sun/sun-4k.jpg`, `sun/sun-2k.jpg` | Solar imagery |
| Planets | `<planet>/<planet>.jpg` for all eight (`venus/venus-surface.jpg` extra) | Real planet imagery |
| Planet moons | `<planet>/moons/…` (Mars, Jupiter, Saturn, Uranus, Neptune, Pluto) | Real moon imagery |
| Saturn rings | `saturn/ring-alpha.png` | Ring alpha map |

Planet textures are **lazy-loaded on first focus** (a correct neutral placeholder shows until each map lands), so the Earth first-paint assets stay small.

The 1k/2k "mobile" set is a faithful downscale of the high-res maps (see `scripts/generate_mobile_textures.py`).

## License

MIT. Third-party imagery is used under its respective public-domain / free-to-use / NASA terms as noted above.
