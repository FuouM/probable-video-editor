// Almost-kana for the last stamps (plate 9): a hook kana clipped to its left part and joined to the right part of
// a kana that looks like it, from the song's own kana (all in the subset fonts). Texture of the copies only: a
// stamp is always the real kana at its onset.
import { hash } from '@pve/engine/util';
import { SANS, SERIF } from './_page';
import type { Chimera } from './epigone-ish';

/** For each kana of the hook, song kana whose right part joins its left part into no real kana. */
const NEAR: Record<string, string> = {
  'と': 'てこ', 'ぅ': 'らつ', 'る': 'られ', 'ぽ': 'まも', 'い': 'てく', 'じ': 'ぐく', 'ゃ': 'ャせ',
  'ん': 'われ', 'っ': 'ら', 'な': 'ねぬ',
};

/** The almost-kana of `ch` in face `fam`, number `seed`: deterministic. A kana with no near one joins its other face. */
export function almost(ch: string, fam: string, seed: number): Chimera {
  const near = [...(NEAR[ch] ?? ch)];
  const b = near[Math.floor(hash(seed, 1) * near.length)]!;
  return {
    a: ch, b, mode: 'lr', cut: 0.44 + hash(seed, 2) * 0.14,
    famA: fam, famB: b === ch ? (fam === SERIF ? SANS : SERIF) : fam,
  };
}
