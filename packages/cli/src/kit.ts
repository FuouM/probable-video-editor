// pve kit: writes video/KIT.md, an index of the scene modules of a project. An agent reads this one file
// instead of searching the modules: the purpose of each module (its header comment), its exports with
// line numbers and the first sentence of their doc comments, and which files import it.
// The scan reads text only (top-level `export` lines and 2-space class members). It does not type-check.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SCENES_DIR, type ProjectRef } from './project';

export const KIT_FILE = 'video/KIT.md';

interface Export {
  line: number;
  kind: 'class' | 'function' | 'const' | 'type';
  name: string;
  /** Parameter names of a function: `(t, path)`. */
  params?: string;
  /** Public members of a class: `pose(t, path)`, `root`. */
  members?: string[];
  doc?: string;
}

interface Module {
  file: string;
  lines: number;
  header: string;
  exports: Export[];
  imports: string[];
  role: 'scene' | 'module' | 'board' | 'bench';
}

const DOC_MAX = 110;
const HEADER_MAX = 320;

/** The first sentence of a doc comment, on one line. */
function sentence(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/\.(\s|$)/);
  const s = end > 0 ? flat.slice(0, end + 1) : flat;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The doc comment that ends on the line before `k`, without its markers. */
function docBefore(lines: string[], k: number): string | undefined {
  let j = k - 1;
  if (j < 0 || !lines[j]!.trim().endsWith('*/')) return undefined;
  const body: string[] = [];
  for (; j >= 0; j--) {
    const t = lines[j]!.trim();
    body.unshift(t.replace(/^\/\*\*?/, '').replace(/\*\/$/, '').replace(/^\*\s?/, ''));
    if (t.startsWith('/**')) break;
  }
  const text = body.join(' ').trim();
  return text ? sentence(text, DOC_MAX) : undefined;
}

/** The names of the parameters in `(a: A, b = 2, { c }: C)`: `(a, b, {c})`. */
function paramNames(list: string): string {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const c of list) {
    if ('([{<'.includes(c)) depth++;
    if (')]}>'.includes(c)) depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return `(${parts.map((p) => {
    const t = p.trim();
    if (t.startsWith('{')) return '{…}';
    if (t.startsWith('[')) return '[…]';
    return t.match(/^(?:\.\.\.)?[A-Za-z_$][\w$]*/)?.[0] ?? t;
  }).join(', ')})`;
}

/** The text between the `(` at `from` and its matching `)`, across lines. */
function parenBody(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(from + 1, i);
  }
  return '';
}

