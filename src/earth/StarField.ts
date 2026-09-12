import * as THREE from 'three';
import { STAR_FIELD_RADIUS_MIN, STAR_FIELD_RADIUS_SPAN } from '../config/sceneScale';
import { starVertexShader, starFragmentShader } from './shaders/starfield';

/**
 * Build the additive star-sprite backdrop and add it to the scene.
 *
 * Stars are placed on a shell 200–350 units out — beyond the Real-Scale Moon
 * orbit (60.3) — so they always sit behind both bodies and read as an infinitely
 * distant skybox, never between the camera and the Moon. `starCount` is
 * tier-driven (12k desktop / 8k balanced / 5k performance): the stars are
 * additive point sprites, so the count is a direct fill-rate cost.
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
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const starField = new THREE.Points(starGeometry, starMaterial);
  starField.renderOrder = 0; // explicit transparent order: stars < clouds < atmosphere
  scene.add(starField);
  return starField;
}