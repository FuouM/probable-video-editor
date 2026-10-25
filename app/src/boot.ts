// Page entry. The project palette (video/assets/palette.json) must be in place before the engine modules
// load: GLSL_COMMON bakes the colours in when its module loads. So this module imports only the palette and
// the inputs, and loads the app after them. A failed fetch is shown by the app (loadProject sees it too).
import { setPalette } from '@pve/engine/palette';
import { fetchInputs } from './inputs';

try {
  const inputs = await fetchInputs();
  if (inputs.assets.palette) setPalette(inputs.assets.palette);
} catch {
  // the app reports the error
}
await import('./main');
