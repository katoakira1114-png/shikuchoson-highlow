import { NEAR_TIE_RATIO } from '../shared/constants';
import type { Dataset } from '../shared/types';
import type { Rng } from './rng';

/** 2つの数値が「差が小さすぎる」かどうか（0同士も含む） */
export function isNearTie(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return true;
  return Math.abs(a - b) < scale * NEAR_TIE_RATIO;
}

/**
 * 両者の自治体で出題できるお題を選ぶ。
 * データがない・差が小さすぎる・使用済みのお題は除き、直前と同じカテゴリはなるべく避ける。
 */
export function pickTopic(
  ds: Dataset,
  muniA: number,
  muniB: number,
  used: Set<number>,
  lastCategory: string | null,
  rng: Rng,
  allowReuse = false,
): number | null {
  const a = ds.munis[muniA].v;
  const b = ds.munis[muniB].v;
  const ok: number[] = [];
  for (let i = 0; i < ds.indicators.length; i++) {
    const va = a[i];
    const vb = b[i];
    if (va == null || vb == null) continue;
    if (isNearTie(va, vb)) continue;
    ok.push(i);
  }
  let pool = ok.filter((i) => !used.has(i));
  if (pool.length === 0 && allowReuse) pool = ok;
  if (pool.length === 0) return null;
  const fresh = pool.filter((i) => ds.indicators[i].category !== lastCategory);
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.floor(rng() * from.length)];
}

/** ドラフト候補: 人口（先頭の指標）の大・中・小から1つずつ */
export function drawDraft(ds: Dataset, exclude: Set<number>, rng: Rng): number[] {
  const popIdx = Math.max(0, ds.indicators.findIndex((x) => x.id === 'population'));
  const sorted = ds.munis
    .map((m, i) => ({ i, pop: m.v[popIdx] ?? 0 }))
    .sort((x, y) => y.pop - x.pop)
    .map((x) => x.i);
  const third = Math.ceil(sorted.length / 3);
  const out: number[] = [];
  for (let t = 0; t < 3; t++) {
    const band = sorted.slice(t * third, (t + 1) * third).filter((i) => !exclude.has(i) && !out.includes(i));
    if (band.length > 0) out.push(band[Math.floor(rng() * band.length)]);
  }
  return out;
}
