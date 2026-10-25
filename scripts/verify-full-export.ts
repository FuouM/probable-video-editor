#!/usr/bin/env bun
// Checks a full render of a project (DESIGN 14, Phase 3):
//   1. the file decodes with no stream errors (ffmpeg -f null)
//   2. duration = the song duration (timing.ai.json) within 0.05 s
//   3. video: h264 at the video.json size and fps
//   4. audio: AAC, 2 channels, the sample rate of the song's mix
//   bun run verify-export -- --project pdoom_original [--input <mp4>]
// Default input: projects/<id>/out/render/full/<id>-full.mp4 (pve render with no range).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openProject } from '../packages/cli/src/project';

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const DURATION_TOLERANCE_S = 0.05;

interface Stream { codec_name?: string; codec_type?: string; width?: number; height?: number; r_frame_rate?: string; channels?: number; sample_rate?: string }
interface Probe { streams?: Stream[]; format?: { duration?: string } }

function probe(file: string): Probe {
  const r = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height,r_frame_rate,channels,sample_rate', '-of', 'json', file], { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`ffprobe ${file}: ${r.stderr.toString()}`);
  return JSON.parse(r.stdout.toString()) as Probe;
}

const p = await openProject(opt('project'));
const file = path.resolve(opt('input') ?? path.join(p.dir, 'out/render/full', `${p.id}-full.mp4`));
if (!existsSync(file)) {
  console.error(`no file ${file}: render it with pve render -p ${p.id}`);
  process.exit(1);
}
console.log(`verify ${path.relative(process.cwd(), file)}`);
const checks: [string, boolean, string][] = [];

const dec = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', file, '-f', 'null', '-'], { stdout: 'ignore', stderr: 'pipe' });
const decErr = dec.stderr.toString().trim();
checks.push(['decode', dec.exitCode === 0 && !decErr, decErr || 'no stream errors']);

const info = probe(file);
const v = info.streams?.find((s) => s.codec_type === 'video');
const a = info.streams?.find((s) => s.codec_type === 'audio');
const mixRate = probe(p.song.prompt.mixPath).streams?.find((s) => s.codec_type === 'audio')?.sample_rate;
const duration = Number(info.format?.duration);
const want = p.resolved.duration;
checks.push(['duration', Math.abs(duration - want) <= DURATION_TOLERANCE_S, `${duration.toFixed(3)} s (song ${want.toFixed(3)} s ± ${DURATION_TOLERANCE_S})`]);
const [w, h] = p.resolved.size;
checks.push(['video', v?.codec_name === 'h264' && v.width === w && v.height === h && v.r_frame_rate === `${p.resolved.fps}/1`,
  v ? `${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate} (want h264 ${w}x${h} ${p.resolved.fps}/1)` : 'no video stream']);
checks.push(['audio', a?.codec_name === 'aac' && a.channels === 2 && a.sample_rate === mixRate,
  a ? `${a.codec_name} ${a.channels} ch ${a.sample_rate} Hz (want aac 2 ch ${mixRate} Hz, the mix)` : 'no audio stream']);

for (const [name, ok, detail] of checks) console.log(`  ${name.padEnd(8)} ${ok ? 'PASS' : 'FAIL'}  ${detail}`);
const ok = checks.every((c) => c[1]);
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
