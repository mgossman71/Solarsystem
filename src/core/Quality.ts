// ============================================================
// ADAPTIVE QUALITY
// ============================================================
// Renders at the right cost for the device — not a shrunken desktop.
//
// Tiers (settings actually applied to the renderer):
//   high        — full pixel ratio (≤2), 20k stars, full MSAA + bloom,
//                 high-res texture set, dense sphere tessellation.
//   balanced    — 1.75 pixel-ratio cap, 13k stars, no MSAA, softer bloom,
//                 1k texture set (still real NASA/SDO imagery).
//   performance — 1.5 pixel-ratio cap, 8.5k stars, no bloom at all, 1k set.
// Star COUNTS are fixed per tier; the per-star SIZE (not the count) tracks the
// star-shell radius (StarField.ts / sceneScale.ts), so moving the band keeps
// the sky the same density and brightness.
//
// `auto` (default) resolves to a tier at startup from measurable signals —
// pointer type, viewport size, hardware concurrency, memory, GPU renderer
// string — NOT user-agent sniffing. While in auto it also watches the
// measured frame rate and steps DOWN one tier if the device can't sustain
// it (it never steps back up, to avoid oscillation).

export type QualityTier = 'high' | 'balanced' | 'performance';
export type QualitySetting = 'auto' | QualityTier;

export interface QualityProfile {
  tier: QualityTier;
  /** Hard cap for renderer.setPixelRatio (window.devicePixelRatio can be 3+ on phones). */
  pixelRatioCap: number;
  starCount: number;
  sphereSegments: {
    earth: [number, number];
    cloud: [number, number];
    atmosphere: [number, number];
    moon: [number, number];
    sun: [number, number];
  };
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
  /** MSAA samples on the composer render target (0 = off). */
  msaaSamples: number;
  /** Which texture set to load: 'high' (2k/4k) or 'mobile' (1k/2k). */
  textureSet: 'high' | 'mobile';
  /** Anisotropy cap applied to all textures (0 = no cap). */
  anisotropy: number;
  coronaOpacity: number;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    starCount: 20000,
    sphereSegments: { earth: [128, 64], cloud: [96, 48], atmosphere: [64, 32], moon: [96, 48], sun: [96, 96] },
    bloom: { enabled: true, strength: 0.7, radius: 0.5, threshold: 1.25 },
    msaaSamples: 4,
    textureSet: 'high',
    anisotropy: 0,
    coronaOpacity: 0.9,
  },
  balanced: {
    tier: 'balanced',
    pixelRatioCap: 1.75,
    starCount: 13000,
    sphereSegments: { earth: [96, 48], cloud: [64, 32], atmosphere: [48, 24], moon: [64, 32], sun: [64, 64] },
    bloom: { enabled: true, strength: 0.55, radius: 0.4, threshold: 1.3 },
    msaaSamples: 0,
    textureSet: 'mobile',
    anisotropy: 4,
    coronaOpacity: 0.85,
  },
  performance: {
    tier: 'performance',
    pixelRatioCap: 1.5,
    starCount: 8500,
    sphereSegments: { earth: [64, 32], cloud: [48, 24], atmosphere: [32, 16], moon: [48, 24], sun: [48, 48] },
    bloom: { enabled: false, strength: 0, radius: 0, threshold: 1.3 },
    msaaSamples: 0,
    textureSet: 'mobile',
    anisotropy: 2,
    coronaOpacity: 0.7,
  },
};

/**
 * Real texture files per tier. Both sets are the SAME real satellite / SDO
 * imagery — the mobile set is just a faithful downscale (see
 * scripts/generate_mobile_textures.py). Order = load priority; on failure
 * the loader falls through to the next candidate so a missing asset degrades
 * to a real lower-res image instead of failing the scene.
 */
