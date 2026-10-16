import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as C from '../shared/constants';
import type { Dataset } from '../shared/types';
import { Match } from '../server/engine';
import { seeded } from '../server/rng';

// A市はすべてのお題で B町より大きい。C村とは一部同値。
function tinyDs(): Dataset {
  const indicators = Array.from({ length: 20 }, (_, i) => ({
    id: i === 0 ? 'population' : `ind${i}`, name: `お題${i}`, unit: '', year: '2020',
    category: (['人口', '土地', '財政', '産業', '生活'] as const)[i % 5], source: 'test',
  }));
  const big = indicators.map((_, i) => 1000 + i);
  const small = indicators.map((_, i) => 10 + i);
  return {
    version: 't', indicators,
    munis: [
      { c: '000010', n: 'A市', p: 'X県', k: '市', v: big },
      { c: '000020', n: 'B町', p: 'Y県', k: '町', v: small },
      { c: '000030', n: 'C村', p: 'Y県', k: '村', v: small.map((x, i) => (i < 10 ? x : x + 500)) },
      { c: '000040', n: 'D村', p: 'Y県', k: '村', v: small.map((x) => x * 2) },
    ],
  };
}

function freeMatch(ds = tinyDs(), now = 0) {
  const m = new Match(ds, 'free', [{ name: 'P0', muniCode: '000010' }, { name: 'P1', muniCode: '000020' }], seeded(1));
  m.start(now);
  m.tick(now + C.INTRO_MS); // 1ラウンド目へ
  return m;
}

describe('通常ラウンド', () => {
  it('正解でコンボが伸び、上限は+3。不正解は-1で0点未満にならない', () => {
    const m = freeMatch();
    let t = C.INTRO_MS;
    const deltas: number[] = [];
    for (let r = 0; r < 4; r++) {
      m.handle(0, { type: 'answer', choice: 'high' }, t);
      m.handle(1, { type: 'answer', choice: 'high' }, t); // P1 は常に不正解
      deltas.push(m.history.at(-1)!.deltas[0]);
      expect(m.history.at(-1)!.deltas[1]).toBe(0);
      t += C.RESULT_MS;
      m.tick(t);
    }
    expect(deltas).toEqual([1, 2, 3, 3]);
    expect(m.players[0].score).toBe(9);
    expect(m.players[1].score).toBe(0);
  });

  it('時間切れは不正解', () => {
    const m = freeMatch();
    m.handle(0, { type: 'answer', choice: 'high' }, C.INTRO_MS + 1000);
    m.tick(C.INTRO_MS + C.ANSWER_MS);
    expect(m.phase).toBe('result');
    expect(m.history[0].correct).toEqual([true, false]);
  });

  it('10点で勝利。両者10点以上なら高い方', () => {
    const m = freeMatch();
    m.players[0].score = 9;
    m.players[1].score = 9;
    m.players[1].streak = 1;
    const t = C.INTRO_MS;
    m.handle(0, { type: 'answer', choice: 'high' }, t);
    m.handle(1, { type: 'answer', choice: 'low' }, t);
    m.tick(t + C.RESULT_MS);
    expect(m.phase).toBe('finished');
    expect(m.finish?.winner).toBe(1); // 9+2=11 > 9+1=10
  });

  it('同点で10点に届いたら早押し', () => {
    const m = freeMatch();
    m.players[0].score = 9;
    m.players[1].score = 9;
    const t = C.INTRO_MS;
    m.handle(0, { type: 'answer', choice: 'high' }, t);
    m.handle(1, { type: 'answer', choice: 'low' }, t);
    m.tick(t + C.RESULT_MS);
    expect(m.phase).toBe('sudden_countdown');
  });

  it('同じお題は二度出ない', () => {
    const m = freeMatch();
    let t = C.INTRO_MS;
    const seen = new Set<number>();
    for (let r = 0; r < C.MAX_ROUNDS && m.phase === 'answer'; r++) {
      expect(seen.has(m.topic!)).toBe(false);
      seen.add(m.topic!);
      m.handle(0, { type: 'answer', choice: 'low' }, t);
      m.handle(1, { type: 'answer', choice: 'high' }, t);
      t += C.RESULT_MS;
      m.tick(t);
    }
    expect(seen.size).toBe(C.MAX_ROUNDS);
  });
});

