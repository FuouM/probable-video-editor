#!/usr/bin/env bun
// pve: the command line of the editor (DESIGN 8.2). Exit 0 = success, 1 = error, 2 = usage error.
// Every command except init works on one project: --project <id|path>, else PVE_PROJECT, else the folder
// (or the nearest folder above it) that has video/video.json.
import path from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { runBench } from './bench';
import { withPage } from './browser';
import { checkProject } from './check';
import { initProject } from './init';
import { CliError, EXIT, fmtBarBeat, fmtCounts, fmtProblem, fmtTime, table, UsageError } from './out';
import { find, focusOutline, formatFind, formatOutline, outline } from './outline';
import { appendRecords, gitState, machine } from './records';
import { clipAt, findProject, openProject, PROJECTS, servedId, timeOf, type Project } from './project';
import { encodeVideo, parseSamples, renderFrames, renderRecord, sheet, stills, type SegmentCodec, type SheetTile } from './render';
import { cropStrip, frameState, judgeSyllable, marksAt, nameMatcher, sungSyllables, union, type LyricCheck, type Rect } from './probe';
import { newScene } from './scene';
import { doctor } from './doctor';
import { formatNotes, noteRows, readNotes, resolveNote } from './notes';

interface Args {
  positionals: string[];
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
}

interface Command {
  /** Arguments after the command name, for the usage text. */
  args: string;
  summary: string;
  options?: ParseArgsOptionsConfig;
  run(a: Args): Promise<number>;
}

