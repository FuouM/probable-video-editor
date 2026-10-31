// The machine voice, "Gott ist tot" (gott1, gott2): an era ends. The page is cut open, red takes the frame, and
// the call is cut out of the red in Fraktur: its letters show the live page of the NEXT era (params.next:
// 'entries' or 'epigone', rendered via ctx.renderClip). After the call that live page closes over the red in
// two hard 12 fps steps and is whole at the first syllable of the pickup line (line 18 at 51.33 s, line 51 at
// 147.76 s), so the sung text is legible at its onset; then the plate runs on under the cut.
// v4 motion (treatment, "Motion (v4)"): the call is cut word by word across the voice's span, and the debris of
// the dying era (gott1: metal sorts of the press; gott2: chips of the screen) blows out across the red in 12 fps
// steps.
import * as THREE from 'three';
import type { Frame, PostOverrides } from '@pve/engine/scene';
import { FSPass, H, Layer2D, makeRT, W } from '@pve/engine/gl';
import { hash } from '@pve/engine/util';
import { copyTimes, FRAKTUR, fnt, genAt, INK, PageScene, PAPER, POST, rebate, SANS, SERIF, statusLine, tone, VOICE, type EraDef, type SurfaceOpts } from './_page';
import { MODERN } from './_era_modern';
import { TEXTISH } from './_era_textish';
import { closeAt, fitCall, type CallSet } from './voice-call';
import { syllables } from '@pve/engine/lyrics';

/** The close of the page: two steps of 12 fps. */
const CLOSE_DUR = 2 / 12 + 1e-6;

/** The debris of each dying era: what the press and the screen leave behind. */
const SORTS = [...'神っぽいなもういいぜ逆に興奮してきたおっきいね夢'];
const CHIPS = ['♡ 1.2K', '↻ 384', '@kami_ppoi', '#神っぽい', 'save_08.jpg', '(=^・^=)ノ', '既読', 'w', '…'];

const M = 96; // page margin

const COMP_FRAG = /* glsl */ `
uniform sampler2D uVoice;
uniform sampler2D uNext;
uniform sampler2D uMask;
uniform sampler2D uDebris;
uniform sampler2D uSortMask;
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
// The next page shows through the letters of the call and the closing page; the debris lies over everything
// with 4-tap rotated-grid supersampling (RGSS) antialiasing so rotating chips have silky smooth edges.
vec4 sampleDebris(vec2 uv) {
  vec2 texel = vec2(1.0 / 3840.0, 1.0 / 2160.0);
  vec4 center = texture(uDebris, uv);
  vec4 s0 = texture(uDebris, uv + vec2(-0.75, -0.75) * texel);
  vec4 s1 = texture(uDebris, uv + vec2( 0.75, -0.75) * texel);
  vec4 s2 = texture(uDebris, uv + vec2(-0.75,  0.75) * texel);
  vec4 s3 = texture(uDebris, uv + vec2( 0.75,  0.75) * texel);
  return center * 0.4 + (s0 + s1 + s2 + s3) * 0.15;
}
void main() {
  vec2 uvFlip = vec2(vUv.x, 1.0 - vUv.y);
  float inCallOrClose = texture(uMask, uvFlip).a;
  float hasSort = texture(uSortMask, uvFlip).a;
  float showNext = inCallOrClose * (1.0 - hasSort);
  vec3 base = mix(texture(uVoice, vUv).rgb, texture(uNext, vUv).rgb, showNext);
  vec4 d = sampleDebris(uvFlip);
  vec3 dc = toLin(d.rgb);
  fragColor = vec4(mix(base, dc, d.a), 1.0);
}
`;
export default class Voice extends PageScene {
  private copies: number[] = [];
  private text = 'Gott ist tot';
  private nextId = 'entries';
  private era: EraDef = MODERN;
  private set: CallSet = { x: M, y: 0, size: 0 };
  /** When each word of the call is cut. */
  private words: { text: string; t: number }[] = [];
  private voiceRT = makeRT();
  private nextRT = makeRT();
  private maskLayer = new Layer2D();
  private maskKey = '';
  private debrisLayer = new Layer2D(W, H, 2);
  private debrisKey = '';
  private lastNextStep = -1;
  private wholeAt = 0;
  private compPass!: FSPass;

