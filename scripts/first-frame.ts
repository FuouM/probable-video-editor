// first-frame CLI: replaces the first frame of a video with an image using ffmpeg.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { replaceFirstFrame } from '../packages/cli/src/first-frame';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    crf: { type: 'string', default: '14' },
    preset: { type: 'string', default: 'slow' },
  },
});

if (positionals.length !== 2) {
  console.error('usage: bun run first-frame <video> <image> [--out <file>] [--crf 14] [--preset slow]');
  process.exit(1);
}

const [video, image] = positionals as [string, string];
try {
  console.log(`${path.basename(video)} + ${path.basename(image)} -> ${values.out ?? `${path.basename(video)}.first-frame...`}`);
  const out = replaceFirstFrame({
    video,
    image,
    out: values.out,
    crf: values.crf,
    preset: values.preset,
  });
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
} catch (e) {
  console.error(`first-frame: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
