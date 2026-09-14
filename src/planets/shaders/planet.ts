/**
 * Planet body shader — generic version of the old Saturn shader: textured
 * albedo lit by the shared sun, structured ring shadows (only for planets
 * that HAVE rings), moon transit shadows, per-planet limb darkening and
 * night-side fill, plus the standard debug modes.
 *
 * World-space lighting (identical convention to `earth/shaders/earth.ts` and
 * `moon/shaders/moon.ts`): the sun direction is computed per frame from the
 * sun's world position, so the terminator tracks the Sun Lighting controls
 * (Full Daylight / Auto sun included) with zero extra cost.
 *
 * The moon shadow arrays are sized MAX_MOONS (7) for every planet; the
 * fragment loop stops at `uMoonCount` so smaller systems never sample
 * padding.
 */

export const planetVertexShader = /* glsl */ `
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

export const planetFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDirection;     // world dir from planet center toward the sun
  uniform vec3 uCenter;           // world position of the planet center
  uniform vec3 uAxis;             // world unit vector along the spin axis
  uniform float uRingInner;       // scene units (0 = no rings)
  uniform float uRingOuter;       // scene units (0 = no rings)
  uniform sampler2D uRingMap;     // radial alpha strip (1-D profile)
  uniform float uRingU0;
  uniform float uRingU1;
  uniform vec3 uMoons[7];         // world positions (MAX_MOONS slots, padded)
  uniform float uMoonRadii[7];    // scene units (match the rendered moons)
  uniform int uMoonCount;         // actual moon count (loop bound)
  uniform float uFill;            // night-side fill (haze vs bare rock)
  uniform float uLimb;            // limb-darkening strength
  uniform int uDebugMode;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  /** Structured ring shadow (1.0 = lit, →0 = in a ring band's shadow).
   *  Inert for ringless planets (uRingOuter ≤ uRingInner). */
  float ringShadow(vec3 pWorld, vec3 sunDir) {
    if (uRingOuter <= uRingInner) return 1.0;
    vec3 rel = pWorld - uCenter;
    float h = dot(rel, uAxis);
    if (h * dot(sunDir, uAxis) > 0.0) return 1.0; // sun & point on same side
    vec3 proj = rel - uAxis * h;                  // projection onto ring plane
    float r = length(proj);
    if (r < uRingInner || r > uRingOuter) return 1.0;
    float f = (r - uRingInner) / (uRingOuter - uRingInner);
    float a = texture2D(uRingMap, vec2(mix(uRingU0, uRingU1, f), 0.5)).a;
    return 1.0 - a * 0.88;
  }

  /** Moon transit shadows (sharp disk shadows, min over the system's moons).
   *  NOTE: smoothstep(e0, e1, x) is undefined for e0 > e1 — the edges must
   *  stay ascending: 0 deep inside the shadow, 1 outside, soft rim between. */
  float moonShadow(vec3 pWorld, vec3 sunDir) {
    float s = 1.0;
    for (int i = 0; i < 7; i++) {
      if (i >= uMoonCount) break;
      vec3 w = uMoons[i] - pWorld;     // point → moon
      float tc = dot(w, sunDir);       // > 0: moon lies between point & sun
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

    // Debug modes share the Earth/Moon convention exactly (same panel
    // buttons, same meaning on every body): 2 = sun ramp, 3 = white × NdotL
    // with the EXACT production sun calc.
    if (uDebugMode == 1) {
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    } else if (uDebugMode == 2) {
      vec3 ramp = mix(vec3(0.08, 0.14, 0.55), vec3(1.0, 0.85, 0.35),
                      smoothstep(-0.12, 0.12, dot(n, s)));
      gl_FragColor = vec4(ramp, 1.0);
    } else if (uDebugMode == 3) {
      gl_FragColor = vec4(vec3(max(dot(n, s), 0.0)), 1.0);
    } else {
      vec3 albedo = texture2D(uMap, vUv).rgb;
      float sunDot = dot(n, s);
      // A hazy atmosphere softens the terminator a touch vs. bare rock.
      float day = smoothstep(-0.05, 0.12, sunDot);
      float light = max(sunDot, 0.0) * ringShadow(vWorldPosition, s)
                    * moonShadow(vWorldPosition, s);
      // Limb darkening (gas giants compress their bands at the limb).
      vec3 v = normalize(cameraPosition - vWorldPosition);
      float limb = 1.0 - uLimb * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
      // Per-planet night-side fill keeps the dark limb readable.
      vec3 color = albedo * (light * limb + uFill * (1.0 - day));
      gl_FragColor = vec4(color, 1.0);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
