// The parrot's ear: a character bigram over the written Japanese of the song's 74 lyric lines, interpolated
// with the unigram by Witten-Bell (a context seen n times with T distinct followers keeps n / (n + T) of its
// own counts and gives the rest to the unigram). Every probability on the plate comes from here.

/** Punctuation and quotes are not glyphs of the language: they are left out of the counts. */
const PUNCT = /[「」『』"'？！?!、。…・\s]/g;
export const clean = (s: string) => s.replace(PUNCT, '');
/** The context of the first glyph of a line. */
export const START = '^';

export interface Cand { ch: string; p: number }

export class Bigram {
  private uni = new Map<string, number>();
  private bi = new Map<string, Map<string, number>>();
  private n = 0;

  constructor(lines: string[]) {
    for (const l of lines) {
      let prev = START;
      for (const ch of clean(l)) {
        this.uni.set(ch, (this.uni.get(ch) ?? 0) + 1);
        let m = this.bi.get(prev);
        if (!m) this.bi.set(prev, (m = new Map()));
        m.set(ch, (m.get(ch) ?? 0) + 1);
        this.n++;
        prev = ch;
      }
    }
  }

  /** The distribution of the glyph after `prev` over the whole vocabulary, most probable first (sums to 1). */
  next(prev: string): Cand[] {
    const m = this.bi.get(prev);
    let tot = 0;
    if (m) for (const v of m.values()) tot += v;
    const lam = m ? tot / (tot + m.size) : 0;
    const out: Cand[] = [];
    for (const [ch, u] of this.uni) {
      const pu = u / this.n;
      const pb = m ? (m.get(ch) ?? 0) / tot : 0;
      out.push({ ch, p: lam * pb + (1 - lam) * pu });
    }
    return out.sort((a, b) => b.p - a.p || (a.ch < b.ch ? -1 : 1));
  }

  /** p of the glyph string `s` after `prev`: the chain of its glyphs (0 when a glyph is unseen). */
  seq(prev: string, s: string): number {
    let p = 1;
    for (const ch of clean(s)) {
      p *= this.next(prev).find((c) => c.ch === ch)?.p ?? 0;
      prev = ch;
    }
    return p;
  }
}
