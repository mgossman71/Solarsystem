# ASSETS

All imagery is **real satellite / SDO**, equirectangular (2:1), north-up, no mirroring.
Two texture *sets* are shipped: **high** (2k/4k) and **mobile** (1k/2k). Both are the
same source imagery — the mobile set is a faithful downscale (`scripts/generate_mobile_textures.py`).

## Files on disk (`public/assets/`)
| Path | Body | Res | Notes |
|------|------|-----|-------|
| `earth/earth-day-albedo.jpg` | Earth day | 2k | Unlit, evenly-illuminated albedo. **Also the height/relief proxy** (no bump map shipped). |
| `earth/earth-night.jpg` | Earth night | 4k | NASA city lights (high set). |
| `earth/earth-night-1k.jpg` | Earth night | 1k | Mobile set. |
| `earth/earth-clouds.png` | Earth clouds | 2k | White + **alpha** density; shaders sample only `.a`. |
| `earth/earth-clouds-1k.png` | Earth clouds | 1k | Mobile set. |
| `moon/moon-day-2k.jpg` | Moon | 2k | High set. |
| `moon/moon-day-1k.jpg` | Moon | 1k | Mobile set. |
| `sun/sun-4k.jpg` | Sun photosphere | 4k | SDO (high set). |
| `sun/sun-2k.jpg` | Sun photosphere | 2k | Mobile set. |

> No `earth-topology.png` / bump map is shipped. Earth **and** Moon derive surface relief
> from their albedo luminance (bright = high), sampled in a tangent basis in the fragment
> shader. See `docs/earth.md` / `docs/moon.md`.

## Loading tiers (`src/core/Quality.ts` → `TEXTURE_PATHS`)
Order in each array = **load priority**; the loader falls through to the next candidate
on failure, so a missing asset degrades to a real lower-res image instead of failing.

| Key | high | mobile |
|-----|------|--------|
| `day` | earth-day-albedo.jpg | earth-day-albedo.jpg |
| `night` | earth-night.jpg → earth-night-1k.jpg | earth-night-1k.jpg → earth-night.jpg |
| `clouds` | earth-clouds.png → earth-clouds-1k.png | earth-clouds-1k.png → earth-clouds.png |
| `moon` | moon-day-2k.jpg → moon-day-1k.jpg | moon-day-1k.jpg → moon-day-2k.jpg |
| `sun` | sun-4k.jpg → sun-2k.jpg | sun-2k.jpg → sun-4k.jpg |

## Load sequencing (first paint vs background)
- **Awaited before first paint:** Earth **day + night** (the surface can't render without them).
- **Background (non-blocking):** **clouds**, **moon**, **sun** — placeholders occupy the
  slot first (clouds: 1×1 transparent = "no clouds"; moon: 1×1 grey; sun: procedural
  granulation). A failure degrades gracefully (cloudless Earth / placeholder Moon /
  procedural Sun), never failing the whole load.
- The 5 tracked assets feed the loading bar (`trackAsset`, `loadingAssets {total:5}`).

## Licensing
| Source | License |
|--------|---------|
| NASA Blue Marble / night lights | Public domain (NASA) |
| Cloud map (turban/webgl-earth) | Public domain |
| Moon (three-globe / NASA) | Public domain / NASA |
| Sun (SDO) | Public domain (NASA/SDO) |

## Helper scripts (`scripts/`)
- `generate_mobile_textures.py` — downscale the high set into the mobile set.
- `verify_new_texture.py`, `verify_moon_texture.py`, `verify_sun_texture.py` — validate dimensions/orientation.
- `analyze_assets.py`, `check_baked_lighting.py` — asset audit helpers.