describe('名指しカットイン', () => {
  it('両者の時間が止まり、10秒の選択時間。当たりは+3', () => {
    const m = freeMatch();
    const t = C.INTRO_MS + 5000; // 残り10秒
    expect(m.handle(0, { type: 'nominate_start' }, t)).toBeNull();
    expect(m.phase).toBe('nominate');
    expect(m.deadline).toBe(t + C.NOMINATE_MS);
    expect(m.handle(1, { type: 'answer', choice: 'low' }, t + 100)).not.toBeNull(); // 相手は操作できない
    m.handle(0, { type: 'nominate', code: '000020' }, t + 8000);
    expect(m.players[0].score).toBe(3);
    expect(m.players[0].guessedOpp).toBe(true);
    expect(m.phase).toBe('cutin');
    m.tick(t + 8000 + C.CUTIN_MS);
    expect(m.phase).toBe('answer');
    expect(m.deadline).toBe(t + 8000 + C.CUTIN_MS + 10_000); // 残り10秒から再開
    expect(m.viewFor(0, t).opp.muni?.name).toBe('B町');
    expect(m.viewFor(1, t).opp.muni).toBeNull();
    expect(m.handle(0, { type: 'nominate_start' }, t + 12_000)).not.toBeNull(); // 当てた後はもう名指しできない
  });

  it('外れは-1（0点未満にならない）、時間切れはキャンセルで回数だけ減る', () => {
    const m = freeMatch();
    const t = C.INTRO_MS + 1000;
    m.players[0].score = 2;
    m.handle(0, { type: 'nominate_start' }, t);
    m.handle(0, { type: 'nominate', code: '000030' }, t + 1000);
    expect(m.players[0].score).toBe(1);
    m.tick(t + 1000 + C.CUTIN_MS);
    m.handle(0, { type: 'nominate_start' }, t + 5000);
    m.tick(t + 5000 + C.NOMINATE_MS);
    expect(m.phase).toBe('answer');
    expect(m.players[0].nominationsLeft).toBe(1);
    expect(m.players[0].score).toBe(1);
    expect(m.handle(0, { type: 'nominate', code: '000020' }, t + 16_000)).not.toBeNull();
  });

  it('相手の都道府県以外は名指しできない', () => {
    const m = freeMatch();
    m.handle(0, { type: 'nominate_start' }, C.INTRO_MS);
    expect(m.handle(0, { type: 'nominate', code: '000010' }, C.INTRO_MS + 10)).not.toBeNull();
  });
});

describe('早押し', () => {
  function suddenMatch() {
    const m = freeMatch();
    m.players[0].score = 9;
    m.players[1].score = 9;
    m.handle(0, { type: 'answer', choice: 'high' }, C.INTRO_MS);
    m.handle(1, { type: 'answer', choice: 'low' }, C.INTRO_MS);
    const t = C.INTRO_MS + C.RESULT_MS;
    m.tick(t);
    const showAt = m.sudden!.showAt;
    m.tick(showAt);
    expect(m.phase).toBe('sudden_answer');
    return { m, showAt };
  }

  it('後から届いても、スマホで測った秒数が短い方を採用', () => {
    const { m, showAt } = suddenMatch();
    m.handle(0, { type: 'press', choice: 'high', reactionMs: 900 }, showAt + 1000);
    m.handle(1, { type: 'press', choice: 'low', reactionMs: 700 }, showAt + 1400);
    expect(m.phase).toBe('sudden_result');
    expect(m.sudden!.result).toEqual({ adopted: 1, correct: true });
    m.tick(showAt + 1400 + C.SUDDEN_RESULT_MS);
    expect(m.finish).toEqual({ winner: 1, reason: 'sudden' });
    const v = m.viewFor(0, showAt);
    expect(v.finish?.oppMuni.name).toBe('B町');
  });

  it('不正解なら相手の勝ち', () => {
    const { m, showAt } = suddenMatch();
    m.handle(0, { type: 'press', choice: 'low', reactionMs: 500 }, showAt + 600);
    m.tick(showAt + 600 + C.SUDDEN_GRACE_MS);
    m.tick(showAt + 600 + C.SUDDEN_GRACE_MS + C.SUDDEN_RESULT_MS);
    expect(m.finish?.winner).toBe(1);
  });

  it('届いた時刻と矛盾する秒数や0.1秒未満は無効', () => {
    const { m, showAt } = suddenMatch();
    m.handle(0, { type: 'press', choice: 'high', reactionMs: 50 }, showAt + 300);
    m.handle(1, { type: 'press', choice: 'low', reactionMs: 400 }, showAt + 2000);
    expect(m.sudden!.result?.adopted).toBe(1);
    const { m: m2, showAt: s2 } = suddenMatch();
    m2.handle(0, { type: 'press', choice: 'high', reactionMs: 5000 }, s2 + 1000); // 1秒後に届いたのに5秒と申告
    m2.handle(1, { type: 'press', choice: 'low', reactionMs: 900 }, s2 + 1100);
    expect(m2.sudden!.result?.adopted).toBe(1);
  });

  it('両者押さなければ次のお題で仕切り直し', () => {
    const { m, showAt } = suddenMatch();
    const first = m.sudden!.topic;
    m.tick(showAt + C.SUDDEN_ANSWER_MS);
    expect(m.phase).toBe('sudden_countdown');
    expect(m.sudden!.topic).not.toBe(first);
  });
});

