// Snapshot of a project for the static site: `bun app/scripts/site-data.ts <project> [--keep-audio]`.
// Writes projects/<id>/site/: inputs.json (what /api/project answers), subtitles.json (scripts/subtitles.ts),
// thumbnail.jpg (from out/thumbnail.png, when that exists), manifest.json (hashes of the sources, checked by
// vite.site.config.ts) and <id>.mp3 (the mix; git ignores it). Needs Lyric-Sync and ffmpeg: run it when the
// video.json, the lyrics, the lyric map, the timing or the mix change, commit the JSON files and the thumbnail,
// and upload the MP3 to the release `site-audio` (the CI downloads it): `gh release upload site-audio <file> --clobber`.
// --keep-audio does not encode the mix again: it keeps the MP3 and the audio entry of the manifest (the file must
// still be the one the manifest names), so the release asset stays valid.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectInputs } from './inputs';
import { projectDir } from './project';
import { siteDir, sourceHashes, type SiteManifest } from './site-sources';
import { buildSubtitles } from './subtitles';

/** Tag of the release that holds the audio of the site. */
const AUDIO_RELEASE = 'site-audio';

const id = process.argv[2];
const keepAudio = process.argv.includes('--keep-audio');
if (!id || id.startsWith('--')) {
  console.error('usage: bun app/scripts/site-data.ts <project> [--keep-audio]');
  process.exit(2);
}
const dir = projectDir(id);
const out = siteDir(dir);
mkdirSync(out, { recursive: true });
const audioFile = `${id}.mp3`;
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

let mixPath = '';
const inputs = await projectInputs(id, dir, {
  mix: (song) => {
    mixPath = path.isAbsolute(song.prompt.mixPath) ? song.prompt.mixPath : path.resolve(dir, song.prompt.mixPath);
    return `data/${id}/audio.mp3`;
  },
  font: (rel) => {
    throw new Error(`video/assets/fonts/${rel}: the site snapshot does not carry project fonts yet`);
  },
});

const audio = path.join(out, audioFile);
const manifestFile = path.join(out, 'manifest.json');
let audioEntry: SiteManifest['audio'];
if (keepAudio) {
  if (!existsSync(audio) || !existsSync(manifestFile)) {
    console.error(`--keep-audio: ${audio} or the manifest is missing`);
    process.exit(1);
  }
  audioEntry = (JSON.parse(readFileSync(manifestFile, 'utf8')) as SiteManifest).audio;
  if (sha(audio) !== audioEntry.sha256) {
    console.error(`--keep-audio: ${audio} is not the file the manifest names (SHA-256 differs)`);
    process.exit(1);
  }
} else {
  const ff = Bun.spawnSync(['ffmpeg', '-y', '-v', 'error', '-i', mixPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', audio]);
  if (ff.exitCode !== 0) {
    console.error(`ffmpeg failed on ${mixPath}:\n${ff.stderr.toString()}`);
    process.exit(1);
  }
  audioEntry = { file: audioFile, duration: inputs.timing.duration, sha256: sha(audio), release: AUDIO_RELEASE };
}

writeFileSync(path.join(out, 'inputs.json'), JSON.stringify(inputs));
writeFileSync(path.join(out, 'subtitles.json'), JSON.stringify(buildSubtitles(inputs.lines)));

// the cover: the PNG of the project's thumbnail scene (pve board, or video/make-thumbnail.ts), as a 1280x720 JPEG
const cover = path.join(dir, 'out/thumbnail.png');
if (existsSync(cover)) {
  const ff = Bun.spawnSync(['ffmpeg', '-y', '-v', 'error', '-i', cover, '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', path.join(out, 'thumbnail.jpg')]);
  if (ff.exitCode !== 0) {
    console.error(`ffmpeg failed on ${cover}:\n${ff.stderr.toString()}`);
    process.exit(1);
  }
} else if (!existsSync(path.join(out, 'thumbnail.jpg'))) {
  console.warn(`no ${path.relative(process.cwd(), cover)}: the site shows no cover for ${id}`);
}

const manifest: SiteManifest = { project: id, sources: sourceHashes(dir), audio: audioEntry };
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

const kb = (f: string) => (statSync(path.join(out, f)).size / 1024).toFixed(0);
console.log(`projects/${id}/site: inputs.json ${kb('inputs.json')} kB, subtitles.json ${kb('subtitles.json')} kB, ${audioFile} ${(statSync(audio).size / 1048576).toFixed(2)} MB${keepAudio ? ' (kept)' : ''}, ${Object.keys(manifest.sources).length} sources hashed`);
