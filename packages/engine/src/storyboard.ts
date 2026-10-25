// Storyboard card (DESIGN 6.4): what a clip without a scene renders. It shows the clip id, its brief, the
// bar and beat count with a pulse on each beat, and the lyric line sung now, with the sung part lit.
// Plain, cheap and a pure function of t.
import type * as THREE from 'three';
import { clearRT, H, Layer2D, W } from './gl';
import { Lyrics } from './lyrics';
import { LIN, rgba } from './palette';
import { Scene, type Frame } from './scene';
import { F, fitSize, font } from './type';

const PAD = 120;

/** Params of a card: the clip's brief. */
export interface StoryboardParams {
  brief?: string;
}

export class StoryboardCard extends Scene {
  private layer = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const c = this.layer.ctx;
    this.layer.clear();
    const { id, params, audio, lyrics } = this.ctx;
    const brief = typeof params.brief === 'string' ? params.brief : '';

    // clip id and window
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('signal');
    c.font = font(F.mono(500), 22);
    c.letterSpacing = '4px';
    c.fillText(`CLIP ${id.toUpperCase()}`, PAD, PAD + 20);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('ash');
    c.font = font(F.mono(400), 20);
    c.fillText(`${f.start.toFixed(2)}–${f.end.toFixed(2)} s   ${(f.p * 100).toFixed(0).padStart(3)} %`, PAD, PAD + 52);

    // brief, wrapped
    c.fillStyle = rgba('bone', brief ? 0.92 : 0.35);
    c.font = font(F.archivo(100, 500), 44);
    let y = PAD + 150;
    for (const line of wrap(c, brief || 'No brief.', W - 2 * PAD).slice(0, 5)) {
      c.fillText(line, PAD, y);
      y += 58;
    }

    // bar.beat counter and beat pulse. Bar 1 = the first downbeat; the beat counts from the downbeat of the
    // current bar. Before the first downbeat (a pickup) the bar is 0 and the beat counts from the first beat.
    const barIdx = Math.floor(f.bar), bar = Math.max(0, barIdx + 1);
    const beat0 = barIdx < 0 ? 0 : Math.round(audio.beatAt(audio.downbeats[barIdx]!));
    const beatInBar = Math.max(0, Math.floor(f.beat)) - beat0 + 1;
    const pulse = Math.pow(1 - f.beatPhase, 3);
    const downbeat = beatInBar === 1;
    c.fillStyle = rgba(downbeat ? 'signal' : 'bone', 0.25 + 0.75 * pulse);
    c.beginPath();
    c.arc(W - PAD - 40, PAD + 10, 18 + 14 * pulse, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = rgba('bone', 0.9);
    c.font = font(F.mono(500), 56);
    c.textAlign = 'right';
    c.fillText(`${bar}.${beatInBar}`, W - PAD - 90, PAD + 30);
    c.textAlign = 'left';

    // the lyric line sung now: sung part bone, the rest graphite; a long line shrinks to the frame width
    const l = lyrics.lineAt(f.t) ?? lyrics.lastLine(f.t);
    if (l) {
      const fam = F.archivo(100, 700);
      c.font = font(fam, fitSize(l.text, fam, W - 2 * PAD, 52));
      const n = Math.round(Lyrics.lineCharProgress(l, f.t));
      const sung = l.text.slice(0, n), rest = l.text.slice(n);
      const x = PAD, yl = H - PAD;
      c.fillStyle = rgba('bone');
      c.fillText(sung, x, yl);
      c.fillStyle = rgba('graphite');
      c.fillText(rest, x + c.measureText(sung).width, yl);
    }

    clearRT(this.ctx.renderer, out, LIN.ink);
    this.ctx.comp.draw(this.ctx.renderer, this.layer.upload(), out);
    return { bloom: 0, halation: 0, ca: 0, grain: 0.02, vignette: 0.2 };
  }

  override dispose() {
    this.layer.texture.dispose();
  }
}

/** Greedy word wrap at `width` px with the context's current font. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && c.measureText(next).width > width) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
