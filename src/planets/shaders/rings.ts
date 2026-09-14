/**
 * Planetary rings — a flat annulus rendered with the Cassini-derived radial
 * alpha strip (`ring-alpha.png`), lit by the shared sun and shaded by the
 * planet's and the moons' shadows. (Saturn is the only ringed planet in the
 * scene today; the shader is radius- and moon-count-parameterized so the
 * other giants can get ring strips without code changes.)
 *
 * UV convention: the annulus is generated with U = 0 at RING_INNER and
 * U = 1 at RING_OUTER; the shader remaps that into the strip's calibrated
 * pixel range [uRingU0, uRingU1] and samples at V = 0.5 (the strip is a
 * 1-D radial profile). The texture's RGB carries the per-band albedo and
 * its alpha the opacity — both are used.
 *
 * Lighting: the ring is effectively infinitely thin, so both faces receive
 * the same sunlight — intensity from |dot(normal, sun)| (small floor to keep
 * the shadowed face from going fully black at grazing angles).
 *
 * Shadows (same ray-cast math as the planet shader):
 *   – planet disk: sharp circular shadow (ecliptic geometry — the shadow
 *     slides across the rings as the sun's elevation changes).
 *   – moon transits: a moving disk shadow per moon.
 *
 * Blending: standard alpha, depth-write OFF (thin translucent sheet),
 * depth-TEST on — so the planet and moons correctly occlude the far side of
 * the rings while the near side draws over them.
 */
import * as THREE from 'three';

export const ringVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPosition = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const ringFragmentShader = /* glsl */ `
  uniform sampler2D uRingMap;
  uniform float uRingU0;
  uniform float uRingU1;
  uniform vec3 uSunDirection;     // world dir from planet center toward the sun
  uniform vec3 uCenter;           // world position of the planet center
  uniform float uPlanetRadius;    // scene units
  uniform vec3 uMoons[7];         // world positions (MAX_MOONS slots, padded)
  uniform float uMoonRadii[7];    // scene units
  uniform int uMoonCount;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  /** 1.0 = in shadow of the planet disk, 0.0 = clear (ray toward the sun). */
  float planetShadow(vec3 p, vec3 sunDir) {
    vec3 w = uCenter - p;
    float tc = dot(w, sunDir);
    if (tc <= 0.0) return 0.0;
    float perp2 = dot(w, w) - tc * tc;
    if (perp2 >= uPlanetRadius * uPlanetRadius) return 0.0;
    float edge = sqrt(perp2);
    return 1.0 - smoothstep(uPlanetRadius * 0.92, uPlanetRadius * 1.02, edge);
  }

  float moonShadow(vec3 p, vec3 sunDir) {
    float s = 1.0;
    for (int i = 0; i < 7; i++) {
      if (i >= uMoonCount) break;
      vec3 w = uMoons[i] - p;
      float tc = dot(w, sunDir);
      if (tc > 0.0) {
        float perp = sqrt(max(dot(w, w) - tc * tc, 0.0));
        s = min(s, smoothstep(uMoonRadii[i] * 0.85, uMoonRadii[i], perp));
      }
    }
    return s;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 s = normalize(uSunDirection);
    vec4 tex = texture2D(uRingMap, vec2(mix(uRingU0, uRingU1, vUv.x), 0.5));
    // Slightly lift the faint bands (C/E rings) so the full structure reads.
    float a = pow(tex.a, 0.85);
    if (a < 0.004) discard;
    // The Cassini-calibrated strip is deliberately subtle; lift it toward the
    // bright, icy "science-book" look (values may exceed 1 — ACES handles it).
    vec3 albedo = pow(tex.rgb, vec3(0.85)) * 1.5;

    // The ring is a sheet of ice particles, not a flat surface: it stays
    // readable even when the sun lies nearly in the ring plane (the default
    // sun does — |dot| is ~0.07), but shading must still deepen visibly as
    // the sun approaches the plane. Floor 0.35, up to 1.20 at full face-on.
    float face = abs(dot(n, s));
    float light = 0.35 + 0.85 * face;

    float shadow = (1.0 - planetShadow(vWorldPosition, s)) * moonShadow(vWorldPosition, s);

    gl_FragColor = vec4(albedo * light * shadow, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Flat annulus generated in the XZ plane (Y up), centered on the origin.
 * U runs 0→1 from inner to outer radius; V = 0.
 */
export function createRingGeometry(
  inner: number,
  outer: number,
  segments = 256,
): THREE.BufferGeometry {
  const n = segments;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const normals = new Float32Array((n + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const base = i * 2;
    positions[base * 3] = inner * c;
    positions[base * 3 + 1] = 0;
    positions[base * 3 + 2] = inner * s;
    positions[(base + 1) * 3] = outer * c;
    positions[(base + 1) * 3 + 1] = 0;
    positions[(base + 1) * 3 + 2] = outer * s;
    uvs[base * 2] = 0; uvs[base * 2 + 1] = 0;
    uvs[(base + 1) * 2] = 1; uvs[(base + 1) * 2 + 1] = 0;
    normals[base * 3 + 1] = 1;
    normals[(base + 1) * 3 + 1] = 1;
    if (i < n) {
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}
