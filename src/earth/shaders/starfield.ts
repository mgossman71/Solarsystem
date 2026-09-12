export const starVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aBrightness;
  varying float vBrightness;

  void main() {
    vBrightness = aBrightness;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (600.0 / -mvPosition.z); // 600: stars sit at 200–350
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const starFragmentShader = /* glsl */ `
  varying float vBrightness;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, dist) * vBrightness;
    gl_FragColor = vec4(vec3(0.9, 0.92, 1.0), alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