const CLASS_RE = /^export (?:default )?(?:abstract )?class ([A-Za-z_$][\w$]*)/;
const FUNC_RE = /^export (?:default )?(?:async )?function\*? ?([A-Za-z_$][\w$]*)/;
const CONST_RE = /^export (?:const|let) ([A-Za-z_$][\w$]*)/;
const TYPE_RE = /^export (?:interface|type|enum) ([A-Za-z_$][\w$]*)/;
const MEMBER_RE = /^ {2}(?:(?:static|readonly|override|async|get|set|declare) )*([A-Za-z_$][\w$]*)\s*([(<:=?!;])/;
const SKIP_MEMBER = /^ {2}(?:private|protected|#|constructor\b)/;

function scanModule(file: string, src: string): Omit<Module, 'role'> {
  const lines = src.split('\n');
  const header: string[] = [];
  for (const l of lines) {
    if (!l.startsWith('//')) break;
    const t = l.replace(/^\/\/\s?/, '');
    if (!t.trim() && header.length) break;
    header.push(t.trim());
  }
  const offsets: number[] = [];
  let off = 0;
  for (const l of lines) { offsets.push(off); off += l.length + 1; }
  const exports: Export[] = [];
  let cls: Export | undefined;
  lines.forEach((l, k) => {
    if (cls && l.startsWith('}')) cls = undefined;
    if (cls && !SKIP_MEMBER.test(l)) {
      const m = l.match(MEMBER_RE);
      if (m && m[1] !== 'constructor') {
        const call = m[2] === '(' || m[2] === '<' ? paramNames(parenBody(src, offsets[k]! + l.indexOf('('))) : '';
        if (!cls.members!.some((s) => s.startsWith(`${m[1]}(`) || s === m[1])) cls.members!.push(m[1] + call);
      }
      return;
    }
    let m: RegExpMatchArray | null;
    const doc = docBefore(lines, k);
    if ((m = l.match(CLASS_RE))) {
      cls = { line: k + 1, kind: 'class', name: m[1]!, members: [], doc };
      exports.push(cls);
      if (l.trimEnd().endsWith('}')) cls = undefined;
    } else if ((m = l.match(FUNC_RE))) {
      exports.push({ line: k + 1, kind: 'function', name: m[1]!, params: paramNames(parenBody(src, offsets[k]! + l.indexOf('('))), doc });
    } else if ((m = l.match(CONST_RE))) {
      exports.push({ line: k + 1, kind: 'const', name: m[1]!, doc });
    } else if ((m = l.match(TYPE_RE))) {
      exports.push({ line: k + 1, kind: 'type', name: m[1]!, doc });
    }
  });
  const imports = [...src.matchAll(/from '\.\/([^']+)'/g)].map((m) => `${m[1]}.ts`);
  const text = header.join(' ');
  return { file, lines: lines.length, header: text.length > HEADER_MAX ? `${text.slice(0, HEADER_MAX - 1)}…` : text, exports, imports: [...new Set(imports)] };
}

function roleOf(file: string, src: string): Module['role'] {
  if (/^(kit-bench-|player-bench-)|Bench\.ts$/.test(file)) return 'bench';
  if (/board\.ts$/.test(file)) return 'board';
  if (!file.startsWith('_') && /\bexport\s+default\s+class\b/.test(src)) return 'scene';
  return 'module';
}

function formatExport(e: Export, file: string): string {
  const where = `${file}:${e.line}`;
  const doc = e.doc ? ` — ${e.doc}` : '';
  if (e.kind === 'class') {
    const members = e.members!.length ? `\n  - ${e.members!.join(', ')}` : '';
    return `- class \`${e.name}\` (${where})${doc}${members}`;
  }
  if (e.kind === 'function') return `- \`${e.name}${e.params}\` (${where})${doc}`;
  return `- ${e.kind} \`${e.name}\` (${where})${doc}`;
}

/** The text of video/KIT.md for the project. Deterministic: the same files give the same text. */
export function kitIndex(ref: ProjectRef): string {
  const dir = path.join(ref.dir, SCENES_DIR);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ts')).sort() : [];
  const mods = files.map((f) => {
    const src = readFileSync(path.join(dir, f), 'utf8').replaceAll('\r\n', '\n');
    return { ...scanModule(f, src), role: roleOf(f, src) };
  });
  const importers = new Map<string, string[]>();
  for (const m of mods) for (const d of m.imports) importers.set(d, [...(importers.get(d) ?? []), m.file.slice(0, -3)]);

  const out: string[] = [
    `# ${ref.id}: kit index`,
    '',
    `Generated by \`bun run pve kit -p ${ref.id}\` from \`${SCENES_DIR}/\`. Do not edit by hand: run the command again after a change. \`pve check\` warns when this file is out of date.`,
    '',
    'Use: find the module and the export here, then read only that range (`file:line`). Line numbers are those of the last run.',
    '',
    '## Scenes',
    '',
    '| Scene | Lines | Imports |',
    '|---|---|---|',
    ...mods.filter((m) => m.role === 'scene').map((m) => `| \`${m.file}\` | ${m.lines} | ${m.imports.map((i) => i.slice(0, -3)).join(', ') || '-'} |`),
    '',
  ];
  for (const m of mods.filter((x) => x.role === 'scene')) {
    if (m.header) out.push(`- \`${m.file}\`: ${m.header}`);
  }
  out.push('', '## Modules', '');
  for (const m of mods.filter((x) => x.role === 'module')) {
    const users = importers.get(m.file) ?? [];
    out.push(`### ${m.file} (${m.lines} lines)`, '');
    if (m.header) out.push(m.header, '');
    out.push(`Imported by: ${users.length ? users.join(', ') : '**nothing**'}.`, '');
    if (m.exports.length) out.push(...m.exports.map((e) => formatExport(e, m.file)), '');
  }
  const list = (role: Module['role']) => mods.filter((m) => m.role === role).map((m) => `\`${m.file}\``).join(', ') || 'none';
  out.push('## Boards', '', list('board'), '', '## Benchmarks', '', list('bench'), '');
  return out.join('\n');
}

/** True when video/KIT.md exists and differs from a fresh index. A project without the file is never stale. */
export function kitStale(ref: ProjectRef): boolean {
  const file = path.join(ref.dir, KIT_FILE);
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== kitIndex(ref);
}
