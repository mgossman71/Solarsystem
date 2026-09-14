/**
 * Haze-moon shader — the grayscale albedo map tinted by a thick atmosphere
 * (Titan's orange smog is the only one in use today), with a soft limb glow
 * (the hazy shell extends the disk slightly past the solid surface) and a
 * very soft terminator (optically thick haze).
 *
 * Same world-space lighting convention as the rest of the app; the mesh is
 * rendered `shell`% larger than the true body radius (see `PlanetSystem`)
 * to suggest the atmospheric shell without a separate volume.
 */

export const hazeVertexShader = /* glsl */ `
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

export const hazeFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec3 uSunDirection;   // world dir from the moon toward the sun
  uniform vec3 uTint;           // atmospheric tint
  uniform vec3 uRimColor;       // hazy limb color

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 s = normalize(uSunDirection);
    vec3 v = normalize(cameraPosition - vWorldPosition);

    vec3 albedo = texture2D(uTexture, vUv).rgb * uTint;
    float sunDot = dot(n, s);
    // Optically thick atmosphere: no crisp terminator.
    float day = smoothstep(-0.08, 0.15, sunDot);
    float light = max(sunDot, 0.0) * day + 0.02 * (1.0 - day);

    // Hazy shell rim — strongest on the limb, brighter toward the lit side.
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.2);
    float daySide = clamp(sunDot * 0.5 + 0.5, 0.0, 1.0);
    vec3 rim = uRimColor * fres * (0.35 + 0.65 * daySide) * 0.75;

    gl_FragColor = vec4(albedo * light + rim, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
