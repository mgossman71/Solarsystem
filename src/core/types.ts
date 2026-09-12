import * as THREE from 'three';

/** Which celestial body the camera is currently focused on. */
export type Focus = 'earth' | 'moon' | 'sun' | 'system';

/** Moon orbit mode: paused, slowed ("Visualized"), or true sidereal rate. */
export type MoonOrbitMode = 'paused' | 'visualized' | 'realtime';

/** Exploration scale vs. true relative size/distance scale. */
export type ScaleMode = 'explore' | 'real';

/** Camera framing for a focus target (position + orbit clamps). */
export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
}