// Page entry. As in ../src/boot.ts, the project palette must be in place before the engine modules load.
import { setPalette } from '@pve/engine/palette';
import { fetchInputs, projectId } from '../src/inputs';

// without ?project= the page only offers the videos: it loads no project, so it applies no palette
if (projectId()) {
  try {
    const inputs = await fetchInputs();
    if (inputs.assets.palette) setPalette(inputs.assets.palette);
  } catch {
    // the player reports the error
  }
}
// Dynamic on purpose: a static import is hoisted and would load the engine (GLSL_COMMON bakes the palette in) first.
await import('./player');
