import * as THREE from 'three';
import { STAR_FIELD_RADIUS_MIN, STAR_FIELD_RADIUS_SPAN } from '../config/sceneScale';

// Point-size scale for the star vertex shader (its `uScale` uniform). A point
// sprite renders `aSize * (uScale / shellRadius)` pixels — the divisor is the
// star's OWN shell radius (see the vertex shader), so the size is independent
// of camera position and the skybox reads as infinitely distant. For a fixed
// world size uScale must grow with the radius the stars sit at. 600.0 was
// hand-tuned for the original 200–350 shell (mean ≈ 275); deriving it from the
// CURRENT shell mean keeps every star the same on-screen size and
// self-corrects if the band moves again (rather than silently shrinking as the
// shell was pushed out past the Saturn moons).
const STAR_SHELL_MEAN = STAR_FIELD_RADIUS_MIN + STAR_FIELD_RADIUS_SPAN / 2;
const STAR_POINT_SCALE = 600 * (STAR_SHELL_MEAN / 275);
import { starVertexShader, starFragmentShader } from './shaders/starfield';

/**
 * Build the additive star-sprite backdrop and add it to the scene.
 *
 * Stars are placed on a far shell (STAR_FIELD_RADIUS_*, ~12000–13000) — beyond
 * the farthest body AND beyond the highest (top-down System) camera position,
 * so they always sit behind every body and read as an infinitely distant
 * skybox, never between the camera and a planet. (Additive points can't be
 * occluded by the transparent rings, so stars in front of Saturn's outer moons
 * would otherwise show through them; and if the shell sat INSIDE the top-down
 * camera, the whole star sphere would render as a giant ball around the
 * planets — see sceneScale.ts.) `starCount` is tier-driven (20k desktop / 13k
 * balanced / 8.5k performance): the stars are additive point sprites, so the
 * count is a direct fill-rate cost.
 */
export function createStarField(scene: THREE.Scene, starCount: number): THREE.Points {
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const brightness = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = STAR_FIELD_RADIUS_MIN + Math.random() * STAR_FIELD_RADIUS_SPAN;
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
    sizes[i] = 0.5 + Math.random() * 1.5;
    brightness[i] = 0.3 + Math.random() * 0.7;
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  starGeometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

  const starMaterial = new THREE.ShaderMaterial({
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    uniforms: {
      uScale: { value: STAR_POINT_SCALE },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const starField = new THREE.Points(starGeometry, starMaterial);
  starField.renderOrder = 0; // explicit transparent order: stars < clouds < atmosphere
  scene.add(starField);
  return starField;
}