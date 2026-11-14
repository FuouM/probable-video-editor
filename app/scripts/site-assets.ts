// Downloads the video assets of every project that keeps them in a release (video/assets.json) and checks each file
// against its SHA-256: `bun app/scripts/site-assets.ts`. The Pages CI runs it before the build, which hashes
// video/assets/. It imports only the assets module of the CLI: the CLI entry needs Lyric-Sync, which the CI does not have.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MANIFEST_FILE, fetchAssets } from '../../packages/cli/src/assets';

const projects = path.resolve(import.meta.dir, '../../projects');
for (const id of readdirSync(projects).sort()) {
  const dir = path.join(projects, id);
  if (!existsSync(path.join(dir, MANIFEST_FILE))) continue;
  const r = await fetchAssets({ id, dir });
  console.log(`${id}: ${r.present} present, ${r.fetched.length} fetched`);
}
