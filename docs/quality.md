# Quality (adaptive)

Renders at the right cost for the device — not a shrunken desktop. Lives in
`src/core/Quality.ts` (pure data + detection, **no scene code**).

## Tiers & profiles
| | `high` | `balanced` | `performance` |
|--|--------|------------|---------------|
| pixelRatioCap | 2 | 1.75 | 1.5 |
| starCount | 12,000 | 8,000 | 5,000 |
| sphere segs (earth/moon/sun) | 128/96/96 | 96/64/64 | 64/48/48 |
| bloom | on (0.7 / 0.5 / 1.25) | on (0.55 / 0.4 / 1.3) | **off** |
| msaaSamples | 4 | 0 | 0 |
| textureSet | `high` (2k/4k) | `mobile` (1k/2k) | `mobile` |
| anisotropy | ∞ | 4 | 2 |
| coronaOpacity | 0.9 | 0.85 | 0.7 |

`auto` (default) resolves to a tier at startup from **measurable signals only** — pointer
type, viewport, `hardwareConcurrency`, `deviceMemory`, unmasked GPU string — **no
user-agent sniffing** (`detectAutoTier()`).

## Runtime FPS guard
- While in `auto`, a rolling FPS sample steps the tier **DOWN** one level if the device can't
  sustain it; it never steps back up (avoids oscillation). `nextTierDown()`.
- The UI (Quality buttons + "Auto — rendering at …" tooltip) is synced via `syncQualityUI()`.

## Live application — no scene rebuild
- `applyQualityLevers()` (in `EarthScene`) applies a resolved profile without tearing down:
  - `setPixelRatio`, star count, bloom/MSAA (composer), corona opacity, anisotropy.
  - `swapGeometry()` — swaps each sphere's segment count in place (Earth/cloud/atmo/moon/sun).
  - `swapTextureSet()` — loads the other texture set + falls through on failure (`ASSETS.md`).
- First frame of a tier is the "correct" one; there is no visible pop because textures are
  the same source imagery at different resolutions.

## Debug
- `?debug` panel exposes the tier + manual override (auto/high/balanced/performance).