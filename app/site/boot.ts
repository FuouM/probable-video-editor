// Page entry. The SoulWindow runtime (theme, accent, density) starts first; it loads no engine module.
// As in ../src/boot.ts, the project palette must be in place before the engine modules load.
import '../src/ui/soulwindow';
import { setPalette } from '@pve/engine/palette';
import { fetchInputs, projectId } from '../src/inputs';
import { DOWNLOAD, failedUrls } from './failure';

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
try {
  await import('./player');
} catch (e) {
  console.error(e);
  if (DOWNLOAD.test(String(e))) void window.pveLoadFailure(failedUrls(String(e)));
  else throw e;
}