const PROJECT_OPT: ParseArgsOptionsConfig = { project: { type: 'string', short: 'p' } };
const JSON_OPT: ParseArgsOptionsConfig = { json: { type: 'boolean' } };
const SAMPLE_OPT: ParseArgsOptionsConfig = {
  samples: { type: 'string' }, 'min-samples': { type: 'string' }, 'max-samples': { type: 'string' }, tol: { type: 'string' }, refine: { type: 'string' },
  shutter: { type: 'string' }, scale: { type: 'string' },
};
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
  check: {
    args: '',
    summary: 'validate and lint: inputs, video.json, expressions, overlaps, cuts off the beat, scene files, banned calls, missing features',
    options: { ...PROJECT_OPT, ...JSON_OPT },
    async run(a) {
      const ref = findProject(projectOf(a));
      const t0 = performance.now();
      const r = await checkProject(ref);
      const ms = performance.now() - t0;
      const errors = r.problems.filter((p) => p.severity === 'error').length;
      if (a.values.json) {
        print({ project: ref.id, ok: errors === 0, clips: r.project?.resolved.clips.length ?? null, sceneFiles: r.sceneFiles, problems: r.problems, ms: Math.round(ms) });
      } else {
        for (const p of r.problems) console.log(fmtProblem(p));
        const clips = r.project ? `${r.project.resolved.clips.length} clips, ` : '';
        console.log(`${errors ? 'FAIL' : 'ok'}  ${ref.id}: ${clips}${r.sceneFiles} scene files, ${fmtCounts(r.problems)} (${Math.round(ms)} ms)`);
      }
      return errors ? EXIT.error : EXIT.ok;
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
      const notes = noteRows(p, readNotes(p).notes.filter((n) => !n.resolved && (!a.positionals.length || o.clips.some((c) => n.t >= c.start && n.t < c.end))));
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
      const hits = find(await openProject(projectOf(a)), a.positionals.join(' '));
      if (a.values.json) print(hits);
      else console.log(formatFind(hits));
      return hits.length ? EXIT.ok : EXIT.error;
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
    args: '<time...>',
    summary: 'PNG stills at the given times (seconds or expressions: @marker, lyric:text, clip:id.start, bar:12+2b)',
    options: { ...PROJECT_OPT, ...SAMPLE_OPT, out: { type: 'string' } },
    async run(a) {
      if (!a.positionals.length) throw new UsageError('still needs at least one time');
      const p = await openProject(projectOf(a));
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      const dir = path.resolve(str(a, 'out', path.join(p.dir, 'out/stills')));
      const items = a.positionals.map((x) => {
        const t = timeOf(p, x);
        return { t, file: path.join(dir, `still_${fmtTime(t).replace(/[:.]/g, '-')}.png`) };
      });
      const clips = items.map((it) => clipAt(p, it.t)?.id).filter(Boolean) as string[];
      const uniqueClips = [...new Set(clips)];
      const only = uniqueClips.length > 0 && uniqueClips.length <= 4 ? uniqueClips.join(',') : undefined;
      const counts = await withPage(servedId(p), { scale: o.scale, only }, (page) => stills(page, items, o));
      items.forEach((it, i) => console.log(`${path.relative(process.cwd(), it.file)}  ${frameLabel(p, it.t)}  ${counts[i]} sub-frame${counts[i] === 1 ? '' : 's'}`));
      return EXIT.ok;
    },
  },
  look: {
    args: '[clip...|cuts]',
    summary: 'contact sheet of real frames with time, clip and bar.beat on each tile: the whole song, the named clips (--n tiles each), or both sides of every cut',
    options: { ...PROJECT_OPT, ...SAMPLE_OPT, n: { type: 'string' }, cols: { type: 'string' }, out: { type: 'string' } },
    async run(a) {
      const p = await openProject(projectOf(a));
      const o = { ...sampling(a, '1'), fps: p.resolved.fps };
      const n = num(a, 'n', 12), cols = num(a, 'cols', 4);
      const clips = p.resolved.clips;
      const dt = 1 / p.resolved.fps;
      let tiles: SheetTile[];
      let label: string;
      let only: string | undefined;
      if (a.positionals.length === 1 && a.positionals[0] === 'cuts') {
        // per cut: a quarter second before, the last frame before, the first frame after, a quarter second after
        tiles = clips.slice(1).flatMap((c) => [c.start - 0.25, c.start - dt, c.start, c.start + 0.25].map((t, i) => ({ t, label: frameLabel(p, t), head: i === 0 })));
        label = 'cuts';
      } else if (a.positionals.length) {
        const unknown = a.positionals.filter((id) => !clips.some((c) => c.id === id));
        if (unknown.length) throw new UsageError(`no clip ${unknown.join(', ')}. Clips: ${clips.map((c) => c.id).join(', ')}`);
        tiles = a.positionals.flatMap((id) => {
          const c = clips.find((x) => x.id === id)!;
          return Array.from({ length: n }, (_, i) => c.start + ((i + 0.5) * c.dur) / n).map((t, i) => ({ t, label: frameLabel(p, t), head: i === 0 }));
        });
        label = a.positionals.join('+');
        only = a.positionals.join(',');
      } else {
        const d = p.resolved.duration;
        tiles = Array.from({ length: n }, (_, i) => ((i + 0.5) * d) / n).map((t) => ({ t, label: frameLabel(p, t) }));
        label = 'song';
      }
      const out = path.resolve(str(a, 'out', path.join(p.dir, `out/look/${slug(label)}.png`)));
      await withPage(servedId(p), { scale: o.scale, only }, (page) => sheet(page, tiles, cols, out, o));
      console.log(`${path.relative(process.cwd(), out)}  (${tiles.length} tiles)`);
      return EXIT.ok;
    },
  },
  probe: {
    args: '<time|from..to...> | --lyrics <clip...>',
    summary: 'named objects (scenes call mark from @pve/engine/marks): list them at times; --target <name|glob> tracks one (box, move, zoomed crop strip); --rect x,y,w,h crops a fixed box; --lyrics checks every sung syllable of clips is marked on screen',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT, ...JSON_OPT,
      target: { type: 'string', short: 't' }, rect: { type: 'string' }, pad: { type: 'string' }, zoom: { type: 'string' }, step: { type: 'string' },
      lyrics: { type: 'boolean' }, out: { type: 'string' },
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
        const ms = await withPage(servedId(p), { scale: o.scale, only: a.positionals.join(',') }, (page) => marksAt(page, items.map((s) => s.t), o));
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
      const times = a.positionals.flatMap((x) => {
        const i = x.indexOf('..');
        if (i < 0) return [timeOf(p, x)];
        const t0 = timeOf(p, x.slice(0, i)), t1 = timeOf(p, x.slice(i + 2));
        return Array.from({ length: Math.floor((t1 - t0) / step + 1e-6) + 1 }, (_, k) => t0 + k * step);
      });
      const uniq = [...new Set(times.map((t) => clipAt(p, t)?.id).filter(Boolean) as string[])];
      const only = uniq.length <= 4 ? uniq.join(',') : undefined;
      const target = typeof a.values.target === 'string' ? a.values.target : undefined;
      const fixed = typeof a.values.rect === 'string' ? a.values.rect.split(',').map(Number) : undefined;
      if (fixed && (fixed.length !== 4 || fixed.some((v) => !Number.isFinite(v)))) throw new UsageError('--rect takes x,y,w,h in frame px');
      const pad = num(a, 'pad', 24), zoom = num(a, 'zoom', 2);

      await withPage(servedId(p), { scale: o.scale, only }, async (page) => {
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
        const out = path.resolve(str(a, 'out', path.join(p.dir, `out/probe/${slug(target ?? 'rect')}_${fmtTime(times[0]!).replace(/[:.]/g, '-')}.png`)));
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
    options: { ...PROJECT_OPT, compare: { type: 'string' }, n: { type: 'string' }, 'no-scenes': { type: 'boolean' }, scale: { type: 'string' }, dry: { type: 'boolean' }, out: { type: 'string' } },
    async run(a) {
      const p = await openProject(projectOf(a));
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
      });
      // (a scene over the budget is not an error: the table says OVER BUDGET, the agent decides)
      return EXIT.ok;
    },
  },
  render: {
    args: '',
    summary: 'MP4 of a range (--from/--to: seconds or expressions) or the whole video: lossless segments per clip first (--frames or PVE_FRAMES sets their disk), then one encode on the GPU (--encoder x264 for the CPU); writes frames.jsonl and a render record',
    options: {
      ...PROJECT_OPT, ...SAMPLE_OPT,
      from: { type: 'string' }, to: { type: 'string' }, name: { type: 'string' }, clips: { type: 'string' }, resume: { type: 'boolean' },
      'no-encode': { type: 'boolean' }, 'encode-only': { type: 'boolean' }, frames: { type: 'string' }, fps: { type: 'string' },
      'segment-codec': { type: 'string' },
      encoder: { type: 'string' }, quality: { type: 'string' }, preset: { type: 'string' }, x264: { type: 'string' }, workers: { type: 'string' }, chunk: { type: 'string' },
      'mem-gb': { type: 'string' }, noaudio: { type: 'boolean' }, out: { type: 'string' }, headed: { type: 'boolean' },
      'progress-json': { type: 'boolean' },
    },
    async run(a) {
      const p = await openProject(projectOf(a));
      const id = servedId(p);
      const o = sampling(a, '1');
      const ranged = a.values.from !== undefined || a.values.to !== undefined;
      const fromExpr = str(a, 'from', '0'), toExpr = str(a, 'to', 'end');
      const defaultName = ranged ? `${fromExpr}_${toExpr}` : (o.scale === 2 ? '4k' : (o.scale > 1 ? `${Math.round(o.scale * 1080)}p` : 'full'));
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
          from: timeOf(p, fromExpr), to: timeOf(p, toExpr), clips: p.resolved.clips.map((c) => ({ id: c.id, start: c.start })), mode, redo,
          workers: num(a, 'workers', 2), chunk: num(a, 'chunk', 8), memGb: num(a, 'mem-gb', 1), headed: a.values.headed === true,
          segmentCodec: segCodec,
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
      return EXIT.ok;
    },
  },
  notes: {
    args: '[resolve <id>]',
    summary: 'the open director notes (video/notes.json) with time, bar.beat, clip and position; resolve marks one done',
    options: { ...PROJECT_OPT, ...JSON_OPT, all: { type: 'boolean' } },
    async run(a) {
      const [sub, id, ...rest] = a.positionals;
      if (sub === 'resolve') {
        if (!id || rest.length) throw new UsageError('use: pve notes resolve <id>');
        const n = resolveNote(findProject(projectOf(a)), id);
        console.log(`resolved ${n.id} (${fmtTime(n.t)}): ${n.text}`);
        return EXIT.ok;
      }
      if (sub !== undefined) throw new UsageError(`unknown notes command '${sub}'`);
      const p = await openProject(projectOf(a));
      const rows = noteRows(p, readNotes(p).notes.filter((n) => a.values.all || !n.resolved));
      if (a.values.json) print(rows);
      else console.log(formatNotes(rows));
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
};

function usage(): string {
  const w = Math.max(...Object.entries(COMMANDS).map(([n, c]) => `${n} ${c.args}`.length));
  const lines = Object.entries(COMMANDS).map(([n, c]) => `  ${`${n} ${c.args}`.padEnd(w)}  ${c.summary}`);
  return `usage: pve <command> [args] [--project <id|path>] [--json]\n\ncommands:\n${lines.join('\n')}`;
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    console.log(usage());
    return name ? EXIT.ok : EXIT.usage;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    console.error(`pve: unknown command '${name}'\n\n${usage()}`);
    return EXIT.usage;
  }
  let args: Args;
  try {
    args = parseArgs({ args: rest, options: cmd.options ?? {}, allowPositionals: true, strict: true });
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
