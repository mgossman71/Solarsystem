export const earthVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const earthFragmentShader = /* glsl */ `
  uniform sampler2D uDayTexture;
  uniform sampler2D uNightTexture;
  uniform sampler2D uCloudTexture;
  uniform vec3 uSunDirection;
  uniform float uOceanSpecular;
  uniform float uNightIntensity;
  uniform float uSoftFill;
  uniform float uCloudShadowStrength;
  uniform float uCloudUVOffset;
  uniform float uDebugMode;   // 0 normal, 1 normals, 2 sun ramp, 3 white sphere

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 sunDir = normalize(uSunDirection);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // Hemisphere illumination: the Sun is infinitely distant, so lighting is
    // purely dot(surfaceNormal, sunDir) — parallel directional rays. A smooth
    // terminator band replaces the mathematically hard line. This calculation
    // does not depend on clouds, atmosphere or anything else.
    float sunDot = dot(normal, sunDir);
    float dayFactor = smoothstep(-0.03, 0.28, sunDot);

    // ---- Debug isolation modes ----
    // Mode 3 = PURE WHITE SPHERE validation: ignores every texture and renders
    // white * NdotL with the exact production Sun calculation. A correct setup
    // shows one clean lit hemisphere, one dark hemisphere, a smooth terminator,
    // and NO fixed dark patch tied to geography — the Sun sweep moves the lit
    // hemisphere freely over the entire sphere.
    //
    // Debug isolation modes write straight into gl_FragColor instead of
    // returning early: an early return would skip the tone-mapping and
    // color-space includes at the end of main(), leaving the validation views
    // in a different color space than the render they exist to validate.
    if (uDebugMode > 2.5) {
      gl_FragColor = vec4(vec3(max(dot(normal, sunDir), 0.0)), 1.0);
    } else if (uDebugMode > 1.5) {
      vec3 ramp = mix(vec3(0.08, 0.14, 0.55), vec3(1.0, 0.85, 0.35),
                      smoothstep(-0.12, 0.12, sunDot));
      gl_FragColor = vec4(ramp, 1.0);
    } else if (uDebugMode > 0.5) {
      gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
    } else {
      // ---- Day side ----
      // uDayTexture is an unlit, evenly illuminated albedo map (no baked
      // directional lighting, no composite night imagery) — safe to multiply by
      // the shader's own directional Sun light without double shading.
      vec3 raw = texture2D(uDayTexture, vUv).rgb;
      float lum = dot(raw, vec3(0.299, 0.587, 0.114));
      // Ocean mask (used only for the specular sheen): open ocean in this albedo
      // map is strongly blue-dominant with low luminance; land is not.
      float oceanMask = (1.0 - smoothstep(0.04, 0.28, lum))
                      * smoothstep(0.8, 1.2, raw.b / max(raw.r, 0.001));
      vec3 dayColor = raw;

      vec3 nightColor = texture2D(uNightTexture, vUv).rgb;
      nightColor = pow(nightColor, vec3(0.9)) * uNightIntensity;

      // Gentle sub-solar falloff: brightest near the sub-solar point, easing to
      // the terminator. Broad and smooth — never a hotspot or a spotlight.
      float sunFacing = clamp(sunDot, 0.0, 1.0);
      // Soft Daylight (optional studio fill): lifts ONLY the shadowed day-side
      // band (1 - sunFacing), leaving the sub-solar point untouched — a subtle
      // rim-lift that keeps the spherical shading, never a flat wash.
      float dayShade = 0.85 + 0.15 * sunFacing + uSoftFill * (1.0 - sunFacing);
      vec3 dayLit = dayColor * dayShade;

      vec3 color = mix(nightColor, dayLit, dayFactor);

      // Broad, soft ocean glint (wide lobe, low intensity — reads as a sheen)
      vec3 halfDir = normalize(sunDir + viewDir);
      float spec = pow(max(dot(normal, halfDir), 0.0), 36.0);
      color += spec * oceanMask * dayFactor * uOceanSpecular * vec3(0.75, 0.87, 1.0);

      // Subtle cloud shadows: sample the *same* cloud coverage that the cloud
      // layer renders, at the cloud layer's current UV. Cloud drift is a pure
      // Y-axis rotation, which maps exactly to a u-offset in equirectangular
      // space, so the shadow tracks the clouds. Zeroed when clouds are hidden.
      if (uCloudShadowStrength > 0.0) {
        float cloudDensity = texture2D(uCloudTexture,
          vec2(fract(vUv.x - uCloudUVOffset), vUv.y)).a;
        color *= 1.0 - uCloudShadowStrength * smoothstep(0.2, 0.85, cloudDensity) * dayFactor;
      }

      // Gentle limb darkening (thin atmosphere at the edge)
      float fresnel = 1.0 - max(dot(normal, viewDir), 0.0);
      color *= 1.0 - fresnel * 0.12;

      // Warm glow at the terminator (sunrise / sunset band)
      float terminator = (1.0 - smoothstep(0.0, 0.30, abs(sunDot))) * dayFactor;
      vec3 sunsetColor = vec3(0.82, 0.44, 0.16);
      color += sunsetColor * terminator * 0.10;

      gl_FragColor = vec4(color, 1.0);
    }

    // Tone-mapping + output color-space conversion. Custom ShaderMaterials do
    // NOT get these injected automatically — without them the linear output is
    // written verbatim into an sRGB-expecting framebuffer and the renderer's
    // toneMapping/toneMappingExposure settings are silently ignored.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
