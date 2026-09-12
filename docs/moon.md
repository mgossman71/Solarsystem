# Moon

Exact relative size to Earth, real lunar imagery, correct phases, and three orbit speeds.
Radius **0.2727** (1737.4 / 6371 km) — the true size ratio.

## Orbit geometry (`config/sceneScale.ts` + `updateMoonTransform()`)
- Center-to-center radius: **explore 10** / **real 60.3** Earth radii (`scaleMode`).
- Orbit plane tilted **5.145°** (the real mean inclination) about the X axis.
- **Tidal lock:** the equirectangular map has its prime meridian at local +X at identity;
  rotating +X onto the Earth-facing direction each frame keeps the near side facing Earth
  with zero accumulated spin (no drift).

## Lighting — the part that's easy to get wrong
The Moon is lit by a **true point source**: its `uSunDirection` is `moonSunDir`, a
*separate* per-frame vector = `sunDirectionToward(sunWorldPos, moonPosition, …)`.
Because the Moon orbits ~10–60 units from the Sun's world position while Earth sits at the
origin, the Moon's light direction differs slightly from Earth's shared direction — which is
exactly what produces correct, screen-consistent **lunar phases**. (A shared parallel-ray
direction would show the identical phase on both bodies — physically wrong.)
- **Deliberate absences:** no atmosphere, no sunset band, no soft fill, sharp terminator
  (no air to scatter). See the design note at the top of `moon/shaders/moon.ts`.
- **Relief:** no bump asset; albedo luminance is the height proxy (highlands high, maria low),
  sampled in a tangent basis and normal-perturbed.

## Shader (`moon/shaders/moon.ts`) — uniforms
`uTexture` (placeholder → real map), `uSunDirection` (point source), `uBumpScale` (1.6),
`uDebugMode`.

## Orbit modes (`moonOrbit`, advanced in `animate()`)
| Mode | Angular speed |
|------|---------------|
| `paused` | none |
| `visualized` | `2π / 60s` |
| `realtime` | `2π / (27.32·24·3600)` — the sidereal month |

## Camera / focus coupling
- Focus targets: `earth` / `moon` / `sun` / `system`. Focusing the Moon/Ssystem keeps the
  camera target glued to the moving body each frame (`focusCenter` → `controls.target`).
- `scaleMode`: `explore` (near) vs `real` (true 60.3 distance) — reframes on change.

## Extract / checkpoint
- Shader: ✅ isolated (`moon/shaders/moon.ts`). Config: ✅ `config/sceneScale.ts`.
- **`Moon` object class: next increment** (see `AGENT_CHECKPOINT.md`). It currently lives in
  `EarthScene` as: `createMoon()`, `updateMoonTransform()`, `orbitRadius()`, and the
  `moonMesh/moonMaterial/moonAngle/moonPosition` fields, with per-frame updates in `animate()`.