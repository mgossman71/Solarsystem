import * as THREE from 'three';

/** Which celestial body the camera is currently focused on.
 *  `'system'` = the top-down overview of the whole solar system (the default
 *  starting view; Sun at the origin, every planet on its orbit below). */
export type Focus = 'system' |
  'earth' | 'moon' | 'sun' |
  // planets (orbit order, Pluto last)
  'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto' |
  // moons (Mars, Jupiter, Saturn, Uranus, Neptune, Pluto — in orbit order)
  'phobos' | 'deimos' |
  'amalthea' | 'io' | 'europa' | 'ganymede' | 'callisto' |
  'mimas' | 'enceladus' | 'tethys' | 'dione' | 'rhea' | 'titan' | 'iapetus' |
  'miranda' | 'ariel' | 'umbriel' | 'titania' | 'oberon' |
  'triton' | 'nereid' |
  'charon' | 'styx' | 'nix' | 'kerberos' | 'hydra';

/** All focusable planets, in orbit order (source: `src/planets/registry`). */
export const PLANET_FOCUS: readonly Focus[] = [
  'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
] as const;

/** Every individually focusable moon (in orbit order per planet). */
export const MOON_FOCUS: readonly Focus[] = [
  'phobos', 'deimos',
  'amalthea', 'io', 'europa', 'ganymede', 'callisto',
  'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus',
  'miranda', 'ariel', 'umbriel', 'titania', 'oberon',
  'triton', 'nereid',
  'charon', 'styx', 'nix', 'kerberos', 'hydra',
] as const;

export function isPlanetFocus(f: Focus): boolean {
  return (PLANET_FOCUS as readonly string[]).includes(f);
}

export function isPlanetMoonFocus(f: Focus): boolean {
  return (MOON_FOCUS as readonly string[]).includes(f);
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