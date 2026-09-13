import * as THREE from 'three';

/** Which celestial body the camera is currently focused on. */
export type Focus = 'earth' | 'moon' | 'sun' | 'system' |
  'saturn' | 'mimas' | 'enceladus' | 'tethys' | 'dione' | 'rhea' | 'titan' | 'iapetus';

/** The seven individually focusable Saturn moons (in orbit order, near → far). */
export const SATURN_MOON_FOCUS: readonly Focus[] = [
  'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus',
] as const;

export function isSaturnFocus(f: Focus): boolean {
  return f === 'saturn' || (SATURN_MOON_FOCUS as readonly string[]).includes(f);
}

export function isSaturnMoonFocus(f: Focus): boolean {
  return (SATURN_MOON_FOCUS as readonly string[]).includes(f);
}

/** Shared orbit clock mode: paused, slowed ("Visualized"), or true sidereal rate. */
export type OrbitMode = 'paused' | 'visualized' | 'realtime';

/** Exploration scale vs. true relative size/distance scale. */
export type ScaleMode = 'explore' | 'real';

/** Camera framing for a focus target (position + orbit clamps). */
export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
}