  override async init() {
    await super.init();
    const p = this.ctx.params;
    this.text = String(p.call ?? this.text);
    this.nextId = String(p.next ?? 'entries');
    this.era = this.nextId === 'epigone' ? TEXTISH : MODERN;
    this.warm([this.era], this.era === TEXTISH);
    await this.ctx.ensureClip(this.nextId);

    this.maskLayer.texture.flipY = false;
    this.debrisLayer.texture.flipY = false;
    this.debrisLayer.texture.premultiplyAlpha = false;
    this.debrisLayer.texture.colorSpace = THREE.NoColorSpace;
    this.maskLayer.texture.premultiplyAlpha = true;
    this.compPass = new FSPass(COMP_FRAG, {
      uVoice: { value: this.voiceRT.texture },
      uNext: { value: this.nextRT.texture },
      uMask: { value: this.maskLayer.texture },
      uDebris: { value: this.debrisLayer.texture },
      uSortMask: { value: this.layer.texture },
    });
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    this.maskLayer.upload();
    this.debrisLayer.upload();
    this.compPass.render(this.ctx.renderer, tiny);
    tiny.dispose();
    this.ctx.renderClip(this.nextId, this.ctx.start, this.nextRT);
    this.lastNextStep = Math.floor(this.ctx.start * 24);
    this.copies = copyTimes(this.ctx.lyrics);
    // full width, set low: the red holds the upper half, the call runs margin to margin above the rebates
    this.set = fitCall(this.layer.ctx, this.text, M, W - M, 900);
    // the page is whole when the pickup line starts: the first syllable at or after the end of the call
    const callEnd = VOICE.reduce((a, b) => (Math.abs(b.start - this.ctx.start) < Math.abs(a.start - this.ctx.start) ? b : a)).end;
    this.wholeAt = this.ctx.end;
    for (const l of this.ctx.lyrics.lines) {
      const s = syllables(l)[0];
      if (s && s.start >= callEnd && s.start < this.wholeAt) this.wholeAt = s.start;
    }
    // the voice of this clip: its span cut into the words of the call
    const v = VOICE.reduce((a, b) => (Math.abs(b.start - this.ctx.start) < Math.abs(a.start - this.ctx.start) ? b : a));
    const ws = this.text.split(' ');
    const span = Math.min(v.end, this.ctx.end - 0.4) - v.start;
    let acc = '';
    this.words = ws.map((w, i) => {
      acc = acc ? `${acc} ${w}` : w;
      return { text: acc, t: v.start + (span * i) / ws.length };
    });
  }
  private word(t: number): { text: string; t: number } | null {
    let r: { text: string; t: number } | null = null;
    for (const w of this.words) if (w.t <= t) r = w;
    return r;
  }

