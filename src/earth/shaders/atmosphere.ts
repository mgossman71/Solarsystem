export const atmosphereVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const atmosphereFragmentShader = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uIntensity;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 sunDir = normalize(uSunDirection);

    float ndv = max(dot(normal, viewDir), 0.0);
    float fresnel = pow(1.0 - ndv, 2.2);   // limb emphasis (0 at center, 1 at limb)
    float sunDot = dot(normal, sunDir);

    // Day-side blue Rayleigh scattering (only on the lit side)
    float day = smoothstep(-0.05, 0.65, sunDot);
    vec3 dayColor = vec3(0.30, 0.55, 1.0);

    // Warm scattering around the terminator (sunrise / sunset band)
    float term = (1.0 - smoothstep(0.0, 0.35, abs(sunDot))) * max(day, 0.15);
    vec3 warmColor = vec3(0.90, 0.50, 0.30);

    // Backlit rim: bright blue crescent when the Sun is behind the planet
    float back = smoothstep(-0.1, -0.9, sunDot);
    vec3 backColor = vec3(0.45, 0.70, 1.0);

    vec3 color = dayColor * day * 0.7
               + warmColor * term * 0.55
               + backColor * back * 1.25;

    // Everything scales with the limb factor so it never glows uniformly
    // across the whole disk — it concentrates at the atmosphere edge.
    float intensity = fresnel * uIntensity;
    gl_FragColor = vec4(color * intensity, intensity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
