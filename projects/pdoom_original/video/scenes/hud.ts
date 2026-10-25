// The project overlay (video.json "overlay": "hud"): the corner P(doom) gauge. It is hidden by default:
// P(doom) is staged inside the plates. A scene shows it by returning post overrides
// { overlay: { gauge: 0..1, text?: 'NaN', corruption?: 0..1 } }.
import { H } from '@pve/engine/gl';
import { rgba } from '@pve/engine/palette';
import { Overlay, type OverlayState } from '@pve/engine/scene';
import { F, font } from '@pve/engine/type';
import { clamp, hash } from '@pve/engine/util';
import { PDoom } from './pdoom';

export default class Hud extends Overlay {
  pdoom!: PDoom;

  override async init() {
    this.pdoom = new PDoom(this.ctx.lyrics);
  }

  draw(c: CanvasRenderingContext2D, t: number, st: OverlayState) {
    const gauge = typeof st.params.gauge === 'number' ? st.params.gauge : 0;
    if (gauge <= 0.001) return;
    c.save();
    c.globalAlpha *= gauge;
    const v = this.pdoom.value(t);
    const fl = this.pdoom.flash(t);
    const x = 64, y = H - 66;
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 13);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('bone', 0.6);
    c.fillText('P(DOOM)', x, y - 44);
    c.letterSpacing = '0px';
    let s = typeof st.params.text === 'string' ? st.params.text : v.toFixed(v >= 0.99 ? 3 : 2);
    const corruption = typeof st.params.corruption === 'number' ? st.params.corruption : 0;
    if (corruption > 0) {
      const glyphs = '01#%?!Ø∞';
      s = Array.from(s).map((ch, i) => (hash(i, Math.floor(t * 20)) < corruption * 0.7 ? glyphs[Math.floor(hash(i, t) * glyphs.length)] : ch)).join('');
    }
    c.font = font(F.mono(400), 40);
    c.fillStyle = fl > 0.02 ? mix('bone', 'signal', Math.min(1, fl * 1.5)) : rgba('bone', 0.92);
    c.fillText(s, x - 2, y);
    // bar with ticks
    const bw = 220, by = y + 16;
    c.fillStyle = rgba('bone', 0.18);
    c.fillRect(x, by, bw, 1);
    for (let i = 0; i <= 10; i++) c.fillRect(x + (bw * i) / 10, by - (i % 5 === 0 ? 5 : 3), 1, i % 5 === 0 ? 5 : 3);
    c.fillStyle = rgba('signal', 1);
    c.fillRect(x, by - 1, bw * clamp(v), 3);
    c.restore();
  }
}

function mix(a: string, b: string, k: number) {
  const pa = rgba(a).match(/\d+/g)!.map(Number), pb = rgba(b).match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},1)`;
}
