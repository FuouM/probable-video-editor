// first-frame: replaces the first frame of a video with an image (a thumbnail for platforms that take the first
// frame of the file). The rest of the video, its length and its audio stay as they are: the audio is copied, the
// video is encoded again with x264 (a frame in the middle of a GOP cannot be changed without that).
//   bun run first-frame <video> <image> [--out <file>] [--crf 14] [--preset slow]
// The image covers the frame (scaled up, then cropped). Default out: <video>.first-frame.<ext> next to the video.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { out: { type: 'string', short: 'o' }, crf: { type: 'string', default: '14' }, preset: { type: 'string', default: 'slow' } },
});

function fail(message: string): never {
  console.error(`first-frame: ${message}`);
  process.exit(1);
}

if (positionals.length !== 2) fail('usage: bun run first-frame <video> <image> [--out <file>] [--crf 14] [--preset slow]');
const [video, image] = positionals.map((p) => path.resolve(p!)) as [string, string];
for (const f of [video, image]) if (!existsSync(f)) fail(`${path.relative(process.cwd(), f)} does not exist`);
const ext = path.extname(video);
const out = path.resolve(values.out ?? path.join(path.dirname(video), `${path.basename(video, ext)}.first-frame${ext}`));
if (out === video) fail('--out is the input file: name another file');

const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt,color_space', '-of', 'json', video]);
if (probe.exitCode !== 0) fail(`ffprobe could not read ${path.basename(video)}: ${probe.stderr.toString().trim()}`);
const stream = (JSON.parse(probe.stdout.toString()) as { streams: Array<{ width: number; height: number; pix_fmt: string; color_space?: string }> }).streams[0];
if (!stream) fail(`${path.basename(video)} has no video stream`);
const { width: w, height: h } = stream;
// the matrix of the picture: BT.601 for SD flags, BT.709 otherwise (what pve writes)
const matrix = stream.color_space && /^(bt470bg|smpte170m)$/.test(stream.color_space) ? 'bt601' : 'bt709';

const filter =
  `[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},scale=out_color_matrix=${matrix}:out_range=tv,format=${stream.pix_fmt}[img];` +
  `[0:v][img]overlay=enable='eq(n\\,0)':eof_action=repeat,format=${stream.pix_fmt}[v]`;

const args = [
  'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-stats',
  '-i', video, '-i', image,
  '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
  '-c:v', 'libx264', '-preset', values.preset!, '-crf', values.crf!, '-pix_fmt', stream.pix_fmt,
  '-c:a', 'copy', '-movflags', '+faststart', out,
];
console.log(`${path.basename(video)} + ${path.basename(image)} -> ${path.relative(process.cwd(), out)}`);
const run = Bun.spawnSync(args, { stdout: 'inherit', stderr: 'inherit' });
if (run.exitCode !== 0) fail(`ffmpeg failed (exit ${run.exitCode})`);
console.log('done');
