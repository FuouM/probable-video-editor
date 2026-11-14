// Shared helpers of the bridge world: the fbm noise of the terrain and of the moon disc, and the colour mix of the looks and the disc.
import * as THREE from 'three';
import { valueNoise } from '@pve/engine/frost';

/** Three octaves of value noise, range 0..1. */
export const fbm = (x: number, z: number) => 0.55 * valueNoise(x, z) + 0.28 * valueNoise(2.1 * x + 7, 2.1 * z + 3) + 0.17 * valueNoise(4.3 * x - 5, 4.3 * z + 11);

/** Hex colour mix in linear space. */
export function mix(a: string, b: string, u: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), u).getHexString()}`;
}
