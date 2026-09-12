// ---------------------------------------------------------------------------
// MOON SHADERS
//
// The Moon is lit by a TRUE POINT SOURCE: its uSunDirection uniform is set
// per-frame (in EarthScene.animate()) via sunDirectionToward(sunWorldPos,
// moonPosition, …). The Moon orbits ~10–60 units from the Sun's world position
// while Earth sits at the origin, so its light direction differs slightly from
// Earth's — exactly what yields correct, screen-consistent lunar phases (a
// shared parallel-ray direction would show the identical phase on both bodies,
// which is physically wrong).
//
// Deliberate absences (per design): no atmosphere, no sunset band, no soft
// fill, negligible night ambient. The terminator is sharp — there is no air to
// scatter light.
//
// Relief: no bump/height asset is shipped, but lunar albedo is a usable height
// proxy — bright highlands and ray craters are topographically high, dark
// maria sit low. The fragment shader samples that luminance field in a tangent
// basis and perturbs the normal so the directional Sun carves real crater rims
// and mare floors from the same real lunar imagery.
// ---------------------------------------------------------------------------

export const moonVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;

    // Uniform scale on the moon transform keeps this world normal valid.
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const moonFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec3 uSunDirection;
  uniform float uBumpScale;
  uniform float uDebugMode; // 0: normal, 1: normals, 2: sun ramp, 3: white sphere

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  // Albedo luminance as a height proxy (documented approximation derived
  // from real lunar imagery; see section comment above).
  float sampleHeight(vec2 uv) {
    vec3 c = texture2D(uTexture, uv).rgb;
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 sunDir = normalize(uSunDirection);
    float sunDot = dot(normal, sunDir);

    // Debug modes (same palette as Earth for parity).
    if (uDebugMode > 2.5) {
      gl_FragColor = vec4(vec3(max(sunDot, 0.0)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    if (uDebugMode > 1.5) {
      vec3 ramp = mix(vec3(0.08, 0.14, 0.55), vec3(1.0, 0.85, 0.35), smoothstep(-0.12, 0.12, sunDot));
      gl_FragColor = vec4(ramp, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    if (uDebugMode > 0.5) {
      gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }

    // Tangent-space relief from the luminance height proxy.
    vec3 up = (abs(normal.y) > 0.99) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(up, normal));
    vec3 bitangent = cross(normal, tangent);
    float e = 0.0025;
    float hR = sampleHeight(vec2(fract(vUv.x + e), vUv.y));
    float hL = sampleHeight(vec2(fract(vUv.x - e), vUv.y));
    float hT = sampleHeight(vec2(vUv.x, min(vUv.y + e, 0.999)));
    float hB = sampleHeight(vec2(vUv.x, max(vUv.y - e, 0.001)));
    vec3 relNormal = normalize(normal
      - tangent * (hR - hL) * uBumpScale
      - bitangent * (hT - hB) * uBumpScale);
    float relSunDot = dot(relNormal, sunDir);

    // Dry regolith: diffuse-only. Sharp terminator: small smoothstep just to
    // avoid aliasing — no warm sunset band, no atmospheric scatter.
    vec3 albedo = texture2D(uTexture, vUv).rgb;
    float day = smoothstep(-0.015, 0.06, relSunDot);
    // Night side is genuinely dark; a whisper of earthshine keeps it out of
    // pure black (1.5% albedo).
    vec3 color = albedo * (max(relSunDot, 0.0) * day + 0.015 * (1.0 - day));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
