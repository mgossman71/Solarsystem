# Camera & interaction

Camera + free-roam controls + focus/framing + scale/orbit modes. Defaults live in
`src/config/camera.ts`; scene geometry in `src/config/sceneScale.ts`.

## Static setup
- **Camera**: `PerspectiveCamera(45°, …, near 0.01, far 7000)`; starts top-down
  over the System (the Sun is the fixed centre at the origin; Earth orbits it at
  `EARTH_ORBIT_RADIUS = 600`). The far plane reaches the star shell (3300–3450)
  even from a Pluto focus.
- **Free-roam controls** (`RoamController`, replaces `OrbitControls`): no orbit
  pivot — the camera is a free point you drive. Desktop: drag = look, wheel /
  vertical trackpad = dolly, horizontal trackpad = yaw, **WASD/QE** = fly, **Shift**
  = boost. Mobile: one-finger = look, pinch = dolly, two-finger = fly. Travel and
  dolly scale with distance to the focused body so they feel consistent at every
  zoom. A soft per-body collider keeps the camera just off every surface and a
  hard range cap (`ROAM.maxRange`) keeps you inside the star shell.

## Focus & framing
- `focus`: `system | sun | earth | moon | <planet> | <planet moon>`. Selecting a
  body flies the free-roam camera to a framing of it (and every body is a global
  click/tap target — see `README.md` → Controls).
- `computeFocusPose(target, bodyRadius)` — a **framing function** (never a scale
  multiplier) using a vertical FOV fit (`fitDistance`) so the whole body is visible.
- `animateCameraTo(pose, ms)` — eased 900 ms fly-to that drives the camera directly
  (position + `lookAt`); `beginFly()` / `endFly()` pause / resume the free-roam input
  so a transition can't fight the user. **0 ms when reduced motion** is set
  (`prefers-reduced-motion()` → instant cuts).
- `reframeIfOutOfFrame()` — on a window-orientation change, glide **out** (never in)
  to a framing that contains the focused body if a narrow axis cropped it; it never
  overrides a deliberate zoom or fights an in-flight transition.
- While focused on a **moving** body the fly-to chases its live position via
  `focusCenter()` each frame. In free-roam the idle camera is *not* glued to the
  body — `repositionEarth()` only re-syncs the Earth/Moon meshes to the live orbit
  point; the user's camera simply stays where they left it.

## Modes (UI ↔ state)
- **Scale mode** `scaleMode`: `explore` (Moon at 10) vs `real` (Moon at true 60.3).
  Switching also rebuilds the free-roam colliders (body radii differ per mode).
- **Moon orbit** `moonOrbit`: `paused | visualized | realtime` (see `docs/moon.md`).

## Motion / timing constants (`config/camera.ts`)
- `ROAM.*` — free-roam tuning: look / zoom / move speeds, distance scale, surface
  margin, boost, hard range cap (`maxRange`), and settle time.
- `SETTLE_MS = 2000` — resume auto-rotate / dim-chrome release after the last interaction.
- `ORIENTATION_MS = 250` — debounce for orientation-change reframing.
- Reduced motion → all camera animations collapse to instant.

## Extract / checkpoint
- Camera + free-roam defaults: ✅ `config/camera.ts`.
- **Free-fly camera: ✅ `src/earth/RoamController.ts`** — replaces `OrbitControls`;
  coupled to focus selection, `animate()`, resize, and the reduced-motion path.