// pve check (DESIGN 8.1 step 4): validates and lints a project in under a second, without a browser.
//   song inputs load, video.json schema, time expressions, clip overlaps and gaps, cuts off the beat,
//   scene files exist and compile (Bun transpile), have a default class, use no banned calls, and read only
//   the audio features that the song has.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { lintVideo, OFF_BEAT_TOLERANCE_SEC, type Features } from '@pve/core';
import { CliError, fmtBarBeat, fmtTime, type Problem } from './out';
import { readNotes } from './notes';
import { loadProject, SCENES_DIR, VIDEO_FILE, type Project, type ProjectRef } from './project';

export interface CheckReport {
  problems: Problem[];
  /** Undefined when the song or the edit does not load. */
  project?: Project;
  /** Scene files read in video/scenes/. */
  sceneFiles: number;
}

const BANNED: { re: RegExp; call: string }[] = [
  { re: /\bMath\.random\s*\(/, call: 'Math.random()' },
  { re: /\bDate\.now\s*\(/, call: 'Date.now()' },
  { re: /\bperformance\.now\s*\(/, call: 'performance.now()' },
  { re: /\bnew\s+Date\s*\(\s*\)/, call: 'new Date()' },
];

/** Keys of `f.a` (AudioSample) and the features.json entry each one reads. Mix envelopes always exist. */
const SAMPLE_KEYS: Record<string, string | null> = {
  rms: null, low: null, mid: null, high: null,
  vocal: 'envelopes.vocal', drums: 'envelopes.drums', bass: 'envelopes.bass', other: 'envelopes.other',
  kick: 'onsets.kick', snare: 'onsets.snare', hat: 'onsets.hat', vonset: 'onsets.vocal',
};
/** AudioData methods: env/envPeak read an envelope, hit/events read onsets. */
const METHOD_KIND: Record<string, 'envelopes' | 'onsets'> = { env: 'envelopes', envPeak: 'envelopes', hit: 'onsets', events: 'onsets' };

export interface SceneScan {
  /** Line (1-based) and call of each banned call outside comments. */
  banned: { line: number; call: string }[];
  /** Line and features.json entry (`onsets.kick`) of each feature read. */
  reads: { line: number; feature: string }[];
  /** The file has `export default class`. */
  defaultClass: boolean;
}

/**
 * Blanks comments (keeps line breaks) so that the scans below see code and strings only. Strings and
 * template literals are kept; `${...}` inside a template is code.
 */
export function stripComments(src: string): string {
  let out = '';
  const stack: string[] = []; // open template literals and `${` code blocks
  let i = 0;
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    const inTemplate = stack[stack.length - 1] === '`';
    if (inTemplate) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === '`') { stack.pop(); out += c; i++; continue; }
      if (c === '$' && n === '{') { stack.push('{'); out += '${'; i += 2; continue; }
      out += c; i++; continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') { stack.push('`'); out += c; i++; continue; }
    if (stack.length && c === '{') { stack.push('{'); out += c; i++; continue; }
    if (stack.length && c === '}') { stack.pop(); out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/** Finds banned calls, feature reads and the default class in the source of a scene file. */
export function scanScene(src: string): SceneScan {
  const code = stripComments(src);
  const lines = code.split('\n');
  const banned: SceneScan['banned'] = [];
  const reads: SceneScan['reads'] = [];
  const keyRe = new RegExp(`\\.a\\.(${Object.keys(SAMPLE_KEYS).join('|')})\\b`, 'g');
  const methodRe = /\.(env|envPeak|hit|events)\(\s*['"]([A-Za-z]+)['"]/g;
  const destructRe = /\{([^{}]*)\}\s*=\s*[\w.]*\.a\b/g;
  lines.forEach((text, k) => {
    const line = k + 1;
    for (const b of BANNED) if (b.re.test(text)) banned.push({ line, call: b.call });
    for (const m of text.matchAll(keyRe)) {
      const feature = SAMPLE_KEYS[m[1]!];
      if (feature) reads.push({ line, feature });
    }
    for (const m of text.matchAll(methodRe)) reads.push({ line, feature: `${METHOD_KIND[m[1]!]}.${m[2]}` });
    for (const m of text.matchAll(destructRe)) {
      for (const part of m[1]!.split(',')) {
        const feature = SAMPLE_KEYS[part.split(':')[0]!.trim()];
        if (feature) reads.push({ line, feature });
      }
    }
  });
  return { banned, reads, defaultClass: /\bexport\s+default\s+class\b/.test(code) };
}

/** True when features.json has the entry: an envelope, or an onset kind with at least one hit. */
function hasFeature(features: Features, feature: string): boolean {
  const [kind, key = ''] = feature.split('.');
  const group: object = kind === 'onsets' ? features.onsets : features.envelopes;
  const v: unknown = key in group ? Object.getOwnPropertyDescriptor(group, key)?.value : undefined;
  return Array.isArray(v) && v.length > 0;
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** Runs every check. Never throws for a problem in the project: each one is a Problem. */
export async function checkProject(ref: ProjectRef): Promise<CheckReport> {
  const { project, problems } = await loadProject(ref);
  try {
    readNotes(ref);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    problems.push({ severity: 'error', ...e.problem });
  }
  const sceneDir = path.join(ref.dir, SCENES_DIR);
  const sceneFiles = existsSync(sceneDir) ? readdirSync(sceneDir).filter((f) => f.endsWith('.ts')).sort() : [];

  // scene files: compile, banned calls, feature reads (all files, helpers too)
  const scans = new Map<string, SceneScan>();
  for (const name of sceneFiles) {
    const file = `${SCENES_DIR}/${name}`;
    const src = readFileSync(path.join(ref.dir, file), 'utf8');
    try {
      transpiler.transformSync(src);
    } catch (e) {
      // Bun throws a BuildMessage: { message, position: { line, column } }, not an Error
      const p: unknown = typeof e === 'object' && e !== null && 'position' in e ? e.position : undefined;
      const pos = typeof p === 'object' && p !== null && 'line' in p && 'column' in p ? `line ${p.line}:${p.column}` : undefined;
      const message = typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e);
      problems.push({ severity: 'error', rule: 'scene-syntax', file, at: pos, message, fix: 'fix the TypeScript syntax' });
      continue;
    }
    const scan = scanScene(src);
    scans.set(name.slice(0, -3), scan);
    for (const b of scan.banned) {
      problems.push({
        severity: 'error', rule: 'banned-call', file, at: `line ${b.line}`,
        message: `${b.call} makes the frame depend on when it renders`,
        fix: 'derive everything from f.t: use hash(), noise1() or mulberry32(seed) from @pve/engine/util',
      });
    }
    if (project) {
      // one finding per missing feature, with every line that reads it
      const lines = new Map<string, number[]>();
      for (const r of scan.reads) {
        if (hasFeature(project.song.features, r.feature)) continue;
        const at = lines.get(r.feature) ?? [];
        if (!at.includes(r.line)) at.push(r.line);
        lines.set(r.feature, at);
      }
      for (const [feature, at] of lines) {
        problems.push({
          severity: 'error', rule: 'feature-missing', file, at: `line${at.length > 1 ? 's' : ''} ${at.join(', ')}`,
          message: `reads ${feature}, which generated/features.json of this song does not have (it reads as 0, no hits)`,
          fix: feature.startsWith('onsets.')
            ? 'use the beat grid (f.beat, f.beatPhase, audio.timeOfBeat) or an envelope instead, or add the detector output in Lyric-Sync'
            : 'use a mix envelope (rms, low, mid, high) instead, or add the stem to the song in Lyric-Sync',
        });
      }
    }
  }

  if (!project) return { problems, sceneFiles: sceneFiles.length };

  // scenes that the edit names
  const named: { name: string; at: string }[] = project.video.clips.flatMap((c, i) => (c.scene ? [{ name: c.scene, at: `clips[${i}].scene` }] : []));
  if (project.video.overlay) named.push({ name: project.video.overlay, at: 'overlay' });
  (project.video.transitions ?? []).forEach((tr, i) => named.push({ name: tr.scene, at: `transitions[${i}].scene` }));
  for (const { name, at } of named) {
    const file = `${SCENES_DIR}/${name}.ts`;
    if (!sceneFiles.includes(`${name}.ts`)) {
      problems.push({ severity: 'error', rule: 'scene-missing', file: VIDEO_FILE, at, message: `no scene file ${file}`, fix: `pve scene new ${name}, or fix the name` });
    } else if (scans.get(name) && !scans.get(name)!.defaultClass) {
      problems.push({ severity: 'error', rule: 'scene-export', file, message: 'the file has no `export default class`', fix: `export the scene class as default: export default class X extends ${at === 'overlay' ? 'Overlay' : 'Scene'}` });
    }
  }

  // the edit: overlaps, gaps, cuts off the beat
  const index = new Map(project.video.clips.map((c, i) => [c.id, i]));
  for (const f of lintVideo(project.resolved).findings) {
    const i = f.clipId !== undefined ? index.get(f.clipId) : undefined;
    const t = f.t !== undefined ? ` (${fmtTime(f.t)}, bar ${fmtBarBeat(project.timing, f.t)})` : '';
    problems.push({
      severity: f.severity === 'error' ? 'error' : 'warning',
      rule: f.rule,
      file: VIDEO_FILE,
      at: i !== undefined ? `clips[${i}].at` : undefined,
      message: f.message + t,
      fix: LINT_FIX[f.rule],
    });
  }
  return { problems, project, sceneFiles: sceneFiles.length };
}

const LINT_FIX: Record<string, string> = {
  'clip-overlap': 'set the `to` of the earlier clip at or before the `at` of the next one. For a crossfade use `xfade`',
  'clip-gap': 'remove the `to` of the earlier clip, or set it to the `at` of the next one',
  'cut-off-beat': `snap the cut: add @beat~ (nearest beat) or @beat<= (beat at or before, ${OFF_BEAT_TOLERANCE_SEC * 1000} ms tolerance) to its expression. Ignore it for a cut that follows the voice on purpose`,
};
