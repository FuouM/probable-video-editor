// replaceFirstFrame: replaces frame 0 of a video file with an image (such as a thumbnail for platforms
// that use frame 0 as the preview cover). The rest of the video, duration, and audio are preserved.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './out';

export interface FirstFrameOptions {
  video: string;
  image: string;
  out?: string;
  crf?: string;
  preset?: string;
}

export function replaceFirstFrame(opts: FirstFrameOptions): string {
  const video = path.resolve(opts.video);
  const image = path.resolve(opts.image);
  if (!existsSync(video)) throw new CliError({ rule: 'first-frame', message: `${path.relative(process.cwd(), video)} does not exist` });
  if (!existsSync(image)) throw new CliError({ rule: 'first-frame', message: `${path.relative(process.cwd(), image)} does not exist` });

  const ext = path.extname(video);
  const out = path.resolve(opts.out ?? path.join(path.dirname(video), `${path.basename(video, ext)}.first-frame${ext}`));
  if (out === video) throw new CliError({ rule: 'first-frame', message: 'output file must differ from the input video' });

  const probe = Bun.spawnSync([
    'ffprobe', '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt,color_space',
    '-of', 'json', video,
  ]);
  if (probe.exitCode !== 0) {
    throw new CliError({ rule: 'first-frame', message: `ffprobe failed on ${path.basename(video)}: ${probe.stderr.toString().trim()}` });
  }

  const stream = (JSON.parse(probe.stdout.toString()) as { streams: Array<{ width: number; height: number; pix_fmt: string; color_space?: string }> }).streams[0];
  if (!stream) throw new CliError({ rule: 'first-frame', message: `${path.basename(video)} has no video stream` });

  const { width: w, height: h } = stream;
  const matrix = stream.color_space && /^(bt470bg|smpte170m)$/.test(stream.color_space) ? 'bt601' : 'bt709';

  const filter =
    `[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},scale=out_color_matrix=${matrix}:out_range=tv,format=${stream.pix_fmt}[img];` +
    `[0:v][img]overlay=enable='eq(n\\,0)':eof_action=repeat,format=${stream.pix_fmt}[v]`;

  const crf = opts.crf ?? '14';
  const preset = opts.preset ?? 'slow';

  const args = [
    'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
    '-i', video, '-i', image,
    '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', stream.pix_fmt,
    '-c:a', 'copy', '-movflags', '+faststart', out,
  ];

  const run = Bun.spawnSync(args, { stdout: 'ignore', stderr: 'pipe' });
  if (run.exitCode !== 0) {
    throw new CliError({ rule: 'first-frame', message: `ffmpeg failed (exit ${run.exitCode}): ${run.stderr.toString().trim()}` });
  }

  return out;
}