export const TEXTURE_PATHS: Record<'day' | 'night' | 'clouds' | 'moon' | 'sun', Record<'high' | 'mobile', string[]>> = {
  day: {
    high: ['/assets/earth/earth-day-albedo.jpg'],
    mobile: ['/assets/earth/earth-day-albedo.jpg'], // 2k map is only 452 KB — fine on phones
  },
  night: {
    high: ['/assets/earth/earth-night.jpg', '/assets/earth/earth-night-1k.jpg'],
    mobile: ['/assets/earth/earth-night-1k.jpg', '/assets/earth/earth-night.jpg'],
  },
  clouds: {
    high: ['/assets/earth/earth-clouds.png', '/assets/earth/earth-clouds-1k.png'],
    mobile: ['/assets/earth/earth-clouds-1k.png', '/assets/earth/earth-clouds.png'],
  },
  moon: {
    high: ['/assets/moon/moon-day-2k.jpg', '/assets/moon/moon-day-1k.jpg'],
    mobile: ['/assets/moon/moon-day-1k.jpg', '/assets/moon/moon-day-2k.jpg'],
  },
  sun: {
    high: ['/assets/sun/sun-4k.jpg', '/assets/sun/sun-2k.jpg'],
    mobile: ['/assets/sun/sun-2k.jpg', '/assets/sun/sun-4k.jpg'],
  },
};

const TIER_ORDER: QualityTier[] = ['high', 'balanced', 'performance'];

/** Resolve an `auto`/explicit setting to a concrete profile. */
export function resolveProfile(setting: QualitySetting): QualityProfile {
  const tier = setting === 'auto' ? detectAutoTier() : setting;
  return QUALITY_PROFILES[tier];
}

/** One step down the ladder (runtime FPS guard; null at the bottom tier). */
export function nextTierDown(tier: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

// ------------------------------------------------------------
// AUTO DETECTION (measurable signals only — no UA sniffing)
// ------------------------------------------------------------

function gpuRendererString(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    // Release the probe context; the real renderer is created afterwards.
    (gl as unknown as { getExtension(n: string): { loseContext?: () => void } }).getExtension('WEBGL_lose_context')?.loseContext?.();
    return s.toLowerCase();
  } catch {
    return '';
  }
}

export function detectAutoTier(): QualityTier {
  const coarse =
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  const smallScreen =
    Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) <= 1024 ||
    Math.min(window.innerWidth, window.innerHeight) <= 820;
  const isMobile = coarse && smallScreen;

  const cores = navigator.hardwareConcurrency ?? 8;
  // Safari and a few other mobile engines do NOT expose deviceMemory — the
  // `?? 8` fallback is optimistic (an assumption), not a measurement.
  const rawMem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const mem = rawMem ?? 8;
  const memKnown = rawMem != null;

  // Integrated / low-end GPU families (case-insensitive match on the unmasked
  // renderer string — measurable hardware, not a browser claim).
  const gpu = gpuRendererString();
  // Weak-GPU families: explicit legacy names only. Modern Apple silicon
  // reports a generic "Apple GPU" string that is IDENTICAL across A8…M4 —
  // the vendor string cannot tell a 2015 A8 from a 2025 M4, so Apple
  // hardware is never downgraded on the string alone (the cores/mem signals
  // below handle real low-end Apple devices).
  const weakGpu =
    /adreno (a[12]\d{2}|[12]0[0-9])|^mali (400|450|t6|t720)/i.test(gpu);

  if (isMobile) {
    if (weakGpu || cores <= 3 || mem <= 3) return 'performance';
    // No usable memory signal on mobile (the Safari / `mem ?? 8` case) with a
    // modest core count: don't assume the optimistic balanced tier (bloom +
    // 13k stars). The runtime FPS guard only ever steps DOWN, so a genuinely
    // fast phone is at worst briefly under-provisioned — safer than starting
    // high and thermally throttling mid-session. Flagship core counts (and
    // tablets) still keep balanced.
    if (!memKnown && cores <= 6) return 'performance';
    return 'balanced';
  }
  if (weakGpu && cores <= 4 && mem <= 4) return 'balanced';
  return 'high';
}
