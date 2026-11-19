#!/usr/bin/env bun
// pve: the command line of the editor (DESIGN 8.2). Exit 0 = success, 1 = error, 2 = usage error.
// Every command except init works on one project: --project <id|path>, else PVE_PROJECT, else the folder
// (or the nearest folder above it) that has video/video.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { runBench } from './bench';
import { readServe, ROOT, withPage } from './browser';
import { addBoard, BOARD_T0, renderBoard } from './board';
import { checkProject } from './check';
import { importAup } from './aup';
import { fetchAssets, MANIFEST_FILE, packAssets, readManifest } from './assets';
import { initProject } from './init';
import { at } from './locate';
import { CliError, EXIT, fmtBarBeat, fmtCounts, fmtProblem, fmtTime, table, UsageError } from './out';
import { find, focusOutline, formatFind, formatOutline, outline } from './outline';
import { appendRecords, gitState, machine } from './records';
import { clipAt, expandTimes, findProject, openProject, openView, servedId, SONG_FILE, timeOf, transitionTimes, type Project, type ProjectRef } from './project';
import { PROJECTS } from '@pve/core/projects';
import { renderName } from '@pve/core';
import { runPerf } from './perf';
import { encodeVideo, parseSamples, renderFrames, renderRecord, sheet, stills, type SegmentCodec, type SheetTile } from './render';
import { camStep, cropStrip, frameState, framesAt, judgeSyllable, jumps, JUMP_FLOOR, mainCamera, marksAt, nameMatcher, sungSyllables, union, type LyricCheck, type Rect } from './probe';
import type { CamRecord } from '@pve/engine/marks';
import { newScene } from './scene';
import { doctor } from './doctor';
import { formatNotes, noteRows, readProjectNotes, resolveNote } from './notes';
import { formatGate, porcelain, runGate, type GateOptions, type GateResult, type GoldenMode } from './gate';
import { commitMessage, commitPaths } from './commit';
import { cues, languages, render, type Format } from './subs';
import { SUB_FORMATS } from 'lyricsync/formats';
import { replaceFirstFrame } from './first-frame';
import { KIT_FILE, kitIndex } from './kit';
import { findJob, logPath, MAX_WAIT_S, startJob, waitJob, type WaitResult } from './jobs';
import { CHAT_DIR, clearRoom, formatMessage, openRoom, readMessages, roomStatus, sendMessage, takeUnread, waitUnread, type ChatMsg } from './chat';
import { decodePng, diffImages, type Image } from './png';
import { findCulprit, runOrder } from './order';
import { runNan } from './nan';
import { runServe, servePages, startServe, stopServe } from './serve';
import { runDeterminism, seededTimes } from './determinism';
import { GOLDEN_PROJECT, runGolden } from './golden';
import { verifyExport } from './verify-export';
import type { Subtitles } from '../../../app/src/subtitles';

interface Args {
  positionals: string[];
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
}

/** One option of a command: its parseArgs type and the line of the help text. */
interface Opt {
  type: 'string' | 'boolean';
  short?: string;
  desc: string;
}
type Opts = Record<string, Opt>;

interface Command {
  /** Arguments after the command name, for the usage text. */
  args: string;
  /** What the command does, in short. The options carry their own text. */
  summary: string;
  options?: Opts;
  /** Take the arguments as they are, with no option parsing (`job` passes them on to another command). The options are for the help text only. */
  raw?: boolean;
  run(a: Args): Promise<number>;
}

const sOpt = (desc: string): Opt => ({ type: 'string', desc });
const bOpt = (desc: string): Opt => ({ type: 'boolean', desc });
const PROJECT_OPT: Opts = { project: { type: 'string', short: 'p', desc: 'project id or folder (default: PVE_PROJECT, else the folder with video/video.json at or above the current folder)' } };
const JSON_OPT: Opts = { json: bOpt('print JSON') };
const SAMPLE_OPT: Opts = {
  samples: sOpt('sub-frames per frame (motion blur): a whole number, or auto (adaptive until the error is under --tol; default 1)'),
  'min-samples': sOpt('--samples auto: fewest sub-frames (default 4)'),
  'max-samples': sOpt('--samples auto: most sub-frames (default 324)'),
  tol: sOpt('--samples auto: stop when the estimated error is under this many 8-bit levels (default 3)'),
  refine: sOpt('--samples auto: tiles (decide per 32 px tile, default) or frame (for the whole frame)'),
  shutter: sOpt('shutter open time as a part of one frame (default 0.5)'),
  scale: sOpt('output scale, a whole number (default 1: 1920x1080; 2: 3840x2160)'),
};
const PRECISION_OPT: Opts = { precision: sOpt('half (16-bit HDR targets, as the renders; default) or float (32-bit: free of the 16-bit blend rounding of the GPU, for pixel compares; docs/ENGINE.md)') };
const projectOf = (a: Args) => (typeof a.values.project === 'string' ? a.values.project : undefined);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** String option or its default. */
function str(a: Args, key: string, def: string): string {
  const v = a.values[key];
  return typeof v === 'string' ? v : def;
}

