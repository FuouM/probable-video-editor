// A project in a temp folder: the core fixture song (4.2 s, 120 bpm, beats 0.5..4, downbeats 0.5 and 2.5,
// sections Verse 1 and Chorus, lines "hello world" and "sing again", envelopes without bass and other,
// onsets with vocal only) plus the given video.json and scene files.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SONG = path.join(import.meta.dir, '../../core/test/fixtures/song');

export const VIDEO = {
  v: 2,
  title: 'fixture',
  fps: 60,
  size: [1920, 1080],
  markers: { chorus: { at: 'section:Chorus' } },
  clips: [
    { id: 'intro', at: 0, brief: 'Black.' },
    { id: 'verse', at: 'lyric:hello', scene: 'verse' },
    { id: 'chorus', at: '@chorus', brief: 'The chorus.' },
  ],
};

export const SCENE = `import type * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
export default class Verse extends Scene {
  render(f: Frame, out: THREE.WebGLRenderTarget) {}
}
`;

export function makeProject(video: unknown = VIDEO, scenes: Record<string, string> = { verse: SCENE }): { dir: string; cleanup(): void } {
  const root = mkdtempSync(path.join(tmpdir(), 'pve-cli-'));
  const dir = path.join(root, 'song');
  cpSync(SONG, dir, { recursive: true });
  mkdirSync(path.join(dir, 'video/scenes'), { recursive: true });
  writeFileSync(path.join(dir, 'video/video.json'), typeof video === 'string' ? video : JSON.stringify(video));
  for (const [name, src] of Object.entries(scenes)) writeFileSync(path.join(dir, `video/scenes/${name}.ts`), src);
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
