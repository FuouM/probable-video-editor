// The parrot's keyboard: a Japanese input method. Each glyph of the sermon is typed as its reading (kana,
// from the calibrated romaji of its syllables), and a candidate window lists the glyphs of that same reading,
// ranked by the song's own bigram (parrot-ngram.ts). The homophones are a small hand table of real readings;
// a candidate the song never wrote has p = 0 and falls to the bottom in table order.
import { hiraToKata, kataToHira, romajiToKana, syllables, type Line, type WrittenUnit } from '@pve/engine/lyrics';
import { clean, type Bigram } from './parrot-ngram';

/** The reading of a unit: its kana as written, or the kana of its sung syllables (ghosts left out). */
export function reading(line: Line, u: WrittenUnit): string {
  const g = clean(u.glyph);
  if (/^[\u3040-\u30ff]+$/.test(g)) return kataToHira(g);
  const ghosts = new Set(line.written?.ghosts ?? []);
  const syl = syllables(line);
  let r = '';
  for (let k = u.from; k < u.to; k++) if (!ghosts.has(k)) r += syl[k]!.text;
  return romajiToKana(r);
}

/** Real homophones by reading, in the order a dictionary would list them before any learning. */
const HOMOPHONES: Record<string, string> = {
  め: '目 芽 女 眼 雌', た: '田 他 多 汰', し: '死 市 詩 四 思 氏 師 史 詞', こう: '高 行 考 公 光 口 好 後 工',
  す: '巣 酢 素 州', る: '流 留 屡', ほん: '本 品 翻 奔', しつ: '質 室 失 執 湿 疾', は: '葉 歯 刃 派 羽 波',
  あく: '悪 握 渥 飽く 開く', い: '意 胃 位 医 井 居 異 以 委 為 生', ひと: '人 一 仁', を: '乎',
  こ: '子 小 古 個 粉 戸 湖 己 庫', ば: '場 馬 婆 罵', か: '化 下 火 花 家 歌 可 価 鹿 代', に: '二 荷 似 煮 尼 仁',
  よ: '世 代 夜 予 余 四', う: '有 宇 羽 雨 鵜', な: '名 菜 奈 那 成', さく: '作 策 柵 索 搾 削',
  む: '無 夢 霧 武 務', き: '木 気 機 期 器 記 生 黄', の: '野 乃 能 之 延', び: '美 微 備 鼻 尾',
  むずか: '難', けん: '県 件 剣 権 見 研 券 犬 険', りょく: '力 緑', ま: '間 真 馬 魔 麻', れ: '例 礼 令',
  て: '手 出', ゆ: '湯 由 油 揺 結', ら: '等 裸 羅 良', ぐ: '具 愚 虞', あか: '赤 灯 明 垢 紅 朱',
  り: '理 里 利 離 梨', かみ: '神 紙 髪 上 加味', ひ: '日 火 非 否 比 皮 飛 費 批', てい: '定 低 提 体 帝 程 丁 底 庭',
  わ: '輪 和 話 環 羽', ぎょく: '玉', ざ: '座 坐', で: '出', ひょう: '表 票 評 氷 標 豹 漂 俵',
  へん: '変 辺 編 片 偏 返 遍', もの: '物 者', たち: '達 太刀 質 館', はん: '判 半 反 犯 版 班 般 販 範',
  み: '見 実 身 味 未 三', せ: '世 背 瀬', け: '毛 化 気', じ: '字 自 時 地 次 事 寺 児 耳',
  かい: '戒 会 回 界 海 解 階 開 改 貝', いの: '祈 猪',
};

/**
 * A candidate, its p after the previous glyph, its true rank among all candidates of the reading, and its
 * place in the table order (the order before any learning).
 */
export interface ImeCand { s: string; p: number; rank: number; i: number }

/** Most candidates a window shows; the sung glyph is always among them. */
export const WINDOW = 9;

/**
 * The window for `reading` after the glyph `prev`: the table's homophones, the reading in hiragana and
 * katakana, and the sung glyph, ranked by p of the whole candidate under the bigram (ties keep table order).
 */
export function candidates(model: Bigram, prev: string, read: string, sung: string): { cands: ImeCand[]; row: number } {
  const pool = [...new Set([...(HOMOPHONES[read]?.split(' ') ?? []), read, hiraToKata(read), sung])];
  const ranked = pool.map((s, i) => ({ s, p: model.seq(prev, s), i })).sort((a, b) => b.p - a.p || a.i - b.i)
    .map(({ s, p, i }, k) => ({ s, p, rank: k + 1, i }));
  const at = ranked.findIndex((c) => c.s === sung);
  const cands = ranked.slice(0, WINDOW);
  if (at >= WINDOW) cands[WINDOW - 1] = ranked[at]!;
  return { cands, row: Math.min(at, WINDOW - 1) };
}
