// first-frame CLI: replaces the first frame of a video with an image using ffmpeg.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { replaceFirstFrame } from '../packages/cli/src/first-frame';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    encoder: { type: 'string', default: 'nvenc' },
    crf: { type: 'string' },
    preset: { type: 'string' },
  },
});

if (positionals.length !== 2 || (values.encoder !== 'nvenc' && values.encoder !== 'x264')) {
  console.error('usage: bun run first-frame <video> <image> [--out <file>] [--encoder nvenc|x264] [--crf 16 (x264: 14)] [--preset p7 (x264: slow)]');
  process.exit(1);
}

const [video, image] = positionals as [string, string];
try {
  console.log(`${path.basename(video)} + ${path.basename(image)} -> ${values.out ?? `${path.basename(video)}.first-frame...`}`);
  const out = replaceFirstFrame({
    video,
    image,
    out: values.out,
    encoder: values.encoder,
    crf: values.crf,
    preset: values.preset,
  });
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
} catch (e) {
  console.error(`first-frame: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
