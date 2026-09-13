/**
 * Saturn body shader — banded gas-giant albedo lit by the shared sun, with
 * structured ring shadows and moon transit shadows, plus the standard debug
 * modes (0 none, 1 normals, 2 albedo ramp, 3 flat white) so the texture can
 * be inspected exactly like the Earth/Moon.
 *
 * World-space lighting (identical convention to `earth/shaders/earth.ts` and
 * `moon/shaders/moon.ts`): the sun direction is computed per frame from the
 * sun's world position, so the terminator tracks the Sun Lighting controls
 * (Full Daylight / Auto sun included) with zero extra cost.
 *
 * Ring shadow: if the point and the sun are on opposite sides of the ring
 * plane, sample the same radial alpha profile the rings render with (v = 0.5)
 * at the point's projected radius → the Cassini division and Encke gap cast
 * their own shadow bands, and the shadow is invisible when the sun is below
 * the ring plane (edge-on) — physically correct at both limits.
 *
 * Tonemapping / color-space chunks are included because `EarthScene` renders
 * through EffectComposer into a HalfFloat target (a no-op there — OutputPass
 * owns conversion — but correct if the pipeline ever changes).
 */

export const saturnPlanetVertexShader = /* glsl */ `
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

export const saturnPlanetFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDirection;     // world dir from Saturn center toward the sun
  uniform vec3 uCenter;           // world position of Saturn's center
  uniform vec3 uAxis;             // world unit vector along Saturn's spin axis
  uniform float uRingInner;       // scene units
  uniform float uRingOuter;       // scene units
  uniform sampler2D uRingMap;     // the 2048px radial alpha strip (1-D profile)
  uniform float uRingU0;          // first non-transparent column / 2048
  uniform float uRingU1;          // last non-transparent column / 2048
  uniform vec3 uMoons[7];         // world positions (index order = SATURN_MOONS)
  uniform float uMoonRadii[7];    // scene units (match the rendered moons)
  uniform int uDebugMode;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  /** Structured ring shadow (1.0 = lit, →0 = in a ring band's shadow). */
  float ringShadow(vec3 pWorld, vec3 sunDir) {
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

  /** Moon transit shadows (sharp disk shadows, min over all seven).
   *  NOTE: smoothstep(e0, e1, x) is undefined for e0 > e1 — the edges must
   *  stay ascending: 0 deep inside the shadow, 1 outside, soft rim between. */
  float moonShadow(vec3 pWorld, vec3 sunDir) {
    float s = 1.0;
    for (int i = 0; i < 7; i++) {
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

    if (uDebugMode == 1) {
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    } else if (uDebugMode == 2) {
      gl_FragColor = vec4(vUv, 0.0, 1.0);
    } else if (uDebugMode == 3) {
      gl_FragColor = vec4(1.0);
    } else {
      vec3 albedo = texture2D(uMap, vUv).rgb;
      float sunDot = dot(n, s);
      // A hazy atmosphere softens the terminator a touch vs. bare rock.
      float day = smoothstep(-0.05, 0.12, sunDot);
      float light = max(sunDot, 0.0) * ringShadow(vWorldPosition, s)
                    * moonShadow(vWorldPosition, s);
      // Subtle limb darkening (gas giants compress their bands at the limb).
      vec3 v = normalize(cameraPosition - vWorldPosition);
      float limb = 1.0 - 0.10 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
      // Saturn's hazy atmosphere scatters more earthshine-style fill than the
      // Moon's bare regolith — keep the night limb readable (4% not 1.5%).
      vec3 color = albedo * (light * limb + 0.04 * (1.0 - day));
      gl_FragColor = vec4(color, 1.0);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