/** Number option or its default. A value that is not a number is a usage error. */
function num(a: Args, key: string, def: number): number {
  const v = a.values[key];
  if (typeof v !== 'string') return def;
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${key} takes a number (got '${v}')`);
  return n;
}

/** --samples/--shutter/--scale. */
function sampling(a: Args, defSamples: string) {
  const refine = str(a, 'refine', 'tiles');
  if (refine !== 'tiles' && refine !== 'frame') throw new UsageError('--refine takes tiles or frame');
  let samples;
  try {
    samples = parseSamples(str(a, 'samples', defSamples), { min: num(a, 'min-samples', 4), max: num(a, 'max-samples', 324), tol: num(a, 'tol', 3), refine });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const scale = num(a, 'scale', 1);
  if (!Number.isInteger(scale) || scale < 1) throw new UsageError('--scale takes a whole number of at least 1');
  return { samples, shutter: num(a, 'shutter', 0.5), scale };
}

/** `01:24.320  verse  13.2`: the label of a frame on a sheet. */
function frameLabel(p: Project, t: number): string {
  return `${fmtTime(t)}  ${clipAt(p, t)?.id ?? '-'}  ${fmtBarBeat(p.timing, t)}`;
}

/** `@hook1` -> `hook1`, `verse_1+chorus_1` stays: a file or folder name from expressions or clip ids. */
const slug = (s: string) => s.replace(/[^A-Za-z0-9_.+-]+/g, '').replace(/^\.+/, '') || 'range';

/** The clips that the frames at `times` show (the page loads only these: faster). Undefined when none or many. */
function onlyOf(p: Project, times: number[]): string | undefined {
  const ids = [...new Set(times.map((t) => clipAt(p, t)?.id).filter(Boolean) as string[])];
  return ids.length > 0 && ids.length <= 4 ? ids.join(',') : undefined;
}

/** `--precision`: half (default) or float. */
function hdrOf(a: Args): 'half' | 'float' {
  const precision = str(a, 'precision', 'half');
  if (precision !== 'half' && precision !== 'float') throw new UsageError('--precision takes half or float');
  return precision;
}

/** `01-24-320`: a time for a file name. */
const fileTime = (t: number) => fmtTime(t).replace(/[:.]/g, '-');
/** The PNG file of the still at `t` in `dir`. */
const stillFile = (dir: string, t: number) => path.join(dir, `still_${fileTime(t)}.png`);

/** A scene file under the project folder: its absolute path and its path from the repository root (the dev server path without the slash). */
function resolveBoardFile(p: Project, file: string): { abs: string; rel: string } {
  const abs = path.resolve(p.dir, file);
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (rel.startsWith('..') || !existsSync(abs)) throw new UsageError(`${file}: no such file under ${path.relative(process.cwd(), p.dir)}`);
  return { abs, rel };
}

/** The --crop option: x,y,w,h in 1920 x 1080 px. */
function cropRect(s: string): [number, number, number, number] {
  const [x, y, w, h, ...rest] = s.split(',').map(Number);
  if (rest.length || [x, y, w, h].some((v) => !Number.isFinite(v)) || !(w! > 0) || !(h! > 0)) throw new UsageError('--crop takes x,y,w,h in 1920x1080 px');
  return [x!, y!, w!, h!];
}

/** Prints the log of a waited job and returns its exit code. A job that still runs: the last `tail` lines, EXIT.running. */
function reportJob(r: WaitResult, tail: number): number {
  const secs = ((Date.now() - r.job.start) / 1000).toFixed(1);
  const lines = r.log.trimEnd().split('\n');
  if (r.code === undefined && !r.lost) {
    console.log(lines.slice(-tail).join('\n'));
    console.log(`job ${r.job.id}: still running after ${secs} s (pid ${r.job.pid})`);
    return EXIT.running;
  }
  console.log(lines.join('\n'));
  if (r.lost) {
    console.log(`job ${r.job.id}: the process ended without an exit code (killed or crashed) after ${secs} s`);
    return EXIT.error;
  }
  console.log(`job ${r.job.id}: exit ${r.code} after ${secs} s`);
  return r.code!;
}

/** Compares two pictures for `diff` and `seam`: ok when the mean channel diff is at most `tol`, and the line that says so. */
function diffLine(a: Image, b: Image, tol: number): { ok: boolean; line: string } {
  const d = diffImages(a, b);
  const ok = d.meanDiff <= tol;
  return { ok, line: `mean ${d.meanDiff.toFixed(4)} (tol ${tol})  max ${d.maxDiff}  differing ${d.pixels} px${d.box ? `  box ${d.box[0]},${d.box[1]}-${d.box[2]},${d.box[3]}` : ''}${ok ? '  ok' : '  FAIL'}` };
}

/** One `pve check` run: prints the report and returns the number of errors. `compact`: one JSON line. */
async function runCheck(ref: ProjectRef, json: boolean, compact: boolean): Promise<number> {
  const t0 = performance.now();
  const r = await checkProject(ref);
  const ms = Math.round(performance.now() - t0);
  const errors = r.problems.filter((p) => p.severity === 'error').length;
  if (json) {
    const report = { project: ref.id, ok: errors === 0, clips: r.project?.resolved.clips.length ?? null, sceneFiles: r.sceneFiles, problems: r.problems, ms };
    if (compact) console.log(JSON.stringify(report));
    else print(report);
  } else {
    for (const p of r.problems) console.log(fmtProblem(p));
    const clips = r.project ? `${r.project.resolved.clips.length} clips, ` : '';
    console.log(`${errors ? 'FAIL' : 'ok'}  ${ref.id}: ${clips}${r.sceneFiles} scene files, ${fmtCounts(r.problems)} (${ms} ms)`);
  }
  return errors;
}

/** --golden, --skip, --only, --quick and --keep-going of `gate` and `commit`. */
function gateOptions(a: Args): GateOptions {
  const golden = str(a, 'golden', 'auto');
  if (golden !== 'auto' && golden !== 'always' && golden !== 'never') throw new UsageError('--golden takes auto, always or never');
  const mode: GoldenMode = golden;
  const skip = str(a, 'skip', '').split(',').map((s) => s.trim()).filter(Boolean);
  if (a.values.quick) {
    if (!skip.includes('test')) skip.push('test');
    if (!skip.includes('golden')) skip.push('golden');
  }
  const onlyRaw = str(a, 'only', '').split(',').map((s) => s.trim()).filter(Boolean);
  const only = onlyRaw.length ? onlyRaw : undefined;
  const known = ['typecheck', 'check', 'test', 'golden'];
  const badSkip = skip.filter((s) => !known.includes(s) && !s.startsWith('typecheck:'));
  if (badSkip.length) throw new UsageError(`--skip takes ${known.join(', ')} (got ${badSkip.join(', ')})`);
  if (only) {
    const badOnly = only.filter((s) => !known.includes(s) && !s.startsWith('typecheck:'));
    if (badOnly.length) throw new UsageError(`--only takes ${known.join(', ')} (got ${badOnly.join(', ')})`);
  }
  return { golden: mode, failFast: a.values['keep-going'] !== true, skip, only };
}

/** The options of `gate` that `commit` passes on to its gate. */
const GATE_OPT: Opts = {
  golden: sOpt('auto (default: when the work tree changes the engine, pdoom_original or tests/golden), always or never'),
  skip: sOpt('leave these steps out: typecheck (or one typecheck:<project>), check, test, golden'),
  only: sOpt('run only these steps (names as --skip)'),
  quick: bOpt('skip test and golden'),
};

const COMMANDS: Record<string, Command> = {
  init: {
    args: '<song folder>',
    summary: 'make projects/<id>/ from a finished Lyric-Sync song folder (copied without lyricsync/), with a storyboard video.json (one clip per section)',
    async run({ positionals }) {
      if (positionals.length !== 1) throw new UsageError('init takes one song folder');
      const r = await initProject(positionals[0]!, PROJECTS);
      console.log(`${r.copied ? 'copied the song to' : 'using'} projects/${r.id}/`);
      console.log(`wrote projects/${r.id}/video/video.json (${r.video.clips.length} storyboard clips) and video/treatment.md`);
      for (const c of r.video.clips) console.log(`  ${c.id.padEnd(24)} ${fmtTime(c.start)}  ${fmtTime(c.end)}  ${c.brief ?? ''}`);
      console.log(`next: pve outline -p ${r.id}`);
      return EXIT.ok;
    },
  },
  aup: {
    args: '<file.aup>',
    summary: 'read an AviUtl project (ExEdit) and write video/assets/timeline.json: fps, size, sections, sprite placements with their sheet grids, lyric texts. The sprite PNG files must be in video/assets/. Stops with a list when an object has a script or effect that the reader does not know. See docs/AVIUTL.md',
    options: { ...PROJECT_OPT, skip: sOpt('leave out the objects of these image files (a.bmp,b.png)') },
    async run(a) {
      if (a.positionals.length !== 1) throw new UsageError('aup takes one .aup file');
      const ref = findProject(projectOf(a), undefined, undefined, SONG_FILE);
      const skip = str(a, 'skip', '').split(',').map((s) => s.trim()).filter(Boolean);
      const { out, timeline: t } = await importAup(ref, a.positionals[0]!, skip);
      console.log(JSON.stringify({
        out: path.relative(ROOT, out).replaceAll('\\', '/'), source: t.source, fps: t.fps, size: t.size, frames: t.frames,
        sections: t.sections.length, sprites: t.sprites.length, spriteFiles: new Set(t.sprites.map((s) => s.file)).size,
        texts: t.texts.length, groups: t.groups.length, buffers: t.buffers.length, audio: t.audio.length, skipped: t.skipped,
      }));
      return EXIT.ok;
    },
  },
  assets: {
    args: 'pack | fetch',
    summary: 'the files of video/assets/ are assets of the GitHub release <id>-assets, not git files. video/assets.json lists them (path, SHA-256, size). pack: write the manifest from the local folder and print the gh release upload command (not run). fetch: download the missing or changed files with gh and check each SHA-256. pve check also compares the local files with the manifest',
    options: PROJECT_OPT,
    async run(a) {
      const sub = a.positionals[0];
      if (a.positionals.length !== 1 || (sub !== 'pack' && sub !== 'fetch')) throw new UsageError('assets takes pack or fetch');
      const ref = findProject(projectOf(a), undefined, undefined, SONG_FILE);
      if (sub === 'pack') {
        const r = packAssets(ref);
        const bytes = r.manifest.assets.reduce((n, x) => n + x.size, 0);
        console.log(JSON.stringify({ manifest: `projects/${ref.id}/${MANIFEST_FILE}`, release: r.manifest.release, files: r.manifest.assets.length, bytes }));
        console.log(`upload (not run): ${r.upload}`);
        console.log(`if the release does not exist yet: gh release create ${r.manifest.release} --title "${ref.id} assets" --notes "Video assets of ${ref.id}. Fetch with: pve assets fetch -p ${ref.id}"`);
      } else {
        const r = await fetchAssets(ref);
        console.log(JSON.stringify({ release: readManifest(ref).release, present: r.present, fetched: r.fetched.length }));
      }
      return EXIT.ok;
    },
  },
  check: {
    args: '',
    summary: 'validate and lint: inputs, video.json, expressions, overlaps, cuts off the beat, scene files, banned calls, missing features',
    options: { ...PROJECT_OPT, ...JSON_OPT, watch: bOpt('check again 150 ms after each change in video/ or user_input/ until Ctrl-C (one JSON line per run with --json)') },
    async run(a) {
      const ref = findProject(projectOf(a));
      const json = a.values.json === true;
      if (!a.values.watch) return (await runCheck(ref, json, false)) ? EXIT.error : EXIT.ok;
      // --watch: check again 150 ms after the last change in video/ or user_input/, until the process is killed
      await runCheck(ref, json, true);
      const roots = ['video', 'user_input'].map((d) => path.join(ref.dir, d)).filter((d) => existsSync(d));
      let timer: NodeJS.Timeout | undefined;
      let running = false, again = false;
      const rerun = async (why: string) => {
        if (running) { again = true; return; }
        running = true;
        do {
          again = false;
          if (!json) console.log(`\n${new Date().toTimeString().slice(0, 8)}  ${why}`);
          await runCheck(ref, json, true);
        } while (again);
        running = false;
      };
      for (const root of roots) {
        watch(root, { recursive: true }, (_event, file) => {
          if (!file || /(\.part|\.tmp|~)$/.test(String(file))) return;
          clearTimeout(timer);
          const rel = path.relative(ref.dir, path.join(root, String(file))).replaceAll('\\', '/');
          timer = setTimeout(() => void rerun(`changed ${rel}`), 150);
        });
      }
      console.error(`watching ${roots.map((d) => path.relative(ref.dir, d)).join(', ')} (Ctrl-C stops)`);
      await new Promise<never>(() => {});
      return EXIT.ok;
    },
  },
  outline: {
    args: '[clip...]',
    summary: 'the resolved edit and the song: clips, markers, sections, lyric lines, notes, with times and bar.beat; clip ids show only those clips and what is inside them',
    options: { ...PROJECT_OPT, ...JSON_OPT },
    async run(a) {
      const p = await openProject(projectOf(a));
      let o = outline(p);
      if (a.positionals.length) {
        try { o = focusOutline(o, a.positionals); } catch (e) { throw new UsageError(e instanceof Error ? e.message : String(e)); }
      }
      const notes = noteRows(p, readProjectNotes(p).filter((n) => !n.resolved && (!a.positionals.length || o.clips.some((c) => n.t >= c.start && n.t < c.end))));
      if (a.values.json) print({ ...o, notes });
      else console.log(`${formatOutline(o)}\n\nopen notes (${notes.length})\n${notes.length ? formatNotes(notes) : '  none'}`);
      return EXIT.ok;
    },
  },
  find: {
    args: '<text>',
    summary: 'lyric lines, words, syllables, sections, markers and clips that match, each with a time expression',
    options: { ...PROJECT_OPT, ...JSON_OPT },
    async run(a) {
      if (a.positionals.length === 0) throw new UsageError('find needs the text to look for');
      const hits = find(await openView(projectOf(a)), a.positionals.join(' '));
      if (a.values.json) print(hits);
      else console.log(formatFind(hits));
      return hits.length ? EXIT.ok : EXIT.error;
    },
  },
  kit: {
    args: '',
    summary: `write ${KIT_FILE}: an index of the scene modules (purpose, exports with file:line and doc, importers). Agents read it instead of searching the modules`,
    options: { ...PROJECT_OPT, check: bOpt(`exit 1 when ${KIT_FILE} is out of date; write nothing`) },
    async run(a) {
      const ref = findProject(projectOf(a));
      const file = path.join(ref.dir, KIT_FILE);
      const text = kitIndex(ref);
      const old = existsSync(file) ? readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : undefined;
      if (a.values.check) {
        console.log(old === text ? `ok  ${KIT_FILE} is up to date` : `stale  ${KIT_FILE}: run pve kit -p ${ref.id}`);
        return old === text ? EXIT.ok : EXIT.error;
      }
      writeFileSync(file, text);
      console.log(`${old === text ? 'unchanged' : 'wrote'}  ${path.relative(process.cwd(), file).replaceAll('\\', '/')} (${text.split('\n').length} lines)`);
      return EXIT.ok;
    },
  },
  at: {
    args: '<where> [; <where>...]',
    summary: 'locate anything, one JSON object per line: bar 111, bar 111.3, beat 250, f5665, 1:34.4, line 38, syl 38.5, @marker, any time expression, a range a..b, or lyric text in romaji, Japanese or English. Gives time, frame, bar.beat, beat offset, section, clip, line and syllable with its glyph and phrase. Works on a song folder without video.json',
    options: {
      ...PROJECT_OPT,
      syl: bOpt('add the syllables, glyph units and phrases with times'),
      frames: bOpt('with --syl: times as frames'),
      max: sOpt('most hits of a text query (default 20; add #n to the text to pick one)'),
    },
    async run(a) {
      if (!a.positionals.length) throw new UsageError('at needs a place, for example: bar 111');
      const v = await openView(projectOf(a));
      const o = { syl: a.values.syl === true, frames: a.values.frames === true, max: num(a, 'max', 20) };
      let failed = false;
      for (const query of a.positionals.join(' ').split(';').map((s) => s.trim()).filter(Boolean)) {
        try {
          for (const rec of at(v, query, o)) console.log(JSON.stringify(rec));
        } catch (e) {
          if (!(e instanceof CliError)) throw e;
          failed = true;
          console.log(JSON.stringify({ q: query, error: e.problem.message, fix: e.problem.fix }));
        }
      }
      return failed ? EXIT.error : EXIT.ok;
    },
  },
  scene: {
    args: 'new <name>',
    summary: 'write video/scenes/<name>.ts from the scene template (it renders as it is)',
    options: PROJECT_OPT,
    async run(a) {
      const [sub, name, ...rest] = a.positionals;
      if (sub !== 'new' || !name || rest.length) throw new UsageError('use: pve scene new <name>');
      const ref = findProject(projectOf(a));
      const file = newScene(ref, name);
      console.log(`wrote ${path.join(path.relative(process.cwd(), ref.dir), file)}`);
      console.log(`next: set "scene": "${name}" on a clip in video/video.json, then pve check`);
      return EXIT.ok;
    },
  },
  still: {
    args: '<time|from..to...> | --transition <id>',
    summary: 'PNG stills at times (seconds or expressions: @marker, lyric:text, clip:id.start, bar:12+2b) or over ranges from..to (at most 240 stills), or across an Over transition',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT, ...PRECISION_OPT,
      out: sOpt('folder of the PNG files (default <project>/out/stills)'),
      step: sOpt('seconds between the stills of a range (default 0.1)'),
      transition: sOpt('also n stills (--count) from the start to the end of this Over transition'),
      count: sOpt('stills of --transition (default 6)'),
      sheet: sOpt('also stitch the stills into a labeled contact sheet grid, this PNG file'),
      cols: sOpt('columns of the sheet (default: the number of stills up to 4, else 2)'),
      crop: sOpt('x,y,w,h in 1920x1080 px: each sheet tile shows that part of the frame, zoomed in whole pixels (makes a sheet, default <out>/sheet.png)'),
    },
    async run(a) {
      const tr = typeof a.values.transition === 'string' ? a.values.transition : undefined;
      if (!a.positionals.length && !tr) throw new UsageError('still needs at least one time (or --transition <id>)');
      const p = await openProject(projectOf(a));
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      const step = num(a, 'step', 0.1);
      if (!(step > 0)) throw new UsageError('--step takes a positive number of seconds');
      const dir = path.resolve(str(a, 'out', path.join(p.dir, 'out/stills')));
      const times = [...expandTimes(p, a.positionals, step, 240), ...(tr ? transitionTimes(p, tr, num(a, 'count', 6)) : [])];
      const items = times.map((t) => ({ t, file: stillFile(dir, t) }));
      const crop = typeof a.values.crop === 'string' ? cropRect(a.values.crop) : undefined;
      const sheetFile = typeof a.values.sheet === 'string' ? path.resolve(a.values.sheet) : crop ? path.join(dir, 'sheet.png') : undefined;
      const cols = num(a, 'cols', times.length <= 4 ? times.length : 2);
      const precision = hdrOf(a);
      const counts = await withPage(servedId(p), { scale: o.scale, only: onlyOf(p, times), hdr: precision, warm: true }, async (page) => {
        const c = await stills(page, items, o);
        if (sheetFile) {
          const tiles: SheetTile[] = times.map((t) => ({ t, label: frameLabel(p, t) }));
          await sheet(page, tiles, cols, sheetFile, o, crop);
        }
        return c;
      });
      items.forEach((it, i) => console.log(`${path.relative(process.cwd(), it.file)}  ${frameLabel(p, it.t)}  ${counts[i]} sub-frame${counts[i] === 1 ? '' : 's'}`));
      if (sheetFile) console.log(`${path.relative(process.cwd(), sheetFile)}  (${times.length} tiles)`);
      return EXIT.ok;
    },
  },
  board: {
    args: '<scene-file>',
    summary: 'one PNG of a scene file under the project folder that video.json does not name (e.g. video/scenes/script-board.ts), an exploratory board: type specimen, layout sketch, contact board of candidates. The scene is added to the page as a one-second clip long after the song',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT,
      out: sOpt('PNG file (default <project>/out/boards/<file>.png)'),
      at: sOpt('seconds into the scene, from 0 to under 1 (default 0.5); with --sheet: a,b,c, one tile each'),
      sheet: sOpt('one labeled contact sheet PNG with a tile for each --at time (a scene that shows another candidate at each time)'),
      cols: sOpt('columns of the sheet (default: the tiles up to 3)'),
    },
    async run(a) {
      const file = a.positionals[0];
      if (!file || a.positionals.length > 1) throw new UsageError('board takes one scene file under the project folder');
      const p = await openProject(projectOf(a));
      const { abs, rel } = resolveBoardFile(p, file);
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      const id = slug(path.basename(abs, path.extname(abs)));
      if (typeof a.values.sheet === 'string') {
        const ats = str(a, 'at', '0.5').split(',').map(Number);
        if (ats.some((v) => !(v >= 0 && v < 1))) throw new UsageError('--at takes times from 0 to under 1 (the board is a one-second clip), separated by commas');
        const sheetFile = path.resolve(a.values.sheet);
        const tiles: SheetTile[] = ats.map((at, i) => ({ t: BOARD_T0 + at, label: `${i + 1}  --at ${at}` }));
        await withPage(servedId(p), { scale: o.scale, only: 'none' }, async (page) => {
          await addBoard(page, `/${rel}`, id);
          await sheet(page, tiles, num(a, 'cols', Math.min(3, tiles.length)), sheetFile, o);
        });
        console.log(`${path.relative(process.cwd(), sheetFile)}  (${tiles.length} tiles)`);
        return EXIT.ok;
      }
      const out = path.resolve(str(a, 'out', path.join(p.dir, 'out/boards', `${id}.png`)));
      const count = await withPage(servedId(p), { scale: o.scale, only: 'none' }, (page) => renderBoard(page, `/${rel}`, id, out, num(a, 'at', 0.5), o));
      console.log(`${path.relative(process.cwd(), out)}  ${count} sub-frame${count === 1 ? '' : 's'}`);
      return EXIT.ok;
    },
  },
  props: {
    args: '<props-file> [model...]',
    summary: 'a contact sheet of the models of a scene module: one row per model, one tile per view (front, back, side, top, wire) under a neutral studio light on a grid, each labelled with its size in metres and its triangles. The file exports a PropTable through propBoard() of @pve/engine/props as its default scene (see docs/ENGINE.md)',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT,
      sheet: sOpt('PNG file (default <project>/out/props/<file>.png)'),
      views: sOpt('views to show, a list of front,back,side,top,wire (default all)'),
      cols: sOpt('columns of the sheet (default: the number of views)'),
      crop: sOpt('x,y,w,h in frame px (1920 x 1080): each tile is that part of the frame, zoomed in whole pixels'),
    },
    async run(a) {
      const [file, ...names] = a.positionals;
      if (!file) throw new UsageError('props takes a scene module under the project folder, then model names (default all)');
      const p = await openProject(projectOf(a));
      const { abs, rel } = resolveBoardFile(p, file);
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      const id = slug(path.basename(abs, path.extname(abs)));
      const params: Record<string, unknown> = {};
      if (names.length) params.names = names;
      if (typeof a.values.views === 'string') params.views = a.values.views.split(',').map((s) => s.trim());
      const crop = typeof a.values.crop === 'string' ? cropRect(a.values.crop) : undefined;
      const sheetFile = path.resolve(str(a, 'sheet', path.join(p.dir, 'out/props', `${id}.png`)));
      await withPage(servedId(p), { scale: o.scale, only: 'none' }, async (page) => {
        // the board clip is long enough for any table; tile k is second k of it
        await addBoard(page, `/${rel}`, id, BOARD_T0, 1000, params);
        // the global that propBoard() of @pve/engine/props writes (PROPS_GLOBAL there)
        const info = await page.evaluate(() => Reflect.get(globalThis, '__pveProps') as { views: string[]; models: { name: string; tris: number; size: number[] }[] } | undefined);
        if (!info) throw new UsageError(`${file}: its default export is not a propBoard() of @pve/engine/props`);
        const V = info.views.length;
        const tiles: SheetTile[] = info.models.flatMap((m, i) => info.views.map((v, j) => ({
          t: BOARD_T0 + i * V + j + 0.5,
          label: `${m.name}  ${v}  ${m.size.map((s) => s.toFixed(3)).join(' x ')} m  ${Math.round(m.tris)} tris`,
        })));
        await sheet(page, tiles, num(a, 'cols', V), sheetFile, o, crop);
        for (const m of info.models) console.log(`${m.name.padEnd(16)} ${m.size.map((s) => s.toFixed(3)).join(' x ')} m  ${Math.round(m.tris)} tris`);
      });
      console.log(path.relative(process.cwd(), sheetFile));
      return EXIT.ok;
    },
  },
  subs: {
    args: '',
    summary: 'the subtitles of the project for YouTube, with the highlight of the player (sung now: yellow, sung before: white, to come: grey; every change is its own cue): <project>/out/subs/<id>.<lang>.<format>, one file per language, upload each as its own track. en: the English words or phrases. ja (a song with a lyric map): two rows, romaji above Japanese. Reads <project>/site/subtitles.json (generates it if missing)',
    options: {
      ...PROJECT_OPT,
      lang: sOpt('languages, such as en,ja (default: all)'),
      format: sOpt('ttml (default), srt, ass, ytt (YouTube timed text, srv3), a list, or all'),
      out: sOpt('folder (default <project>/out/subs)'),
    },
    async run(a) {
      if (a.positionals.length) throw new UsageError('subs takes no arguments');
      const p = await openProject(projectOf(a));
      const ref = { dir: p.dir, id: p.id };
      const file = path.join(ref.dir, 'site/subtitles.json');
      if (!existsSync(file)) {
        console.log(`${path.relative(process.cwd(), file)} is missing; generating site data...`);
        const r = Bun.spawnSync(['bun', 'app/scripts/site-data.ts', ref.id, '--keep-audio'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
        if (!existsSync(file)) {
          throw new CliError({ rule: 'subs', message: `${path.relative(process.cwd(), file)} does not exist and could not be generated:\n${r.stderr.toString().trim()}`, fix: 'run bun app/scripts/site-data.ts <project>' });
        }
      }
      const subs = JSON.parse(readFileSync(file, 'utf8')) as Subtitles;
      const have = languages(subs);
      const langs = str(a, 'lang', have.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
      const bad = langs.filter((l) => !have.includes(l));
      if (bad.length) throw new UsageError(`no ${bad.join(', ')} subtitles in this project (languages: ${have.join(', ') || 'none'})`);
      const rawFmt = str(a, 'format', 'ttml');
      const fmts = (rawFmt === 'all' ? [...SUB_FORMATS] : rawFmt.split(',').map((s) => s.trim()).filter(Boolean)) as Format[];
      for (const fmt of fmts) {
        if (!(SUB_FORMATS as readonly string[]).includes(fmt)) throw new UsageError(`--format is ttml, srt, ass, ytt or all (got '${fmt}')`);
      }
      const dir = path.resolve(str(a, 'out', path.join(ref.dir, 'out/subs')));
      mkdirSync(dir, { recursive: true });
      for (const format of fmts) {
        for (const lang of langs) {
          const cs = cues(subs, lang, p.resolved.duration);
          const out = path.join(dir, `${ref.id}.${lang}.${format}`);
          writeFileSync(out, render(cs, format, lang));
          console.log(`${path.relative(process.cwd(), out)}  ${cs.length} cues  ${fmtTime(cs[0]?.start ?? 0)} - ${fmtTime(cs[cs.length - 1]?.end ?? 0)}`);
        }
      }
      return EXIT.ok;
    },
  },
  look: {
    args: '[clip...|clips|cuts|from..to...] | --transition <id>',
    summary: 'contact sheet of real frames with time, clip and bar.beat on each tile: the whole song, the named clips, `clips` (one tile per clip), `cuts` (both sides of every cut), times and ranges from..to (a time gives one tile, a range gives tiles spread over it), or an Over transition',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT,
      n: sOpt('tiles for the song, each named clip, each range or the transition (default 12; with `clips`: 1)'),
      step: sOpt('seconds between the tiles of a range (instead of --n)'),
      transition: sOpt('--n tiles across this Over transition'),
      cols: sOpt('columns (default 4)'),
      out: sOpt('PNG file (default <project>/out/look/<label>.png)'),
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      const keyword = a.positionals.length === 1 ? a.positionals[0] : undefined;
      const n = num(a, 'n', keyword === 'clips' ? 1 : 12), cols = num(a, 'cols', 4);
      const clips = p.resolved.clips;
      const dt = 1 / p.resolved.fps;
      const tr = typeof a.values.transition === 'string' ? a.values.transition : undefined;
      const perClip = (list: typeof clips) => list.flatMap((c) => Array.from({ length: n }, (_, i) => c.start + ((i + 0.5) * c.dur) / n).map((t, i) => ({ t, label: frameLabel(p, t), head: i === 0 })));
      let tiles: SheetTile[];
      let label: string;
      let only: string | undefined;
      if (keyword === 'cuts') {
        // per cut: a quarter second before, the last frame before, the first frame after, a quarter second after
        tiles = clips.slice(1).flatMap((c) => [c.start - 0.25, c.start - dt, c.start, c.start + 0.25].map((t, i) => ({ t, label: frameLabel(p, t), head: i === 0 })));
        label = 'cuts';
      } else if (keyword === 'clips') {
        tiles = perClip(clips);
        label = 'clips';
      } else if (tr || a.positionals.some((x) => x.includes('..') || !clips.some((c) => c.id === x))) {
        const step = a.values.step === undefined ? undefined : num(a, 'step', 0);
        if (step !== undefined && !(step > 0)) throw new UsageError('--step takes a positive number of seconds');
        const times = [...expandTimes(p, a.positionals, step ?? { n }, 240), ...(tr ? transitionTimes(p, tr, n) : [])];
        tiles = times.map((t) => ({ t, label: frameLabel(p, t) }));
        label = tr ? `transition-${tr}` : a.positionals.join('+');
        only = onlyOf(p, times);
      } else if (a.positionals.length) {
        const unknown = a.positionals.filter((id) => !clips.some((c) => c.id === id));
        if (unknown.length) throw new UsageError(`no clip ${unknown.join(', ')}. Clips: ${clips.map((c) => c.id).join(', ')}`);
        tiles = perClip(a.positionals.map((id) => clips.find((x) => x.id === id)!));
        label = a.positionals.join('+');
        only = a.positionals.join(',');
      } else {
        const d = p.resolved.duration;
        tiles = Array.from({ length: n }, (_, i) => ((i + 0.5) * d) / n).map((t) => ({ t, label: frameLabel(p, t) }));
        label = 'song';
      }
      const out = path.resolve(str(a, 'out', path.join(p.dir, `out/look/${slug(label)}.png`)));
      await withPage(servedId(p), { scale: o.scale, only, warm: true }, (page) => sheet(page, tiles, cols, out, o));
      console.log(`${path.relative(process.cwd(), out)}  (${tiles.length} tiles)`);
      return EXIT.ok;
    },
  },
  probe: {
    args: '<time|from..to...> | --lyrics <clip...>',
    summary: 'named objects (scenes call mark from @pve/engine/marks): list them at times, track one, or crop a fixed box; check that sung syllables are on screen; report cameras and metrics per frame',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT, ...JSON_OPT,
      target: { type: 'string', short: 't', desc: 'mark name or glob to track (box, move, zoomed crop strip); with --metrics: the metric names to show' },
      rect: sOpt('x,y,w,h in frame px: crop this fixed box instead'),
      pad: sOpt('px around the box in the crop strip (default 24)'),
      zoom: sOpt('zoom of the crop strip (default 2)'),
      step: sOpt('seconds between the times of a range (default one frame)'),
      lyrics: bOpt('the arguments are clip ids: check that every sung syllable of them is marked on screen'),
      out: sOpt('PNG of the crop strip (default <project>/out/probe/<target>_<time>.png)'),
      cams: bOpt('the true camera of the picture on each frame (position, yaw/pitch/roll, lens) and its step from the frame before'),
      'all-cams': bOpt('as --cams, for every camera that drew'),
      metrics: bOpt('the values that scenes report (metric from @pve/engine/marks)'),
      jumps: bOpt('with --cams/--metrics: only the frames where a step stands out of its neighbours (a cut, a pop, a jerk)'),
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      if (!a.positionals.length) throw new UsageError(a.values.lyrics ? 'probe --lyrics needs clip ids' : 'probe needs at least one time (or from..to)');
      const clips = p.resolved.clips;

      if (a.values.lyrics) {
        const unknown = a.positionals.filter((id) => !clips.some((c) => c.id === id));
        if (unknown.length) throw new UsageError(`no clip ${unknown.join(', ')}. Clips: ${clips.map((c) => c.id).join(', ')}`);
        const items = a.positionals.flatMap((id) => {
          const c = clips.find((x) => x.id === id)!;
          return sungSyllables(p, c.start, c.end).map((s) => ({ ...s, clip: id }));
        });
        const ms = await withPage(servedId(p), { scale: o.scale, only: a.positionals.join(','), warm: true }, (page) => marksAt(page, items.map((s) => s.t), o));
        const checks: LyricCheck[] = items.map((s, i) => ({ t: s.t, clip: s.clip, syl: s.syl, word: s.word, state: judgeSyllable(ms[i]!, s.syl, s.word) }));
        const bad = checks.filter((c) => c.state !== 'shown');
        if (a.values.json) print(checks);
        else {
          if (bad.length) console.log(table(bad.map((c) => [fmtTime(c.t), c.clip, fmtBarBeat(p.timing, c.t), c.syl, c.word, c.state]), ['time', 'clip', 'bar', 'syl', 'word', 'state']));
          console.log(`${bad.length ? 'FAIL' : 'ok'}  ${checks.length - bad.length}/${checks.length} sung syllables marked on screen`);
        }
        return bad.length ? EXIT.error : EXIT.ok;
      }

      const step = num(a, 'step', 1 / p.resolved.fps);
      if (!(step > 0)) throw new UsageError('--step takes a positive number of seconds');
      const times = expandTimes(p, a.positionals, step);
      const only = onlyOf(p, times);

      if (a.values.cams || a.values['all-cams'] || a.values.metrics) {
        const wantCams = !!(a.values.cams || a.values['all-cams']);
        const frames = await withPage(servedId(p), { scale: o.scale, only, warm: true }, (page) => framesAt(page, times, o, wantCams));
        const onlyJumps = a.values.jumps === true;
        const f3 = (v: number) => v.toFixed(3), f2 = (v: number) => v.toFixed(2);
        const report: unknown[] = [];
        let flagged = 0;
        if (wantCams) {
          // the series: the camera of the picture, and with --all-cams every camera by its id
          const series = new Map<string, (CamRecord | null | undefined)[]>();
          series.set('main', frames.map((f) => mainCamera(f.cams)));
          if (a.values['all-cams']) {
            const ids = [...new Set(frames.flatMap((f) => f.cams.filter((c) => c.kind !== 'quad').map((c) => c.id)))];
            for (const id of ids) series.set(`cam${id}`, frames.map((f) => f.cams.find((c) => c.id === id)));
          }
          for (const [name, list] of series) {
            const steps = list.map((c, i) => { const prev = list[i - 1]; return c && prev ? camStep(prev, c) : null; });
            const flags = (['dpos', 'dturn', 'droll', 'dlens'] as const).map((k) => jumps(steps.map((s) => (s ? s[k] : null)), JUMP_FLOOR[k]));
            const rows = list.map((c, i) => {
              const s = steps[i];
              // across a switch of camera the place and the lens of the two cameras do not compare (an orthographic camera stands anywhere on its axis)
              const why = [...(['pos', 'turn', 'roll', 'lens'] as const).filter((n, k) => flags[k]![i] && !(s?.switched && (n === 'pos' || n === 'lens'))), ...(s?.switched ? ['switch'] : [])];
              return { t: frames[i]!.t, cam: c, step: s, jump: why };
            });
            const shown = onlyJumps ? rows.filter((r) => r.jump.length) : rows;
            flagged += rows.filter((r) => r.jump.length).length;
            report.push({ series: name, rows: shown });
            if (a.values.json) continue;
            console.log(`${name}  (${rows.filter((r) => r.jump.length).length} jumps in ${rows.length} frames)`);
            if (shown.length) console.log(table(shown.map((r) => [
              fmtTime(r.t), r.cam ? `${r.cam.clip} #${r.cam.id} ${r.cam.kind}` : '-',
              ...(r.cam ? [...r.cam.pos.map(f2), f2(r.cam.yaw), f2(r.cam.pitch), f2(r.cam.roll), r.cam.kind === 'persp' ? `${f2(r.cam.lens)}deg` : `${f2(r.cam.lens)}m`, f2(r.cam.persp)] : ['', '', '', '', '', '', '', '']),
              r.step ? f3(r.step.dpos) : '', r.step ? f3(r.step.dturn) : '', r.step ? `${f2(100 * r.step.dlens)}%` : '', r.jump.join(','),
            ]), ['time', 'camera', 'x', 'y', 'z', 'yaw', 'pitch', 'roll', 'lens', 'persp', 'dpos m', 'dturn deg', 'dlens', 'jump']));
          }
        }
        if (a.values.metrics) {
          const match = typeof a.values.target === 'string' ? nameMatcher(a.values.target) : () => true;
          const names = [...new Set(frames.flatMap((f) => f.metrics.filter((m) => match(m.name)).map((m) => `${m.clip}:${m.name}`)))];
          for (const key of names) {
            const list = frames.map((f) => f.metrics.find((m) => `${m.clip}:${m.name}` === key));
            const steps = list.map((m, i) => { const prev = list[i - 1]; return m && prev && m.v.length === prev.v.length ? Math.hypot(...m.v.map((v, k) => v - prev.v[k]!)) : null; });
            const flags = jumps(steps, JUMP_FLOOR.metric);
            const rows = list.map((m, i) => ({ t: frames[i]!.t, v: m ? m.v : null, step: steps[i], jump: flags[i]! }));
            const shown = onlyJumps ? rows.filter((r) => r.jump) : rows;
            flagged += rows.filter((r) => r.jump).length;
            report.push({ metric: key, rows: shown });
            if (a.values.json) continue;
            console.log(`${key}  (${rows.filter((r) => r.jump).length} jumps in ${rows.length} frames)`);
            if (shown.length) console.log(table(shown.map((r) => [fmtTime(r.t), r.v ? r.v.map((v) => v.toPrecision(6)).join(' ') : '-', r.step === null ? '' : r.step.toPrecision(4), r.jump ? 'JUMP' : '']), ['time', 'value', 'step', 'jump']));
          }
          if (!names.length && !a.values.json) console.log('no metrics: no scene called metric() in these frames');
        }
        if (a.values.json) print(report);
        else if (onlyJumps) console.log(`${flagged} jumps`);
        return EXIT.ok;
      }
      const target = typeof a.values.target === 'string' ? a.values.target : undefined;
      const fixed = typeof a.values.rect === 'string' ? a.values.rect.split(',').map(Number) : undefined;
      if (fixed && (fixed.length !== 4 || fixed.some((v) => !Number.isFinite(v)))) throw new UsageError('--rect takes x,y,w,h in frame px');
      const pad = num(a, 'pad', 24), zoom = num(a, 'zoom', 2);

      await withPage(servedId(p), { scale: o.scale, only, warm: true }, async (page) => {
        const ms = await marksAt(page, times, o);
        if (!target && !fixed) {
          // list every mark of each time
          if (a.values.json) { print(times.map((t, i) => ({ t, marks: ms[i] }))); return; }
          times.forEach((t, i) => {
            console.log(`${frameLabel(p, t)}  (${ms[i]!.length} marks)`);
            if (ms[i]!.length) console.log(table(ms[i]!.map((m) => [m.name, m.clip, ...[m.x, m.y, m.w, m.h].map((v) => v.toFixed(1)), frameState([m.x, m.y, m.w, m.h])]), ['name', 'entry', 'x', 'y', 'w', 'h', 'frame']));
          });
          return;
        }
        const match = target ? nameMatcher(target) : () => false;
        const boxes = ms.map((list) => (fixed ? (fixed as Rect) : union(list.filter((m) => match(m.name)))));
        const rows = times.map((t, i) => {
          const b = boxes[i], prev = boxes[i - 1];
          return { t, box: b, n: fixed ? null : ms[i]!.filter((m) => match(m.name)).length, dx: b && prev ? b[0] - prev[0] : null, dy: b && prev ? b[1] - prev[1] : null };
        });
        // one crop size for the strip: the union of every box, padded, clamped to the frame
        const all = boxes.filter(Boolean) as Rect[];
        const tiles = times.map((t, i) => {
          const b = boxes[i];
          if (!b) return { t, rect: null, label: frameLabel(p, t) };
          const w = Math.min(1920, Math.max(...all.map((r) => r[2])) + 2 * pad), h = Math.min(1080, Math.max(...all.map((r) => r[3])) + 2 * pad);
          const x = Math.max(0, Math.min(1920 - w, b[0] + b[2] / 2 - w / 2)), y = Math.max(0, Math.min(1080 - h, b[1] + b[3] / 2 - h / 2));
          return { t, rect: [x, y, w, h] as Rect, label: frameLabel(p, t) };
        });
        const out = path.resolve(str(a, 'out', path.join(p.dir, `out/probe/${slug(target ?? 'rect')}_${fileTime(times[0]!)}.png`)));
        await cropStrip(page, tiles, zoom, out, o);
        if (a.values.json) print({ out, rows });
        else {
          console.log(table(rows.map((r) => [fmtTime(r.t), clipAt(p, r.t)?.id ?? '-', r.n === null ? '' : String(r.n), ...(r.box ? r.box.map((v) => v.toFixed(1)) : ['-', '-', '-', '-']), r.dx === null ? '' : r.dx.toFixed(1), r.dy === null ? '' : r.dy.toFixed(1), r.box ? frameState(r.box) : 'none']), ['time', 'clip', 'n', 'x', 'y', 'w', 'h', 'dx', 'dy', 'frame']));
          console.log(path.relative(process.cwd(), out));
        }
      });
      return EXIT.ok;
    },
  },
  bench: {
    args: '[clip...|effect...]',
    summary: `GPU benchmarks: every effect and clip, or the named clips and effects; prints scene cost against the ${(1000 / 60).toFixed(1)} ms preview budget; appends to bench/results.jsonl`,
    options: {
      ...PROJECT_OPT,
      compare: sOpt('compare with the records of this commit (or `last`: the newest earlier run) of the same machine, scale and project; marks changes over 10 % and over the spread'),
      n: sOpt('measured frames per benchmark (default 30)'),
      'no-scenes': bOpt('effects only: no scene benchmarks'),
      scale: sOpt('output scale (default 1; the budget table shows at scale 1 only)'),
      dry: bOpt('print the results, append nothing'),
      out: sOpt('JSONL file to append to (default bench/results.jsonl)'),
      board: sOpt('file,file[#Class]: also benchmark scene files that video.json does not name (as pve board; each exported scene class, or the named one), and only those when no other name is given'),
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      // --board: scene files under the project folder that video.json does not name (as `pve board`), benchmarked as scene.<file name>
      const boards = typeof a.values.board === 'string' ? a.values.board.split(',').flatMap((file) => {
        const [cleanPath, exp] = file.trim().split('#');
        const { abs, rel } = resolveBoardFile(p, cleanPath!);
        if (exp) {
          return [{ src: `/${rel}#${exp}`, id: slug(exp) }];
        }
        const content = readFileSync(abs, 'utf8');
        const classes = [...content.matchAll(/export\s+class\s+([A-Za-z0-9_]+)\s+extends/g)].map((m) => m[1]!);
        if (classes.length) {
          return classes.map((c) => ({ src: `/${rel}#${c}`, id: slug(c) }));
        }
        return [{ src: `/${rel}`, id: slug(path.basename(abs, path.extname(abs))) }];
      }) : [];
      await runBench({
        project: servedId(p),
        names: a.positionals,
        clipIds: p.resolved.clips.map((c) => c.id),
        n: num(a, 'n', 30),
        scenes: !a.values['no-scenes'],
        scale: num(a, 'scale', 1),
        dry: a.values.dry === true,
        compareRef: typeof a.values.compare === 'string' ? a.values.compare : undefined,
        out: typeof a.values.out === 'string' ? path.resolve(a.values.out) : undefined,
        boards,
      });
      // (a scene over the budget is not an error: the table says OVER BUDGET, the agent decides)
      return EXIT.ok;
    },
  },
  perf: {
    args: '[clip...]',
    summary: 'real-time playback: plays the clips (all without names) one frame per animation frame, as the live preview does, with the software 2D canvas of every headless render; prints the CPU time of each render, the interval between frames, frames that missed a display refresh and the fps reached',
    options: {
      ...PROJECT_OPT, ...JSON_OPT,
      from: sOpt('start: seconds or a time expression (bar:12)'),
      to: sOpt('end: seconds or a time expression'),
      step: sOpt('play every n-th frame (default 1)'),
      profile: bOpt('add the functions with the most CPU self time per clip'),
      'gpu-canvas': bOpt('the GPU 2D canvas of the live preview instead of the software canvas, to compare'),
      draws: bOpt('add, per frame, the render calls, the draw calls (and those into shadow maps) and the program lookups of three by cause (lightsStateVersion: the set of lights changed between two renders; instancing: one material drew a mesh and an instanced mesh in turn). The counters cost time: do not read times from such a run'),
      frames: bOpt('list every frame'),
      slow: sOpt('list only the frames whose CPU time or interval is at least this many ms'),
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      const all = p.resolved.clips;
      const unknown = a.positionals.filter((id) => !all.some((c) => c.id === id));
      if (unknown.length) throw new UsageError(`no clip ${unknown.join(', ')}. Clips: ${all.map((c) => c.id).join(', ')}`);
      const fromTime = a.values.from !== undefined ? timeOf(p, str(a, 'from', '0')) : undefined;
      const toTime = a.values.to !== undefined ? timeOf(p, str(a, 'to', 'end')) : undefined;
      const selected = a.positionals.length ? all.filter((c) => a.positionals.includes(c.id)) : all;
      const clips = selected.map((c) => {
        const s = fromTime !== undefined ? Math.max(c.start, fromTime) : c.start;
        const e = toTime !== undefined ? Math.min(c.end, toTime) : c.end;
        return { id: c.id, start: s, end: e };
      }).filter((c) => c.end > c.start);
      if (!clips.length) throw new UsageError(`no clip active in range ${fromTime ?? 0}..${toTime ?? 'end'}`);
      const showFrames = a.values.frames === true || a.values.slow !== undefined;
      const res = await runPerf({
        project: servedId(p), clips, fps: p.resolved.fps, step: num(a, 'step', 1),
        profile: a.values.profile === true, gpuCanvas: a.values['gpu-canvas'] === true, draws: a.values.draws === true,
        frames: showFrames,
      });
      if (a.values.json) print(res);
      else {
        const f = (s: { median: number; p90: number; max: number }) => `${s.median.toFixed(1)} / ${s.p90.toFixed(1)} / ${s.max.toFixed(1)}`;
        console.log(table(res.rows.map((r) => [r.clip, String(r.frames), r.fps.toFixed(1), String(r.missed), f(r.cpu), f(r.interval), r.worst.map(([t, ms, tag]) => `${fmtTime(t)} ${ms}${tag ? ` (${tag})` : ''}`).join(', ')]), ['clip', 'frames', 'fps', 'missed', 'cpu med/p90/max', 'interval med/p90/max', 'longest intervals']));
        console.log(`ms; display refresh ${res.refreshMs} ms (${(1000 / res.refreshMs).toFixed(0)} Hz); missed: an interval over 1.5 refreshes`);
        if (showFrames) {
          const slowThreshold = a.values.slow !== undefined ? (typeof a.values.slow === 'string' && a.values.slow !== '' ? Number(a.values.slow) : 1.5 * res.refreshMs) : 0;
          for (const r of res.rows) {
            if (!r.detail) continue;
            const filtered = r.detail.filter((d) => d.cpu >= slowThreshold || d.interval >= slowThreshold || slowThreshold === 0);
            if (filtered.length) {
              console.log(`\n${r.clip}: frames${slowThreshold > 0 ? ` >= ${slowThreshold} ms` : ''} (${filtered.length} frames)`);
              console.log(table(filtered.map((d) => [
                String(d.n),
                fmtTime(d.t),
                d.cpu.toFixed(1),
                d.interval.toFixed(1),
                d.cpu > 1.5 * res.refreshMs ? 'SLOW' : d.missed ? 'MISSED' : 'OK',
                d.tag ?? '',
              ]), ['frame', 'time', 'cpu ms', 'interval ms', 'status', 'tag']));
            }
          }
        }
        for (const r of res.rows) if (r.counts) console.log(`\n${r.clip}: per frame ${r.counts.renders} renders, ${r.counts.draws} draws (${r.counts.shadowDraws} into shadow maps); program lookups: ${r.counts.lookups.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}${r.counts.compiled.map((c) => `\n  compiled in the walk at ${c}`).join('')}`);
        for (const r of res.rows) if (r.hot) console.log(`\n${r.clip}: CPU self time (ms, whole walk)\n${table(r.hot.map(([fn, file, ms]) => [ms.toFixed(1), fn, file]), ['ms', 'function', 'where'])}`);
      }
      return EXIT.ok;
    },
  },
  render: {
    args: '',
    summary: 'MP4 of a range or the whole video: lossless segments per clip first, then one encode (NVENC on the GPU by default); writes frames.jsonl and a render record (bench/results.jsonl)',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT,
      from: sOpt('start: seconds or a time expression (default 0)'),
      to: sOpt('end: seconds or a time expression (default the end of the song)'),
      name: sOpt('render folder out/render/<name>/ (default <from>_<to> for a range, else full, 4k at --scale 2, or <height>p)'),
      clips: sOpt('render the segments of these clips (comma-separated) of the render --name again, then encode'),
      resume: bOpt('render the segments of the render --name that are not complete, then encode'),
      'no-encode': bOpt('render the segments only, no MP4'),
      'encode-only': bOpt('render nothing: encode the segments of the render --name'),
      frames: sOpt('root folder of the segments (default PVE_FRAMES, else out/render/<name>/frames): the segments go to <root>/<project>/<name>'),
      fps: sOpt('frames per second (default video.json)'),
      'segment-codec': sOpt('codec of the lossless segments: ffv1 (default), x264 or nvenc'),
      webcodecs: bOpt('the pages encode H.264 with WebCodecs: the segments and the MP4 copy that stream (no lossless segments, no second encode)'),
      encoder: sOpt('nvenc (H.264 on the GPU, default) or x264 (on the CPU, about 3 times slower)'),
      quality: sOpt('constant quality: NVENC -cq, x264 -crf (default 16)'),
      preset: sOpt('x264 preset (default slow)'),
      x264: sOpt('x264 parameters (default aq-mode=3)'),
      workers: sOpt('Chrome pages that render at the same time (default 2)'),
      chunk: sOpt('frames that a page renders per request (default 8)'),
      'mem-gb': sOpt('GB of finished frames that may wait for the segment writer before the pages pause (default 1)'),
      noaudio: bOpt('no audio track (default: the song mix, AAC)'),
      out: sOpt('MP4 file (default out/render/<name>/<project>-<name>.mp4)'),
      headed: bOpt('show the Chrome windows'),
      'progress-json': bOpt('print PROGRESS: <json> lines (frames, fps, eta, clips) for a UI'),
      'first-frame': sOpt('after the encode, replace frame 0 of the MP4 with this image (thumbnail, as pve first-frame)'),
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      const id = servedId(p);
      const o = sampling(a, '1');
      const ranged = a.values.from !== undefined || a.values.to !== undefined;
      const fromExpr = str(a, 'from', '0'), toExpr = str(a, 'to', 'end');
      const defaultName = ranged ? `${fromExpr}_${toExpr}` : renderName(o.scale);
      const name = slug(str(a, 'name', defaultName));
      const dir = path.join(p.dir, 'out/render', name);
      const redo = typeof a.values.clips === 'string' ? a.values.clips.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const mode = redo ? 'clips' : a.values.resume ? 'resume' : 'new';
      if (mode !== 'new' && ranged) throw new UsageError(`--${mode} works on an earlier render: give --name, not --from/--to`);
      if (redo && a.values.resume) throw new UsageError('give --clips or --resume, not both');
      const segCodec = str(a, 'segment-codec', 'ffv1') as SegmentCodec;
      if (segCodec !== 'ffv1' && segCodec !== 'x264' && segCodec !== 'nvenc') throw new UsageError('--segment-codec takes ffv1, x264 or nvenc');
      const encoder = str(a, 'encoder', 'nvenc');
      if (encoder !== 'nvenc' && encoder !== 'x264') throw new UsageError('--encoder takes nvenc or x264');
      const encode = { mix: a.values.noaudio ? null : p.song.prompt.mixPath, encoder, quality: str(a, 'quality', '16'), preset: str(a, 'preset', 'slow'), x264: str(a, 'x264', 'aq-mode=3'), out: typeof a.values.out === 'string' ? path.resolve(a.values.out) : undefined } as const;
      const root = typeof a.values.frames === 'string' ? a.values.frames : process.env.PVE_FRAMES;
      const framesDir = root ? path.resolve(root, id, name) : path.join(dir, 'frames');

      if (!a.values['encode-only']) {
        const { commit, dirty } = gitState();
        const r = await renderFrames({
          project: id, dir, name, framesDir, fps: num(a, 'fps', p.resolved.fps), ...o,
          from: timeOf(p, fromExpr), to: a.values.to !== undefined ? timeOf(p, toExpr) : p.resolved.duration, clips: p.resolved.clips.map((c) => ({ id: c.id, start: c.start })), mode, redo,
          workers: num(a, 'workers', 2), chunk: num(a, 'chunk', 8), memGb: num(a, 'mem-gb', 1), headed: a.values.headed === true,
          segmentCodec: segCodec,
          webcodecs: a.values.webcodecs === true,
          onProgress: a.values['progress-json'] ? (p) => {
            process.stdout.write(`\nPROGRESS: ${JSON.stringify(p)}\n`);
          } : undefined,
        });
        if (r.page) {
          const hist: Record<number, number> = {};
          for (const f of r.frames) hist[f.samples] = (hist[f.samples] ?? 0) + 1;
          console.log(`sub-frames per frame (count:frames): ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(' ')}`);
          const rec = renderRecord(r.frames, r.manifest, r.wallS, { ts: new Date().toISOString(), commit, dirty, machine: machine(r.page.gpu, r.page.chrome) });
          // a part of a render is its own workload: `render.<name>.<clips>` or `render.<name>.resume`
          if (mode !== 'new') rec.id = `${rec.id}.${redo ? redo.join('+') : 'resume'}`;
          appendRecords([rec]);
          console.log(`render record ${rec.id}: GPU median ${rec.medianMs} ms, p90 ${rec.p90Ms} ms over ${rec.n} of ${rec.frames} frames, ${rec.wallS} s wall (appended to bench/results.jsonl)`);
        }
      }
      if (a.values['no-encode']) return EXIT.ok;
      if (a.values['progress-json']) {
        process.stdout.write(`\nPROGRESS: ${JSON.stringify({ status: 'encoding' })}\n`);
      }
      const e = encodeVideo(dir, framesDir, encode);
      console.log(`\nwrote ${path.relative(process.cwd(), e.out)} (encode ${e.seconds.toFixed(1)} s)`);
      if (a.values['progress-json']) {
        process.stdout.write(`\nPROGRESS: ${JSON.stringify({ status: 'complete', outputFile: path.relative(process.cwd(), e.out) })}\n`);
      }
      const thumb = a.values['first-frame'] as string | undefined;
      if (thumb) {
        console.log(`replacing frame 0 with ${thumb}...`);
        const tmpOut = path.join(path.dirname(e.out), `${path.basename(e.out, path.extname(e.out))}.thumb-tmp${path.extname(e.out)}`);
        replaceFirstFrame({ video: e.out, image: path.resolve(thumb), out: tmpOut });
        copyFileSync(tmpOut, e.out);
        try { unlinkSync(tmpOut); } catch {}
        console.log(`replaced frame 0 with ${path.relative(process.cwd(), path.resolve(thumb))}`);
      }
      return EXIT.ok;
    },
  },
  'first-frame': {
    args: '<video> <image>',
    summary: 'replace the first frame of a video with an image (thumbnail for video platforms): the audio is copied, the video encoded again',
    options: {
      out: { type: 'string', short: 'o', desc: 'output file (default: next to the video)' },
      encoder: sOpt('nvenc (default) or x264'),
      crf: sOpt('constant quality: NVENC -cq (default 16), x264 -crf (default 14)'),
      preset: sOpt('NVENC p1..p7 (default p7), x264 preset (default slow)'),
    },
    async run(a) {
      if (a.positionals.length !== 2) throw new UsageError('first-frame takes <video> <image>');
      const [video, image] = a.positionals as [string, string];
      const encoder = str(a, 'encoder', 'nvenc');
      if (encoder !== 'nvenc' && encoder !== 'x264') throw new UsageError('--encoder takes nvenc or x264');
      const out = replaceFirstFrame({
        video,
        image,
        out: typeof a.values.out === 'string' ? a.values.out : undefined,
        encoder,
        crf: typeof a.values.crf === 'string' ? a.values.crf : undefined,
        preset: typeof a.values.preset === 'string' ? a.values.preset : undefined,
      });
      console.log(`wrote ${path.relative(process.cwd(), out)}`);
      return EXIT.ok;
    },
  },
  notes: {
    args: '[<filter> | resolve <id>]',
    summary: 'the open director notes (from video/notes.json and video/notes/*.md) with time, bar.beat, clip and position; <filter> filters by note id or text; resolve marks a JSON note done',
    options: { ...PROJECT_OPT, ...JSON_OPT, all: bOpt('also the resolved notes') },
    async run(a) {
      const [sub, id, ...rest] = a.positionals;
      if (sub === 'resolve') {
        if (!id || rest.length) throw new UsageError('use: pve notes resolve <id>');
        const n = resolveNote(findProject(projectOf(a)), id);
        console.log(`resolved ${n.id} (${fmtTime(n.t)}): ${n.text}`);
        return EXIT.ok;
      }
      const p = await openProject(projectOf(a));
      let allNotes = readProjectNotes(p).filter((n) => a.values.all || !n.resolved);
      if (sub !== undefined) {
        const q = sub.toLowerCase();
        allNotes = allNotes.filter((n) => n.id.toLowerCase().includes(q) || n.text.toLowerCase().includes(q));
      }
      const rows = noteRows(p, allNotes);
      if (a.values.json) print(rows);
      else console.log(formatNotes(rows));
      return EXIT.ok;
    },
  },
  gate: {
    args: '',
    summary: 'every pre-commit check at once: tsc of each project of `bun run typecheck`, pve check, bun test, and the golden stills when the work tree changes the engine or pdoom_original. Stops at the first failure and prints its first lines',
    options: { ...PROJECT_OPT, ...JSON_OPT, ...GATE_OPT, 'keep-going': bOpt('run every step to its end after a failure') },
    async run(a) {
      const ref = findProject(projectOf(a));
      const report = await runGate(ref, gateOptions(a), porcelain());
      if (a.values.json) print({ project: ref.id, ...report });
      else console.log(formatGate(ref, report));
      return report.ok ? EXIT.ok : EXIT.error;
    },
  },
  commit: {
    args: '-m "<summary>"',
    summary: 'run the gate, then commit projects/<id>/ and the --paths and nothing else, with a Ran: list of the steps that passed. Run it only when the human asks for a commit',
    options: {
      ...PROJECT_OPT, ...GATE_OPT,
      message: { type: 'string', short: 'm', desc: 'the summary line of the commit (required)' },
      paths: sOpt('more paths to commit, comma-separated'),
      dry: bOpt('print the files, commit nothing'),
      'no-gate': bOpt('skip the gate'),
      push: bOpt('push to origin after the commit'),
    },
    async run(a) {
      const summary = typeof a.values.message === 'string' ? a.values.message.trim() : '';
      if (!summary) throw new UsageError('commit needs -m "<summary>"');
      const ref = findProject(projectOf(a));
      const own = path.relative(ROOT, ref.dir).replaceAll('\\', '/');
      if (own.startsWith('..') || path.isAbsolute(own)) throw new UsageError(`${ref.dir} is not inside the repository`);
      const extra = typeof a.values.paths === 'string' ? a.values.paths.split(',').map((s) => s.trim()).filter(Boolean) : [];
      let ran: GateResult[] = [];
      if (!a.values['no-gate']) {
        const report = await runGate(ref, gateOptions(a), porcelain());
        console.log(formatGate(ref, report));
        if (!report.ok) return EXIT.error;
        ran = report.steps;
      }
      const isDry = a.values.dry === true;
      const r = commitPaths(ROOT, commitMessage(summary, ran, a.values['no-gate'] ? ['gate skipped (--no-gate)'] : []), [own, ...extra], isDry);
      if (isDry) {
        console.log(`dry run: would commit ${r.files.length} file${r.files.length === 1 ? '' : 's'} in ${[own, ...extra].join(', ')}:\n${r.files.map((f) => `  ${f}`).join('\n')}`);
        return EXIT.ok;
      }
      console.log(`committed ${r.commit}: ${r.files.length} file${r.files.length === 1 ? '' : 's'} in ${[own, ...extra].join(', ')}`);
      if (a.values.push) {
        const branchProc = Bun.spawnSync(['git', 'branch', '--show-current'], { cwd: ROOT });
        const branch = branchProc.stdout.toString().trim() || 'main';
        console.log(`pushing to origin/${branch}...`);
        const p = Bun.spawnSync(['git', 'push', 'origin', branch], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
        if (p.exitCode !== 0) throw new CliError({ rule: 'commit', message: `git push failed (exit ${p.exitCode})` });
      }
      return EXIT.ok;
    },
  },
  doctor: {
    args: '',
    summary: 'Bun, ffmpeg, Chrome, GPU, timer query support, Lyric-Sync link, Vite',
    options: JSON_OPT,
    async run(a) {
      const t0 = performance.now();
      const found = await doctor();
      if (a.values.json) print(found);
      else {
        console.log(table(found.map((f) => [f.name, f.ok ? 'ok' : 'FAIL', f.detail]), undefined, ''));
        console.log(`(${Math.round(performance.now() - t0)} ms)`);
      }
      return found.every((f) => f.ok) ? EXIT.ok : EXIT.error;
    },
  },
  job: {
    args: '<command> [args] [--wait]',
    summary: `start a pve command in the background and return at once: prints the job id, the pid and the log (out/jobs/<id>.log). Use it for each command that can take longer than about a minute (look, render, bench, perf, gate)`,
    options: { wait: bOpt(`block until the job ends (at most ${MAX_WAIT_S} s), print the log and exit with the job's exit code`) },
    raw: true,
    async run(a) {
      let wait = false;
      const pos = a.positionals.filter((arg) => {
        if (arg === '--wait') { wait = true; return false; }
        return true;
      });
      const [name] = pos;
      if (!name || !COMMANDS[name] || name === 'job' || name === 'wait') throw new UsageError('job needs a pve command, for example: pve job look -p sardine chorus_1');
      const job = startJob(pos);
      if (!wait) {
        console.log(`job ${job.id}  pid ${job.pid}  log ${path.relative(process.cwd(), logPath(job.id))}`);
        return EXIT.ok;
      }
      return reportJob(await waitJob(job, MAX_WAIT_S), 15);
    },
  },
  diff: {
    args: '<imageA.png> <imageB.png>',
    summary: 'compare two PNG files: prints mean channel diff, max diff, differing pixels and their box (x0,y0-x1,y1). Exit 0 when the mean diff is at most --tol, else exit 1',
    options: { tol: sOpt('largest mean channel diff that passes (default 0)') },
    async run(a) {
      if (a.positionals.length !== 2) throw new UsageError('diff takes <imageA.png> <imageB.png>');
      const [pA, pB] = a.positionals as [string, string];
      if (!existsSync(pA)) throw new UsageError(`file not found: ${pA}`);
      if (!existsSync(pB)) throw new UsageError(`file not found: ${pB}`);
      const imA = decodePng(readFileSync(pA));
      const imB = decodePng(readFileSync(pB));
      const { ok, line } = diffLine(imA, imB, num(a, 'tol', 0));
      console.log(`diff: ${line}`);
      return ok ? EXIT.ok : EXIT.error;
    },
  },
  seam: {
    args: '',
    summary: 'render the first frame (t = 0) and the last frame (t = duration - 1/fps) and compare them (loop seam check). Exit 0 when the mean diff is at most --tol, else exit 1',
    options: { ...PROJECT_OPT, ...SAMPLE_OPT, tol: sOpt('largest mean channel diff that passes (default 0.28; with --samples auto also the sampling tolerance)') },
    async run(a) {
      const p = await openProject(projectOf(a));
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      const d = p.resolved.duration;
      const t0 = 0;
      const tLast = d - 1 / p.resolved.fps;
      const dir = path.join(p.dir, 'out/stills');
      const f0 = stillFile(dir, t0);
      const fLast = stillFile(dir, tLast);
      const items = [{ t: t0, file: f0 }, { t: tLast, file: fLast }];
      await withPage(servedId(p), { scale: o.scale, only: onlyOf(p, [t0, tLast]), warm: true }, (page) => stills(page, items, o));
      const { ok, line } = diffLine(decodePng(readFileSync(f0)), decodePng(readFileSync(fLast)), num(a, 'tol', 0.28));
      console.log(`seam ${p.id}: ${line}`);
      return ok ? EXIT.ok : EXIT.error;
    },
  },
  order: {
    args: '<target> [time|from..to...]',
    summary: 'find the frame that leaves state behind: render the target on a new page (the reference), then again after other frames, and compare (a frame must be a pure function of its time). The page loads only the clips of these frames. Default: one page, each time then the target. Exit 1 when a trial differs',
    options: {
      ...PROJECT_OPT, ...JSON_OPT, ...PRECISION_OPT,
      fresh: bOpt('a new page for each time: the time, then the target'),
      chain: bOpt('a new page: all the times in order, then the target'),
      repeat: sOpt('with --chain: n trials, each on a new page (default 1)'),
      bisect: bOpt('as --chain, then drop times while the target still differs (prints a short list that is enough)'),
      seed: sOpt('add the frames before the target in the shuffled order of pve determinism with this seed (use with --chain or --bisect)'),
      n: sOpt('with --seed: the number of times of the determinism run (default 400)'),
      last: sOpt('keep only the last k times'),
      step: sOpt('seconds between the times of a range (default 1)'),
      draws: bOpt('when the target differs, compare its draw calls with the reference (what three drew, in which order, and the calls whose inputs differ: matrices, vertex and instance data, uniforms, data textures, GL state)'),
      outputs: bOpt('with --draws: also read the picture back after each draw and name the first draw whose picture differs (slow; a readback can hide a rounding fault)'),
      watch: sOpt('with --draws: read back after this draw call only; on one page it lists the texels that differ and compares what the GPU holds (uniforms, vertex buffers, shader source)'),
      between: sOpt('JavaScript to run on the page before the target (`e` is the engine), to test a guess such as e.renderer.resetState()'),
      culprit: bOpt('with <target> <bad time> --good <time>: leave draw calls of the bad frame out until the target is right, and print the calls that are enough'),
      good: sOpt('with --culprit: a frame of the same clip that makes the target right again'),
      png: sOpt('folder: write ref.png, and got-NN.png + mask-NN.png (white: differs) for each trial that differs'),
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      if (a.positionals.length < 1) throw new UsageError('order takes <target> [time|from..to...]');
      const target = timeOf(p, a.positionals[0]!);
      let after = expandTimes(p, a.positionals.slice(1), num(a, 'step', 1), 400);
      if (typeof a.values.seed === 'string') {
        const { shuffled } = seededTimes(num(a, 'seed', 0), num(a, 'n', 400), p.resolved.duration);
        const i = shuffled.indexOf(target);
        if (i < 0) throw new UsageError(`--seed: ${target} is not one of the seeded times (take the time from the determinism output)`);
        after = [...after, ...shuffled.slice(0, i)];
      }
      if (typeof a.values.last === 'string') after = after.slice(-num(a, 'last', 0));
      if (after.length === 0) throw new UsageError('order needs the times to render before the target (or --seed)');
      const mode = a.values.bisect ? 'bisect' : a.values.chain ? 'chain' : a.values.fresh ? 'fresh' : 'each';
      const only = [...new Set([target, ...after].map((t) => clipAt(p, t)?.id).filter((id) => id !== undefined))].join(',');
      const precision = hdrOf(a);
      if (a.values.culprit) {
        // the subtractive search: leave draw calls of the bad frame out until the target is right
        if (after.length !== 1 || typeof a.values.good !== 'string') throw new UsageError('--culprit takes <target> <bad time> --good <time>: the frame that makes the target wrong, and a frame of the same clip that makes it right again');
        const lines = await findCulprit({ project: servedId(p), only, hdr: precision, target, bad: after[0]!, good: timeOf(p, a.values.good), log: (l) => console.error(l) });
        console.log(lines.join('\n'));
        return EXIT.ok;
      }
      const rows = await runOrder({ project: servedId(p), only, hdr: precision, target, after, mode, png: typeof a.values.png === 'string' ? path.resolve(a.values.png) : null, draws: a.values.draws === true, watch: num(a, 'watch', a.values.outputs ? -2 : -1), between: typeof a.values.between === 'string' ? a.values.between : '', repeat: num(a, 'repeat', 1), log: (l) => console.error(l) });
      const label = (t: number) => `${t} (${clipAt(p, t)?.id})`;
      for (const r of rows) {
        if (a.values.json) { console.log(JSON.stringify({ target, ...r, clips: r.after.map((t) => clipAt(p, t)?.id) })); continue; }
        const list = r.after.length > 8 ? `${r.after.length} frames … ${r.after.slice(-3).map(label).join(', ')}` : r.after.map(label).join(', ');
        console.log(`after ${list}: ${r.same ? 'same' : `DIFFERS  max ${r.maxDiff}  ${r.pixels} px  box ${r.box ? `${r.box[0]},${r.box[1]}-${r.box[2]},${r.box[3]}` : '-'}${r.mask ? `  ${path.relative(process.cwd(), r.mask)}` : ''}`}`);
        if (r.draws !== null) console.log(`  ${r.draws}`);
      }
      const last = rows[rows.length - 1]!;
      if (mode === 'bisect' && !last.same) console.log(`enough to change ${label(target)}: ${last.after.map(String).join(' ')}`);
      return rows.some((r) => !r.same) ? EXIT.error : EXIT.ok;
    },
  },
  nan: {
    args: '<time|from..to...>',
    summary: 'find the draw call that writes NaN or Inf into a float target (it shows as a black dot or block after the next 8-bit pass). Renders each time with a readback after each draw: a draw that adds texels that are not finite is a source; prints its target, material, the box in frame px and where the page called it (file:line). Exit 1 when a frame has such texels',
    options: {
      ...PROJECT_OPT, ...JSON_OPT, ...PRECISION_OPT,
      at: sOpt('x,y in 1920x1080 px (y down): also print the value of this point after each draw that changes it (follow a dot through the passes)'),
      step: sOpt('seconds between the times of a range (default 0.1)'),
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      if (!a.positionals.length) throw new UsageError('nan needs at least one time (or from..to)');
      const times = expandTimes(p, a.positionals, num(a, 'step', 0.1), 60);
      let at: [number, number] | null = null;
      if (typeof a.values.at === 'string') {
        const v = a.values.at.split(',').map(Number);
        if (v.length !== 2 || v.some((x) => !Number.isFinite(x))) throw new UsageError('--at takes x,y in 1920x1080 px');
        at = [v[0]!, v[1]!];
      }
      const box = (b: [number, number, number, number]) => `${b[0]},${b[1]}-${b[2]},${b[3]}`;
      const frames = await runNan({ project: servedId(p), only: onlyOf(p, times), hdr: hdrOf(a), times, at }, (f) => {
        if (a.values.json) { console.log(JSON.stringify(f)); return; }
        console.log(`${frameLabel(p, f.t)}: ${f.draws} draws, ${f.sources.length ? `${f.sources.length} draw${f.sources.length === 1 ? '' : 's'} write NaN/Inf` : 'all float targets finite'}`);
        // the first draw is the source; a later draw into another target can add texels only because it reads the first one's
        f.sources.forEach((d, i) => console.log(`  ${i === 0 ? 'SOURCE' : 'also  '} call ${d.call}: +${d.added} (${d.nan} NaN, ${d.inf} Inf)  box ${box(d.box)}  ${d.key}\n    at ${d.from}${i === 0 ? '' : '  (may only read an earlier source)'}`));
        if (f.later.length) console.log(`  ${f.later.length} later draws keep or carry them (first: call ${f.later[0]!.call} ${f.later[0]!.key})`);
        for (const s of f.trace) console.log(`  @ call ${s.call}: ${s.value.map((v) => (Number.isInteger(v) ? String(v) : v.toPrecision(4))).join(' ')}  ${s.key}  at ${s.from}`);
      });
      return frames.some((f) => f.sources.length > 0) ? EXIT.error : EXIT.ok;
    },
  },
  serve: {
    args: 'start | stop | status | run',
    summary: 'the render server: keeps a dev server and a headless Chrome running between commands. While it runs, every command opens its pages in that Chrome (no start of Vite and Chrome), and still, look, probe, seam and nan reuse a warm page of the same clips (no page boot). A warm page with older sources than the files closes and boots again. start: in the background, prints the state (and returns at once when one runs); stop; status: the state and the pages; run: in this process. It serves the commands of its ANGLE backend only (PVE_ANGLE). PVE_NO_SERVE=1 makes a command start its own',
    options: {
      ...JSON_OPT,
      idle: sOpt('minutes without a command, then the server stops (default 30)'),
    },
    async run(a) {
      const [sub, ...rest] = a.positionals;
      if (rest.length) throw new UsageError('serve takes one of start, stop, status, run');
      const idle = num(a, 'idle', 30);
      if (!(idle > 0)) throw new UsageError('--idle takes a positive number of minutes');
      if (sub === 'run') { await runServe(idle); return EXIT.ok; }
      if (sub === 'start') {
        const s = await startServe(idle);
        console.log(a.values.json ? JSON.stringify(s) : `render server pid ${s.pid}: ${s.url}, Chrome ${s.cdp} (${s.angle}), since ${s.since}, stops after ${s.idleMin} min idle`);
        return EXIT.ok;
      }
      if (sub === 'stop') {
        const s = stopServe();
        console.log(s ? `stopped the render server (pid ${s.pid})` : 'no render server runs');
        return EXIT.ok;
      }
      if (sub === 'status') {
        const s = readServe();
        if (!s) { console.log(a.values.json ? 'null' : 'no render server runs (start one with pve serve start)'); return EXIT.ok; }
        const ps = await servePages(s);
        if (a.values.json) { console.log(JSON.stringify({ ...s, pages: ps })); return EXIT.ok; }
        console.log(`render server pid ${s.pid}: ${s.url}, Chrome ${s.cdp} (${s.angle}), since ${s.since}, stops after ${s.idleMin} min idle`);
        for (const pg of ps) console.log(`  ${pg.project}  clips ${pg.only}  ${pg.leased ? `in use by pid ${pg.leased}` : pg.warm ? `warm, idle ${pg.idleS} s` : 'in use (not warm)'}`);
        return EXIT.ok;
      }
      throw new UsageError('serve takes one of start, stop, status, run');
    },
  },
  wait: {
    args: '[id]',
    summary: 'block until a job ends (default: the newest job), then print its log and exit with its exit code. It returns on the poll tick after the command ends. When the job still runs at the timeout: print the last lines of the log and exit 3. Wait again, or stop it with taskkill /PID <pid> /T /F',
    options: {
      timeout: sOpt(`seconds to wait (default and maximum ${MAX_WAIT_S})`),
      tail: sOpt('log lines to print when the job still runs (default 15)'),
    },
    async run(a) {
      if (a.positionals.length > 1) throw new UsageError('wait takes at most one job id');
      const timeout = num(a, 'timeout', MAX_WAIT_S);
      if (!(timeout > 0)) throw new UsageError('--timeout takes a positive number of seconds');
      return reportJob(await waitJob(findJob(a.positionals[0]), timeout), num(a, 'tail', 15));
    },
  },
  chat: {
    args: '<send|wait|read|status|clear>',
    summary: `a chat room for the agents of other harnesses and the human, in <project>/${CHAT_DIR}/<room>.jsonl (git ignores it). send appends a message. wait blocks until a message for --as comes (from another participant, to --as or to all), prints it and exits 0, or exits 3 at the timeout: wait again. read prints messages, status the counts, clear empties the room`,
    options: {
      ...PROJECT_OPT,
      as: sOpt('your participant id, such as claude, designer or human (send, wait and read --unread need it)'),
      room: sOpt('room name: letters, digits, - and _ (default main)'),
      to: sOpt('send: the participant id to send to, or * (default: all)'),
      message: { type: 'string', short: 'm', desc: 'send: the body (markdown). -m - reads it from stdin' },
      file: sOpt('send: read the body from this markdown file'),
      files: sOpt('send: paths from the repository root to attach, separated by commas'),
      'needs-human': bOpt('send: the sender waits for the human director'),
      timeout: sOpt(`wait: seconds (default ${MAX_WAIT_S}; 0: no timeout). Exit 3 on timeout`),
      after: sOpt('wait: take the messages after this seq, not after your cursor'),
      peek: bOpt('wait: do not move your cursor'),
      last: sOpt('read: the last n messages (default 10). Cursors do not move'),
      unread: bOpt('read: your unread messages, and move your cursor'),
      all: bOpt('read: all messages. Cursors do not move'),
      ...JSON_OPT,
    },
    async run(a) {
      const [action, ...more] = a.positionals;
      if (more.length) throw new UsageError('chat takes one action');
      const ref = findProject(projectOf(a));
      let room;
      try {
        room = openRoom(ref.dir, str(a, 'room', 'main'));
      } catch (e) {
        throw new UsageError(e instanceof Error ? e.message : String(e));
      }
      const me = str(a, 'as', '');
      const json = a.values.json === true;
      const show = (ms: ChatMsg[]) => {
        for (const m of ms) console.log(json ? JSON.stringify(m) : `${formatMessage(m)}\n`);
      };
      const needMe = () => {
        if (!me) throw new UsageError(`chat ${action} needs --as <id>`);
      };
      if (action === 'send') {
        needMe();
        const text = a.values.message, file = a.values.file;
        if (typeof text === 'string' && typeof file === 'string') throw new UsageError('send takes -m or --file, not both');
        const body = typeof file === 'string' ? readFileSync(path.resolve(file), 'utf8') : text === '-' ? await Bun.stdin.text() : typeof text === 'string' ? text : '';
        if (!body.trim()) throw new UsageError('send needs a body: -m <text>, -m - (stdin) or --file <md>');
        const files = str(a, 'files', '').split(',').map((f) => f.trim()).filter(Boolean);
        if (files.some((f) => path.isAbsolute(f))) throw new UsageError('--files takes paths from the repository root');
        const to = str(a, 'to', '') || undefined;
        const m = sendMessage(room, { from: me, to, body, files, needsHuman: a.values['needs-human'] === true });
        console.log(json ? JSON.stringify(m) : `sent #${m.seq}`);
        return EXIT.ok;
      }
      if (action === 'wait') {
        needMe();
        const timeout = num(a, 'timeout', MAX_WAIT_S);
        if (!(timeout >= 0)) throw new UsageError('--timeout takes 0 (no timeout) or a positive number of seconds');
        const after = a.values.after === undefined ? undefined : num(a, 'after', 0);
        const got = await waitUnread(room, me, timeout, { after, peek: a.values.peek === true });
        if (!got.length) {
          console.log(`chat ${room.name}: no message for ${me} after ${timeout} s`);
          return EXIT.running;
        }
        show(got);
        return EXIT.ok;
      }
      if (action === 'read') {
        if ([a.values.unread, a.values.all, a.values.last !== undefined].filter(Boolean).length > 1) throw new UsageError('read takes one of --unread, --all, --last');
        if (a.values.unread) {
          needMe();
          const got = takeUnread(room, me);
          if (!got.length && !json) console.log(`chat ${room.name}: no unread message for ${me}`);
          show(got);
          return EXIT.ok;
        }
        const last = num(a, 'last', 10);
        if (!Number.isInteger(last) || last < 1) throw new UsageError('--last takes a whole number of at least 1');
        const all = readMessages(room);
        show(a.values.all ? all : all.slice(-last));
        return EXIT.ok;
      }
      if (action === 'status') {
        const s = roomStatus(room);
        if (json) { console.log(JSON.stringify(s)); return EXIT.ok; }
        const last = s.last ? `, last #${s.last.seq} from ${s.last.from} at ${s.last.ts}${s.last.needsHuman ? ', NEEDS HUMAN' : ''}` : '';
        console.log(`chat ${s.room}: ${s.messages} messages${last}`);
        const unread = Object.entries(s.unread);
        if (unread.length) console.log(`unread: ${unread.map(([p, n]) => `${p} ${n}`).join(', ')}`);
        return EXIT.ok;
      }
      if (action === 'clear') {
        clearRoom(room);
        console.log(`chat ${room.name}: cleared`);
        return EXIT.ok;
      }
      throw new UsageError('chat takes one of send, wait, read, status, clear');
    },
  },
  golden: {
    args: '',
    summary: `compare one still of ${GOLDEN_PROJECT} per timeline entry (at its middle, scale 1, 1 sample) with tests/golden/<id>.png. Pass: max diff 0. A still that differs by 1 level in at most 2 pixels renders once more, and that render must have max diff 0. Exit 1 on a failure`,
    options: { capture: bOpt('write tests/golden/<id>.png instead of comparing') },
    async run(a) {
      if (a.positionals.length) throw new UsageError('golden takes no arguments');
      return (await runGolden(a.values.capture === true)) ? EXIT.ok : EXIT.error;
    },
  },
  determinism: {
    args: '',
    summary: 'seek determinism: render seeded random times in time order, then shuffled, and compare the pixels of each time. A difference at 32-bit HDR precision is an order fault and fails. A difference at 16 bits only is the blend rounding of the GPU: reported, and the check passes (docs/ENGINE.md). Find the cause with pve order --seed',
    options: {
      project: { type: 'string', short: 'p', desc: 'project id (default pdoom_original)' },
      n: sOpt('number of times (default 100)'),
      seed: sOpt('seed of the times and of the shuffle (default 1337)'),
      precision: sOpt('both (32 bits, then 16 bits; default), float (32 bits only) or half (16 bits only: a difference fails)'),
    },
    async run(a) {
      if (a.positionals.length) throw new UsageError('determinism takes no arguments');
      const precision = str(a, 'precision', 'both');
      if (precision !== 'both' && precision !== 'float' && precision !== 'half') throw new UsageError('--precision takes both, float or half');
      const ok = await runDeterminism({ project: str(a, 'project', 'pdoom_original'), n: num(a, 'n', 100), seed: num(a, 'seed', 1337), precision });
      return ok ? EXIT.ok : EXIT.error;
    },
  },
  'verify-export': {
    args: '',
    summary: 'check a full render: it decodes with no stream errors, its duration is the song duration (within 0.05 s), the video is H.264 at the size and fps of video.json, the audio is AAC with 2 channels at the sample rate of the mix',
    options: { ...PROJECT_OPT, input: sOpt('MP4 file (default <project>/out/render/full/<id>-full.mp4, the render with no range)') },
    async run(a) {
      if (a.positionals.length) throw new UsageError('verify-export takes no arguments');
      return verifyExport(await openProject(projectOf(a)), typeof a.values.input === 'string' ? a.values.input : undefined) ? EXIT.ok : EXIT.error;
    },
  },
};

