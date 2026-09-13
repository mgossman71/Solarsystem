export const starVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aBrightness;
  varying float vBrightness;
  uniform float uScale;   // set in StarField.ts from the shell radius

  void main() {
    vBrightness = aBrightness;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const starFragmentShader = /* glsl */ `
  varying float vBrightness;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * vBrightness;
    gl_FragColor = vec4(vec3(0.9, 0.92, 1.0), alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
