export const sunVertexShader = /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vPosW = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `;

export const sunFragmentShader = /* glsl */ `
        uniform sampler2D uMap;
        uniform float uHasMap;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;

        float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float sNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = sHash(i);
          float b = sHash(i + vec2(1.0, 0.0));
          float c = sHash(i + vec2(0.0, 1.0));
          float d = sHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float sFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * sNoise(p); p *= 2.03; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 N = normalize(vNormalW);
          vec3 V = normalize(cameraPosition - vPosW);
          float ndv = clamp(dot(N, V), 0.0, 1.0);

          // Real solar disk (SDO 4K) with a procedural granulation fallback.
          vec3 tex = texture2D(uMap, vUv).rgb;
          vec3 procedural = mix(vec3(1.0, 0.52, 0.14), vec3(1.0, 0.92, 0.62),
                                sFbm(vUv * vec2(26.0, 13.0)));
          vec3 base = mix(procedural, tex, uHasMap);

          // Slowly drifting granulation — convection cells on the surface.
          float gran = sFbm(vUv * vec2(48.0, 24.0) + vec2(uTime * 0.005, uTime * 0.003));
          base *= 0.92 + 0.16 * gran;

          // Limb darkening: the solar disk dims measurably toward the limb.
          float limb = 0.42 + 0.58 * pow(ndv, 0.5);

          gl_FragColor = vec4(base * limb * 1.55, 1.0);

          // Parity with the other scene shaders (Earth, cloud, atmosphere,
          // starfield, Moon). No-ops while rendering into the composer's
          // render target (tone-map + color space apply there via OutputPass),
          // but keeps every shader consistent if anything ever renders
          // straight to the screen.
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `;
