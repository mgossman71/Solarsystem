# Camera & interaction

Camera + OrbitControls + focus/framing + scale/orbit modes. Defaults live in
`src/config/camera.ts`; scene geometry in `src/config/sceneScale.ts`.

## Static setup
- **Camera**: `PerspectiveCamera(45°, …, near 0.01, far 2400)`; starts at `(0, 0.5, 3.2)`
  looking at the Earth at the origin.
- **Controls**: damping `0.08`, `minDistance 1.3` / `maxDistance 8` (min prevents
  pixelation; max keeps the Sun/stars in frame), **no pan**, rotate `0.5`, zoom `0.8`.

## Focus & framing
- `focus`: `earth | moon | sun | system`. Selecting a body re-targets and reframes.
- `computeFocusPose(target, bodyRadius)` — a **framing function** (never a scale
  multiplier) using a vertical FOV fit (`fitDistance`) so the whole body is visible.
- `animateCameraTo(pose, ms)` — eased 900 ms fly-to; **0 ms when reduced motion** is set
  (`prefers-reduced-motion()` → instant cuts).
- `reframeIfOutOfFrame()` — after focus changes, re-fit if the target left the frame.
- Focusing a **moving** body (Moon/System) keeps `controls.target` glued to it each frame
  via `focusCenter()`.

## Modes (UI ↔ state)
- **Scale mode** `scaleMode`: `explore` (Moon at 10) vs `real` (Moon at true 60.3).
- **Moon orbit** `moonOrbit`: `paused | visualized | realtime` (see `docs/moon.md`).

## Motion / timing constants (`config/camera.ts`)
- `SETTLE_MS = 2000` — resume auto-rotate / dim-chrome release after the last interaction.
- `ORIENTATION_MS = 250` — debounce for orientation-change reframing.
- Reduced motion → all camera animations collapse to instant.

## Extract / checkpoint
- Camera + controls defaults: ✅ `config/camera.ts`.
- **`CameraController` / focus-framing module: next increment** (see `AGENT_CHECKPOINT.md`) —
  it's coupled to focus selection, `animate()`, resize, and the reduced-motion path.