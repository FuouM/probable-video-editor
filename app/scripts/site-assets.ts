// Downloads the video assets of every project that keeps them in a release (video/assets.json) and checks each file
// against its SHA-256: `bun app/scripts/site-assets.ts`. The Pages CI runs it before the build, which hashes
// video/assets/. It imports only the assets module of the CLI and the project list of @pve/core: the CLI entry needs
// Lyric-Sync, which the CI does not have.
import { listProjects, PROJECTS } from '@pve/core/projects';
import path from 'node:path';
import { MANIFEST_FILE, fetchAssets } from '../../packages/cli/src/assets';

for (const id of listProjects(MANIFEST_FILE)) {
  const r = await fetchAssets({ id, dir: path.join(PROJECTS, id) });
  console.log(`${id}: ${r.present} present, ${r.fetched.length} fetched`);
}
