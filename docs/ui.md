# UI

The whole UI is **one DOM + all CSS in `index.html`**, with a **single delegated
`document.body` click handler** (`uiHandler`). There are **two CSS layouts** over the same
elements (desktop ≥ 769 px / mobile ≤ 768 px) — not two copies of the markup.

## Layouts
- **Desktop (≥ 769 px):** `#primary-bar` (focus + scene toggles + Fullscreen),
  `#focus-panel` (Moons + Orbit + Distance + Quality), `#sun-panel` (right).
- **Mobile (≤ 768 px):** a draggable bottom **sheet** (`#sheet`) that collapses to an
  always-visible control bar (`#sheet-toggle` ⚙ + `#sheet-close` ✕ + `#sheet-handle`);
  `#sun-panel` becomes a top-anchored full-width panel.

## Delegated controls (`uiHandler` on `document.body`)
| data-attribute | values | effect |
|----------------|--------|--------|
| `data-focus` | earth / moon / sun / planets / moons | select + reframe |
| `data-orbit` | paused / visualized / realtime | Moon orbit speed |
| `data-scale` | explore / real | Moon orbit distance |
| `data-quality` | auto / high / balanced / performance | quality tier |
| `data-action` | reset / auto-rotate / atmosphere / clouds / fullscreen | scene toggles |

The **Sun panel keeps its own dedicated listeners** (`setupSunUI`): `[data-preset]`
(full-daylight / day / sunset / night / backlit), `data-action`
(auto-sun / reset-sun / collapse-sun), `#sun-softfill` checkbox, `.sun-body`. `uiHandler`
**deliberately skips** those to avoid double-binding.

## Earth-only toggles
Auto Rotate / Atmosphere / Clouds are Earth-specific layers, so `syncEarthOnlyButtons()`
hides them (both layouts) whenever the focused body is not Earth — shown again on Earth
focus (including a pending/deferred Earth focus).

## Key DOM IDs (must all exist, once)
`#app #loading #loading-label #loading-fill #hint #sheet #sheet-toggle
#sheet-handle #sheet-close #primary-bar #sun-panel #sun-pad #sun-knob #sun-az #sun-el
#sun-az-val #sun-el-val #sun-softfill`

## Name labels (System overview + planet views)
All label pills live in the single `#planet-labels` layer (`pointer-events:none`;
each pill re-enables pointer-events) and are projected to screen space every frame
by `updatePlanetLabels()`. Behind-camera / off-viewport pills are culled (NDC
checks). Clicking a pill flies to its body — the same delegated `[data-focus]`
→ `setFocus()` path as the focus buttons.
- **Planet pills** (Earth + the registry planets): shown only in the **System
  overview** with the Labels toggle on.
- **Moon pills** (`.moon-label`, one per registry moon + Earth's special-case
  Moon): shown only while a **planet or one of its moons is focused** —
  **never** in the System overview
  (27 moon pills over 9 planet dots would clutter it). The focused moon's own pill is
  hidden (it would sit dead-centre on the body being viewed); the siblings stay
  visible so you can hop between moons by clicking.

## Behaviors
- Selection uses a **still + short-tap** test (≤ 350 ms, ≤ 6 px) so drags never select.
- `body.interacting` dims secondary chrome; restores ~0.9 s after release.
- `[hidden] { display:none !important }` so the iOS full-screen hide path always wins.
- Touch targets ≥ 44 px on mobile; `viewport-fit=cover` + `env(safe-area-inset-*)`;
  `100dvh` (+ `100vh` fallback); `overscroll-behavior: none`.
- Mobile hint + Sun panel reflow on orientation change (debounced `ORIENTATION_MS`).

## State ↔ UI sync
- Scene toggles live in `state` (`autoRotate, atmosphere, clouds, stars, autoSun,
  fullDaylight`); `syncQualityUI()` / `updateSunUI()` push `state` back onto the buttons
  (e.g. the FPS-guard downgrade updates the Quality tooltip automatically).

## Extract / checkpoint
- `prefersReducedMotion()`: ✅ `config/mobile.ts`.
- **`setupUI` / `setupSheet` / `setupSunUI` → dedicated UI controller(s): next increment**
  (see `AGENT_CHECKPOINT.md`) — coupled to `state`, focus/scale/orbit, and Sun modes.