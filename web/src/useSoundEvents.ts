import { useEffect, useRef } from 'react';
import type { PlayerView } from '../../shared/types';
import { bgm, se } from './sound';

/** サーバーから届く状態の変化に合わせて効果音とBGMを鳴らす */
export function useSoundEvents(v: PlayerView | null, now: number) {
  const prev = useRef<PlayerView | null>(null);
  const lastTick = useRef<number | null>(null);

  useEffect(() => {
    const p = prev.current;
    prev.current = v;
    if (!v) return;
    if (v.phase.startsWith('sudden')) bgm('sudden');
    else if (v.phase === 'finished') bgm(null);
    else bgm('battle');
    if (p?.phase === v.phase && p.round === v.round && p.sudden?.showAt === v.sudden?.showAt) return;

    switch (v.phase) {
      case 'answer':
        if (p?.phase !== 'cutin' && p?.phase !== 'nominate') se('start');
        break;
      case 'result': {
        const h = v.history[v.history.length - 1];
        se('reveal');
        setTimeout(() => se(h.myCorrect == null ? 'tie' : h.myCorrect ? 'correct' : 'wrong'), 650);
        break;
      }
      case 'cutin': {
        const n = v.nomination;
        se('cutin');
        if (n) {
          const good = n.by === 'me' ? n.correct : !n.correct;
          setTimeout(() => se(good ? 'hit' : 'miss'), 900);
        }
        break;
      }
      case 'sudden_result': {
        const r = v.sudden?.result;
        if (r) {
          const iWin = (r.adopted === 'me') === r.correct;
          se(iWin ? 'correct' : 'wrong');
        }
        break;
      }
      case 'finished':
        se(v.finish?.winner === 'me' ? 'win' : 'lose');
        break;
    }
  }, [v]);

  // 残り5秒からのカウント音と、早押しのカウントダウン
  useEffect(() => {
    if (!v) return;
    let sec: number | null = null;
    if (v.phase === 'answer' && v.deadline != null) {
      const left = Math.ceil((v.deadline - now) / 1000);
      if (left <= 5 && left > 0) sec = left;
    } else if (v.phase === 'sudden_countdown' && v.sudden) {
      const left = Math.ceil((v.sudden.showAt - now) / 1000);
      sec = left > 0 ? left : 0;
    } else if (v.phase === 'sudden_answer' && v.sudden && now - v.sudden.showAt < 500) {
      sec = 0;
    }
    if (sec != null && sec !== lastTick.current) se(sec === 0 ? 'go' : 'tick');
    lastTick.current = sec;
  });

  useEffect(() => () => bgm(null), []);
}
