export const cloudVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const cloudFragmentShader = /* glsl */ `
  uniform sampler2D uCloudTexture;
  uniform vec3 uSunDirection;
  uniform float uOpacity;
  uniform float uSoftFill;
  uniform float uDebugMode;   // 0 normal, 1 normals, 2 sun ramp, 3 white sphere

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 sunDir = normalize(uSunDirection);
    float sunDot = dot(normal, sunDir);
    float dayFactor = smoothstep(-0.03, 0.28, sunDot);

    // Order must match the earth shader (highest threshold first) so the
    // white-sphere validation branch is reachable.
    // Debug isolation modes write straight into gl_FragColor instead of
    // returning early: an early return would skip the tone-mapping and
    // color-space includes at the end of main(), leaving the validation views
    // in a different color space than the render they exist to validate.
    if (uDebugMode > 2.5) {
      // Pure white sphere validation: exact same Sun calc as the surface.
      gl_FragColor = vec4(vec3(max(sunDot, 0.0)), 1.0);
    } else if (uDebugMode > 1.5) {
      vec3 ramp = mix(vec3(0.08, 0.14, 0.55), vec3(1.0, 0.85, 0.35),
                      smoothstep(-0.12, 0.12, sunDot));
      gl_FragColor = vec4(ramp, 1.0);
    } else if (uDebugMode > 0.5) {
      gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
    } else {
      // The satellite cloud map is white-with-alpha: the alpha channel IS the
      // cloud density from the satellite image. Use it directly — no procedural
      // noise modulation (that was producing uniform "cotton ball" coverage).
      float d = texture2D(uCloudTexture, vUv).a;

      // Density remap: suppress faint speckle below ~10% coverage, keep the
      // wispy mid-range values (smoothstep gives a soft knee, not a hard
      // threshold), and never clamp most of the disk to full white.
      float density = smoothstep(0.10, 0.85, d);
      if (density < 0.02) discard;

      // Thin veils are slightly blue-grey; thick cumulus reads near-white.
      // Off-white overall — clouds are not pure emissive white.
      vec3 thin = vec3(0.78, 0.82, 0.88);
      vec3 thick = vec3(0.96, 0.97, 1.0);
      vec3 alb = mix(thin, thick, smoothstep(0.3, 0.95, d));

      // Subtle sunlight response: brightness follows the same hemisphere
      // illumination as the surface (same shared Sun direction).
      float daylight = max(sunDot, 0.0);
      // Same subtle Soft Daylight fill as the surface: lifts the day-side band
      // away from the sub-solar point only, keeping cloud depth and shading.
      vec3 dayCol = alb * (0.5 + 0.5 * daylight + uSoftFill * 0.5 * (1.0 - daylight));

      // Night side: very dark, faint cool ambient only — no self-glow.
      vec3 nightCol = alb * vec3(0.02, 0.025, 0.04);
      vec3 col = mix(nightCol, dayCol, dayFactor);

      // Warm terminator tint (sunrise/sunset on cloud tops), kept subtle.
      float term = (1.0 - smoothstep(0.0, 0.35, abs(sunDot))) * dayFactor;
      col += vec3(0.28, 0.13, 0.04) * term * 0.4;

      // Thin clouds stay semi-transparent; night-side clouds dim but remain
      // faintly visible against city lights.
      float alpha = density * uOpacity * mix(0.35, 1.0, dayFactor);
      gl_FragColor = vec4(col, alpha);
    }

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
