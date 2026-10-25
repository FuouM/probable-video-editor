// pve scene new <name> (DESIGN 8.1 step 3): writes video/scenes/<name>.ts, a scene class that renders as it
// is. The agent replaces the drawing and keeps the structure.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, UsageError } from './out';
import { SCENES_DIR, type ProjectRef } from './project';

/** Scene names are file names: lower case letters, digits, `-` and `_`, starting with a letter. */
const NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** `left-turn` -> `LeftTurn`. */
function className(name: string): string {
  return name.split(/[-_]/).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
}

export function sceneTemplate(name: string): string {
  const cls = className(name);
  return `// ${name}: <what this scene shows, and on which lyric or beat each event happens>.
// A pure function of f.t: no Math.random, Date.now or performance.now (use hash and noise1 from util).
import type * as THREE from 'three';
import { FSPass, H, Layer2D, W } from '@pve/engine/gl';
import { LIN, rgba } from '@pve/engine/palette';
import { Scene, type Frame, type PostOverrides } from '@pve/engine/scene';
import { F, font } from '@pve/engine/type';
import { ease, prog } from '@pve/engine/util';

export default class ${cls} extends Scene {
  /** Full-frame shader: the background. FSPass gives vUv (0..1) and the GLSL_COMMON helpers. */
  private bg = new FSPass(
    /* glsl */ \`
    uniform vec3 uInk; uniform vec3 uSignal; uniform float uPulse;
    void main() {
      vec2 p = vUv - 0.5;
      float r = length(p * vec2(1.78, 1.0));
      float ring = smoothstep(0.012, 0.0, abs(r - 0.18 - 0.05 * uPulse));
      fragColor = vec4(uInk + uSignal * ring * (0.6 + 2.0 * uPulse), 1.0);
    }\`,
    { uInk: { value: LIN.ink }, uSignal: { value: LIN.signal }, uPulse: { value: 0 } },
  );
  /** 2D canvas layer (logical 1920x1080 px): text and flat shapes. */
  private layer = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, id } = this.ctx;

    // the shader background, with a pulse on each beat
    const pulse = Math.pow(1 - f.beatPhase, 4);
    this.bg.u.uPulse!.value = pulse;
    this.bg.render(renderer, out);

    // the 2D layer: the clip id fades in over the first half second of the clip
    const c = this.layer.ctx;
    this.layer.clear();
    c.fillStyle = rgba('bone', prog(f.lt, 0, 0.5, ease.outCubic));
    c.font = font(F.archivo(100, 800), 96);
    c.textAlign = 'center';
    c.fillText(id.toUpperCase(), W / 2, H / 2 + 34);
    comp.draw(renderer, this.layer.upload(), out);

    return { bloom: 0.6, zoom: 1 + 0.01 * pulse };
  }

  override dispose() {
    this.layer.texture.dispose();
  }
}
`;
}

/** Writes video/scenes/<name>.ts. Returns its path relative to the project. */
export function newScene(ref: ProjectRef, name: string): string {
  if (!NAME_RE.test(name)) throw new UsageError(`bad scene name '${name}': use lower case letters, digits, - and _, starting with a letter`);
  const file = `${SCENES_DIR}/${name}.ts`;
  const abs = path.join(ref.dir, file);
  if (existsSync(abs)) throw new CliError({ rule: 'scene-exists', file, message: 'the scene file exists', fix: 'pick another name, or edit the file' });
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, sceneTemplate(name));
  return file;
}