describe('情報の秘匿', () => {
  it('試合中のビューに相手の自治体名・コードが含まれない', () => {
    const m = freeMatch();
    let t = C.INTRO_MS;
    for (let r = 0; r < 3; r++) {
      m.handle(0, { type: 'answer', choice: 'high' }, t);
      m.handle(1, { type: 'answer', choice: 'high' }, t);
      const json = JSON.stringify(m.viewFor(0, t));
      expect(json).not.toContain('B町');
      expect(json).not.toContain('000020');
      t += C.RESULT_MS;
      m.tick(t);
    }
  });
});

describe('ドラフトと選び直し', () => {
  it('ドラフトは3候補、時間切れなら候補から自動で決まる', () => {
    const ds = JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')) as Dataset;
    const m = new Match(ds, 'draft', [{ name: 'a' }, { name: 'b' }], seeded(3));
    m.start(0);
    const v = m.viewFor(0, 0);
    expect(v.select?.options).toHaveLength(3);
    m.tick(C.SELECT_MS);
    expect(m.phase).toBe('intro');
    expect(m.players[0].selectOptions).toContain(m.players[0].muni);
    expect(m.players[0].muni).not.toBe(m.players[1].muni);
  });

  it('フリーで同じ自治体なら両者選び直し', () => {
    const m = new Match(tinyDs(), 'free', [{ name: 'a', muniCode: '000010' }, { name: 'b', muniCode: '000010' }], seeded(1));
    m.start(0);
    expect(m.phase).toBe('select');
    expect(m.notice).toContain('同じ自治体');
  });
});

describe('bot 戦', () => {
  const ds = JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')) as Dataset;

  function botVsBot(a: 'weak' | 'normal' | 'strong', b: 'weak' | 'normal' | 'strong', seed: number) {
    const m = new Match(ds, 'draft', [{ name: 'a', isBot: true, botLevel: a }, { name: 'b', isBot: true, botLevel: b }], seeded(seed));
    m.start(0);
    let t = 0;
    for (let i = 0; i < 2000 && m.phase !== 'finished'; i++) {
      t = m.nextWake() ?? t + 1000;
      m.tick(t);
    }
    return m;
  }

  it('bot 同士で最後まで試合が進む', () => {
    for (let s = 1; s <= 30; s++) {
      const m = botVsBot('normal', 'strong', s);
      expect(m.phase).toBe('finished');
    }
  });

  it('強い bot は弱い bot に勝ち越す', () => {
    let wins = 0;
    const N = 60;
    for (let s = 1; s <= N; s++) if (botVsBot('strong', 'weak', s).finish!.winner === 0) wins++;
    expect(wins / N).toBeGreaterThan(0.6);
  });

  it('人間 vs bot: bot は答え、名指しでも時間がずれない', () => {
    const m = new Match(ds, 'free', [{ name: 'me', muniCode: ds.munis[0].c }, { name: 'bot', isBot: true, botLevel: 'strong' }], seeded(9));
    m.start(0);
    expect(m.phase).toBe('intro');
    m.tick(C.INTRO_MS);
    m.handle(0, { type: 'nominate_start' }, C.INTRO_MS + 500);
    m.tick(C.INTRO_MS + 500 + C.NOMINATE_MS);
    expect(m.phase).toBe('answer');
    m.handle(0, { type: 'answer', choice: 'high' }, C.INTRO_MS + 500 + C.NOMINATE_MS + 10);
    m.tick(C.INTRO_MS + 500 + C.NOMINATE_MS + C.ANSWER_MS);
    expect(m.history[0].choices[1]).not.toBeNull();
  });
});