function usage(): string {
  const w = Math.max(...Object.entries(COMMANDS).map(([n, c]) => `${n} ${c.args}`.length));
  const lines = Object.entries(COMMANDS).map(([n, c]) => `  ${`${n} ${c.args}`.padEnd(w)}  ${c.summary}`);
  return `usage: pve <command> [args] [options]\nMost commands take --project <id|path> (-p). pve help <command> (or --help) lists the options of a command.\n\ncommands:\n${lines.join('\n')}`;
}
function commandHelp(name: string, cmd: Command): string {
  const lines = [
    `pve ${name}: ${cmd.summary}`,
    '',
    `usage: pve ${name}${cmd.args ? ` ${cmd.args}` : ''}`,
  ];
  const opts = Object.entries(cmd.options ?? {});
  if (opts.length) {
    lines.push('', 'options:');
    const flags = opts.map(([k, opt]) => `${opt.short ? `-${opt.short}, ` : '    '}--${k}${opt.type === 'string' ? ' <val>' : ''}`);
    const w = Math.max(...flags.map((f) => f.length));
    opts.forEach(([, opt], i) => lines.push(`  ${flags[i]!.padEnd(w)}  ${opt.desc}`));
  }
  return lines.join('\n');
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h') {
    console.log(usage());
    return name ? EXIT.ok : EXIT.usage;
  }
  if (name === 'help') {
    const target = rest[0];
    if (target && COMMANDS[target]) {
      console.log(commandHelp(target, COMMANDS[target]));
      return EXIT.ok;
    }
    console.log(usage());
    return EXIT.ok;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    console.error(`pve: unknown command '${name}'\n\n${usage()}`);
    return EXIT.usage;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(commandHelp(name, cmd));
    return EXIT.ok;
  }
  let args: Args;
  try {
    const options: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
    for (const [k, opt] of Object.entries(cmd.options ?? {})) options[k] = opt.short ? { type: opt.type, short: opt.short } : { type: opt.type };
    args = cmd.raw ? { positionals: rest, values: {} } : parseArgs({ args: rest, options, allowPositionals: true, strict: true });
    if (args.values.help) {
      console.log(commandHelp(name, cmd));
      return EXIT.ok;
    }
  } catch (e) {
    console.error(`pve ${name}: ${e instanceof Error ? e.message : e}\nusage: pve ${name} ${cmd.args}`);
    return EXIT.usage;
  }
  try {
    return await cmd.run(args);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`pve ${name}: ${e.message}\nusage: pve ${name} ${cmd.args}`);
      return EXIT.usage;
    }
    if (e instanceof CliError) {
      console.error(fmtProblem({ severity: 'error', ...e.problem }));
      return EXIT.error;
    }
    throw e;
  }
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (e) {
  console.error(`pve: ${e instanceof Error ? e.message : e}`);
  process.exit(EXIT.error);
}
