import type { BotLevel, Choice, Dataset } from '../shared/types';
import { between, type Rng } from './rng';

/** bot が見てよい情報だけをまとめたもの（相手の自治体名は含まない） */
export interface BotKnowledge {
  ds: Dataset;
  level: BotLevel;
  own: number;
  oppPref: string;
  /** 公開済みの相手の数値（お題の番号と値） */
  revealed: { topic: number; value: number }[];
  /** 名指しで当てた場合だけ、相手の自治体 */
  knownOpp: number | null;
  wrongGuesses: number[];
}

/** 強さごとの「どれくらい数値を覚えているか」の幅。小さいほど正確に絞り込む */
const SIGMA: Record<BotLevel, number> = { weak: 1.5, normal: 0.6, strong: 0.3 };
const MISTAKE: Record<BotLevel, number> = { weak: 0.25, normal: 0.1, strong: 0.03 };

export const BOT_ANSWER_MS: Record<BotLevel, [number, number]> = {
  weak: [3_000, 9_000],
  normal: [2_000, 7_000],
  strong: [1_500, 5_000],
};
export const BOT_REACTION_MS: Record<BotLevel, [number, number]> = {
  weak: [1_500, 3_000],
  normal: [1_000, 2_000],
  strong: [600, 1_200],
};

function relDiff(a: number, b: number): number {
  const s = Math.max(Math.abs(a), Math.abs(b));
  return s === 0 ? 0 : Math.abs(a - b) / s;
}

/** 相手の候補自治体それぞれの「ありそうさ」 */
export function candidateWeights(k: BotKnowledge): { idx: number; w: number }[] {
  const sigma = SIGMA[k.level];
  const out: { idx: number; w: number }[] = [];
  k.ds.munis.forEach((m, idx) => {
    if (m.p !== k.oppPref || idx === k.own || k.wrongGuesses.includes(idx)) return;
    let logw = 0;
    for (const r of k.revealed) {
      const v = m.v[r.topic];
      if (v == null) continue;
      const d = relDiff(v, r.value) / sigma;
      logw -= d * d;
    }
    out.push({ idx, w: Math.exp(logw) });
  });
  const total = out.reduce((s, x) => s + x.w, 0) || 1;
  for (const x of out) x.w /= total;
  return out;
}

export function decideChoice(k: BotKnowledge, topic: number, rng: Rng): Choice {
  const ownV = k.ds.munis[k.own].v[topic] ?? 0;
  let pHigh: number;
  if (k.knownOpp != null) {
    pHigh = ownV > (k.ds.munis[k.knownOpp].v[topic] ?? 0) ? 1 : 0;
  } else if (k.level === 'weak') {
    // 県の平均をざっくり覚えている程度
    const vals = k.ds.munis.filter((m) => m.p === k.oppPref).map((m) => m.v[topic]).filter((v): v is number => v != null);
    const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
    const guess = mean * Math.exp(between(rng, -1.2, 1.2));
    pHigh = ownV > guess ? 1 : 0;
  } else {
    pHigh = 0;
    for (const c of candidateWeights(k)) {
      const v = k.ds.munis[c.idx].v[topic];
      if (v != null && ownV > v) pHigh += c.w;
    }
  }
  let choice: Choice = pHigh >= 0.5 ? 'high' : 'low';
  if (rng() < MISTAKE[k.level]) choice = choice === 'high' ? 'low' : 'high';
  return choice;
}

/** 名指しするならその自治体、しないなら null */
export function decideNomination(k: BotKnowledge, round: number, nominationsUsed: number, rng: Rng): number | null {
  if (k.knownOpp != null || k.level === 'weak') return null;
  const cands = candidateWeights(k).sort((a, b) => b.w - a.w);
  if (cands.length === 0) return null;
  const top = cands[0];
  if (k.level === 'normal') {
    if (nominationsUsed >= 1 || round < 4 || top.w < 0.8) return null;
  } else {
    if (round < 2 || top.w < 0.5) return null;
  }
  return rng() < 0.85 ? top.idx : null;
}
