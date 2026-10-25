// Page entry. As in ../src/boot.ts, the project palette must be in place before the engine modules load.
import { setPalette } from '@pve/engine/palette';
import { fetchInputs } from '../src/inputs';

try {
  const inputs = await fetchInputs();
  if (inputs.assets.palette) setPalette(inputs.assets.palette);
} catch {
  // the player reports the error
}
// Dynamic on purpose: a static import is hoisted and would load the engine (GLSL_COMMON bakes the palette in) first.
await import('./player');
