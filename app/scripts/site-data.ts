// Snapshot of a project for the static site: `bun app/scripts/site-data.ts <project>`.
// Writes projects/<id>/site/: inputs.json (what /api/project answers), manifest.json (hashes of the sources,
// checked by vite.site.config.ts) and <id>.mp3 (the mix; git ignores it). Needs Lyric-Sync and ffmpeg: run it
// when the video.json, the lyrics, the timing or the mix change, commit inputs.json and manifest.json, and
// upload the MP3 to the release `site-audio` (the CI downloads it): `gh release upload site-audio <file> --clobber`.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectInputs } from './inputs';
import { projectDir } from './project';
import { siteDir, sourceHashes, type SiteManifest } from './site-sources';

/** Tag of the release that holds the audio of the site. */
const AUDIO_RELEASE = 'site-audio';

const id = process.argv[2];
if (!id) {
  console.error('usage: bun app/scripts/site-data.ts <project>');
  process.exit(2);
}
const dir = projectDir(id);
const out = siteDir(dir);
mkdirSync(out, { recursive: true });
const audioFile = `${id}.mp3`;

let mixPath = '';
const inputs = await projectInputs(id, dir, {
  mix: (song) => {
    mixPath = path.isAbsolute(song.prompt.mixPath) ? song.prompt.mixPath : path.resolve(dir, song.prompt.mixPath);
    return 'data/audio.mp3';
  },
  font: (rel) => {
    throw new Error(`video/assets/fonts/${rel}: the site snapshot does not carry project fonts yet`);
  },
});

const audio = path.join(out, audioFile);
const ff = Bun.spawnSync(['ffmpeg', '-y', '-v', 'error', '-i', mixPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', audio]);
if (ff.exitCode !== 0) {
  console.error(`ffmpeg failed on ${mixPath}:\n${ff.stderr.toString()}`);
  process.exit(1);
}

writeFileSync(path.join(out, 'inputs.json'), JSON.stringify(inputs));
const manifest: SiteManifest = {
  project: id,
  sources: sourceHashes(dir),
  audio: {
    file: audioFile,
    duration: inputs.timing.duration,
    sha256: createHash('sha256').update(readFileSync(audio)).digest('hex'),
    release: AUDIO_RELEASE,
  },
};
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const mb = (f: string) => (statSync(path.join(out, f)).size / 1048576).toFixed(2);
console.log(`projects/${id}/site: inputs.json ${mb('inputs.json')} MB, ${audioFile} ${mb(audioFile)} MB, ${Object.keys(manifest.sources).length} sources hashed`);
