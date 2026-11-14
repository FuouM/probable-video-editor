// Shared easing curves of sardine (u is clamped to 0..1 first).
import { clamp01 } from '@pve/engine/util';

/** Cubic ease-out: 1 - (1 - u)^3. */
export const easeOut3 = (u: number) => 1 - (1 - clamp01(u)) ** 3;

/** The ease of drags (the cursor and the window it holds use the same one): half smoothstep, half linear. */
export function dragEase(u: number): number {
  const x = clamp01(u);
  return x * x * (3 - 2 * x) * 0.5 + x * 0.5;
}
