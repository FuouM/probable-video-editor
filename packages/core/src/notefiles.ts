// video/notes/*.md: the review notes the studio notes panel writes. Reads the file system (node:fs). The dev server
// lists them for the panel and `pve notes` reads the pvemd blocks in them.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const NOTES_DIR = 'video/notes';

export interface NoteFile {
  /** The file name without `.md`. */
  id: string;
  /** The first line that is not empty, without a leading `#` heading mark. The id when that is empty. */
  title: string;
  content: string;
  /** Modification time (ms). */
  mtime: number;
}

/** The markdown notes of the project in `projectDir`, in the order of the folder listing. None when the folder is missing. */
export function readNoteFiles(projectDir: string): NoteFile[] {
  const dir = path.join(projectDir, NOTES_DIR);
  if (!existsSync(dir)) return [];
  const out: NoteFile[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    const file = path.join(dir, name);
    const content = readFileSync(file, 'utf8');
    const firstLine = content.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
    out.push({ id, title: firstLine.replace(/^#+\s*/, '') || id, content, mtime: statSync(file).mtimeMs });
  }
  return out;
}