  /** Pieces of the dying era blown out from the middle of the frame, on paper, in 12 fps steps. */
  private debris(c: CanvasRenderingContext2D, t: number) {
    const d = Math.floor((t - this.ctx.start) * 12) / 12;
    if (d < 0) return;
    const screen = this.era === TEXTISH;
    const n = 26;
    c.save();
    for (let i = 0; i < n; i++) {
      const a = hash(i, 3, this.ctx.start) * Math.PI * 2;
      const v = 500 + 1100 * hash(i, 4, this.ctx.start);
      const x = W / 2 + Math.cos(a) * v * d, y = H * 0.4 + Math.sin(a) * v * d + 900 * d * d;
      if (x < -200 || x > W + 200 || y > H + 200) continue;
      c.save();
      c.translate(x, y);
      c.rotate((hash(i, 5) - 0.5) * 6 * d);
      if (screen) {
        const s = CHIPS[i % CHIPS.length]!;
        c.font = fnt(SANS, 34, 700);
        const w = c.measureText(s).width + 28;
        c.fillStyle = PAPER;
        c.beginPath();
        c.roundRect(-w / 2, -26, w, 52, 6);
        c.fill();
        c.strokeStyle = PAPER;
        c.lineWidth = 1.5;
        c.stroke();
        c.fillStyle = INK;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(s, 0, 0);
      } else {
        const z = 60 + 50 * hash(i, 6);
        c.fillStyle = tone(0.35);
        c.beginPath();
        c.roundRect(-z / 2, -z / 2, z, z, 3);
        c.fill();
        c.strokeStyle = tone(0.35);
        c.lineWidth = 1.5;
        c.stroke();
        c.scale(-1, 1);
        c.fillStyle = PAPER;
        c.font = fnt(SERIF, z * 0.8, 700);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(SORTS[i % SORTS.length]!, 0, 0);
      }
      c.restore();
    }
    c.restore();
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const gen = genAt(this.copies, this.ctx.lyrics, t);

    if (this.era === MODERN) {
      const close = closeAt(t, this.wholeAt, CLOSE_DUR);
      if (close < 1) {
        c.save();
        c.beginPath();
        c.rect(0, 0, W, Math.round(H * (1 - close)));
        c.clip();
        this.debris(c, t);
        c.restore();
      }
    }

    return this.era === TEXTISH
      ? { era: this.era, gen, p: [0.8, 1, 0.8, 46], jpeg: { quality: 74, passes: 1 } }
      : { era: this.era, gen, p: [0.9, 0.9, 0.8, 55] };
  }
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const close = closeAt(f.t, this.wholeAt, CLOSE_DUR);
    if (close >= 1) {
      this.ctx.renderClip(this.nextId, f.t, out, f.dt);
      return POST;
    }
    const step = Math.floor(f.t * 24);
    if (step !== this.lastNextStep) {
      this.lastNextStep = step;
      this.ctx.renderClip(this.nextId, f.t, this.nextRT, f.dt);
    }
    super.render(f, this.voiceRT);
    const text = this.word(f.t)?.text ?? '';
    const key = `${text}|${close}`;
    if (key !== this.maskKey) {
      this.maskKey = key;
      const mc = this.maskLayer.ctx;
      this.maskLayer.clear();
      mc.fillStyle = '#000';
      if (close > 0) mc.fillRect(0, Math.round(H * (1 - close)), W, H);
      if (text) {
        mc.font = fnt(FRAKTUR, this.set.size);
        mc.textAlign = this.set.align ?? 'left';
        mc.textBaseline = 'alphabetic';
        mc.fillText(text, this.set.x, this.set.y);
      }
      this.maskLayer.upload();
    }
    // the debris flies over the red only: the page that closes is clean (12 fps steps)
    if (this.era === TEXTISH) {
      const dk = `${Math.floor((f.t - this.ctx.start) * 12)}|${close}`;
      if (dk !== this.debrisKey) {
        this.debrisKey = dk;
        const dc = this.debrisLayer.ctx;
        this.debrisLayer.clear();
        if (close < 1) {
          dc.save();
          dc.beginPath();
          dc.rect(0, 0, W, Math.round(H * (1 - close)));
          dc.clip();
          this.debris(dc, f.t);
          dc.restore();
        }
        this.debrisLayer.upload();
      }
    } else if (this.debrisKey !== 'empty') {
      this.debrisKey = 'empty';
      this.debrisLayer.clear();
      this.debrisLayer.upload();
    }

    this.compPass.render(this.ctx.renderer, out);
    return POST;
  }

  override dispose() {
    super.dispose();
    this.voiceRT.dispose();
    this.nextRT.dispose();
    this.maskLayer.dispose();
    this.debrisLayer.dispose();
    this.compPass?.dispose();
  }
}
