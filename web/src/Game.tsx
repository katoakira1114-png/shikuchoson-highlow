import { useEffect, useRef, useState } from 'react';
import type { Choice, HistoryEntry, PlayerView, ServerMessage, TopicView } from '../../shared/types';
import { MuniPicker } from './MuniPicker';
import { fmt, RoomConnection } from './net';

export function Game(props: { roomId: string; token: string; inviteUrl?: string; onExit: () => void }) {
  const [view, setView] = useState<PlayerView | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [, setFrame] = useState(0);
  const conn = useRef<RoomConnection | null>(null);

  useEffect(() => {
    const c = new RoomConnection(
      props.roomId,
      props.token,
      (m: ServerMessage) => {
        if (m.type === 'state') {
          setView(m.view);
          setWaiting(null);
        } else if (m.type === 'waiting') setWaiting(m.text);
        else if (m.type === 'error') {
          setToast(m.text);
          setTimeout(() => setToast(null), 2500);
        }
      },
      setOnline,
    );
    conn.current = c;
    const t = window.setInterval(() => setFrame((f) => f + 1), 100);
    return () => {
      window.clearInterval(t);
      c.close();
    };
  }, [props.roomId, props.token]);

  const send = (m: Parameters<RoomConnection['send']>[0]) => conn.current?.send(m);
  const now = conn.current?.serverNow() ?? Date.now();

  if (!view) {
    return (
      <div className="page stack center">
        {props.inviteUrl ? <Invite url={props.inviteUrl} /> : <div className="spinner" />}
        <p>{waiting ?? '接続しています…'}</p>
        <button className="link" onClick={props.onExit}>トップへ</button>
      </div>
    );
  }

  const remaining = view.deadline != null ? Math.max(0, view.deadline - now) : null;

  return (
    <div className="game">
      {!online && <div className="banner warn">通信が切れました。再接続しています…</div>}
      {toast && <div className="toast">{toast}</div>}
      <Scoreboard v={view} />
      {view.notice && <p className="notice">{view.notice}</p>}
      <main className="arena">
        <Phase v={view} now={now} remaining={remaining} send={send} onExit={props.onExit} />
      </main>
      {view.history.length > 0 && view.phase !== 'finished' && <HintHistory history={view.history} />}
    </div>
  );
}

function Invite({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: '市区町村 High & Low', text: '対戦しよう！', url });
        return;
      } catch {
        /* キャンセル */
      }
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
  };
  return (
    <div className="card invite">
      <p>このURLを友達に送ってください（30分有効）</p>
      <code>{url}</code>
      <button className="btn primary" onClick={share}>{copied ? 'コピーしました' : 'URLを送る'}</button>
    </div>
  );
}

function Scoreboard({ v }: { v: PlayerView }) {
  return (
    <header className="scoreboard">
      <div className="side me">
        <div className="pname">{v.me.name}</div>
        <div className="score">{v.me.score}</div>
        <div className="sub">{v.me.muni ? v.me.muni.name : '？'}{v.me.streak >= 2 && <span className="combo">{v.me.streak}連続</span>}</div>
        {v.opp.guessedMe && <div className="badge bad">バレた！</div>}
      </div>
      <div className="mid">
        <div className="round">{v.round > 0 ? `R${v.round}/${v.maxRounds}` : ''}</div>
        <div className="vs">VS</div>
      </div>
      <div className="side opp">
        <div className="pname">{v.opp.name}{v.opp.isBot && <span className="badge">bot</span>}{!v.opp.connected && <span className="badge bad">切断中</span>}</div>
        <div className="score">{v.opp.score}</div>
        <div className="sub">{v.opp.pref ?? '？'} {v.opp.muni ? <b>{v.opp.muni.name}</b> : <span className="secret">？？？</span>}{v.opp.streak >= 2 && <span className="combo">{v.opp.streak}連続</span>}</div>
      </div>
    </header>
  );
}

function Timer({ remaining, total, paused }: { remaining: number | null; total: number; paused?: boolean }) {
  if (remaining == null) return null;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  return (
    <div className={`timer ${paused ? 'paused' : ''} ${remaining < 5000 ? 'hurry' : ''}`}>
      <div className="bar" style={{ width: `${pct}%` }} />
      <span>{paused ? '一時停止中' : `${Math.ceil(remaining / 1000)}秒`}</span>
    </div>
  );
}

function TopicCard({ t, children }: { t: TopicView; children?: React.ReactNode }) {
  return (
    <div className="card topic">
      <div className="cat">{t.category}</div>
      <h2>{t.name}</h2>
      <div className="muted small">{t.year}{t.unit && `・単位: ${t.unit}`}</div>
      <div className="myval">
        <span className="muted">あなた</span> <b>{fmt(t.myValue)}</b> {t.unit}
      </div>
      {children}
    </div>
  );
}

function CountUp({ value, ms = 1200 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(p >= 1 ? value : value * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  const decimals = Number.isInteger(value) ? 0 : 2;
  return <>{shown.toLocaleString('ja-JP', { maximumFractionDigits: decimals, minimumFractionDigits: 0 })}</>;
}

function HighLow({ onPick, chosen, disabled }: { onPick: (c: Choice) => void; chosen: Choice | null; disabled?: boolean }) {
  return (
    <div className="hl">
      <button className={`btn high ${chosen === 'high' ? 'chosen' : ''}`} disabled={disabled || !!chosen} onClick={() => onPick('high')}>
        High<small>自分の方が高い</small>
      </button>
      <button className={`btn low ${chosen === 'low' ? 'chosen' : ''}`} disabled={disabled || !!chosen} onClick={() => onPick('low')}>
        Low<small>自分の方が低い</small>
      </button>
    </div>
  );
}

type Send = (m: Parameters<RoomConnection['send']>[0]) => void;

function Phase({ v, now, remaining, send, onExit }: { v: PlayerView; now: number; remaining: number | null; send: Send; onExit: () => void }) {
  switch (v.phase) {
    case 'select':
      return <Select v={v} remaining={remaining} send={send} />;
    case 'intro':
      return (
        <div className="intro">
          <p>対戦開始！</p>
          <h2>相手は <b>{v.opp.pref}</b> のどこか</h2>
          <p className="muted">あなたは {v.me.muni?.pref} {v.me.muni?.name}</p>
        </div>
      );
    case 'answer':
    case 'nominate':
    case 'cutin':
      return <Answer v={v} remaining={remaining} send={send} />;
    case 'result':
      return <RoundResult h={v.history[v.history.length - 1]} />;
    case 'sudden_countdown':
    case 'sudden_answer':
    case 'sudden_result':
      return <Sudden v={v} now={now} send={send} />;
    case 'finished':
      return <Finished v={v} send={send} onExit={onExit} />;
  }
}

function Select({ v, remaining, send }: { v: PlayerView; remaining: number | null; send: Send }) {
  const s = v.select!;
  if (s.chosen) return <div className="center"><div className="spinner" /><p>相手が選ぶのを待っています</p></div>;
  return (
    <div className="stack">
      <Timer remaining={remaining} total={20_000} />
      {s.options ? (
        <>
          <h3>あなたの自治体を選んでください</h3>
          <div className="draft">
            {s.options.map((m) => (
              <button key={m.code} className="card draft-card" onClick={() => send({ type: 'select', code: m.code })}>
                <div className="muted">{m.pref}</div>
                <div className="big">{m.name}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <MuniPicker title="あなたの市区町村を選び直してください" onPick={(m) => send({ type: 'select', code: m.code })} />
      )}
    </div>
  );
}

function Answer({ v, remaining, send }: { v: PlayerView; remaining: number | null; send: Send }) {
  const nom = v.nomination;
  const canNominate = v.phase === 'answer' && !v.me.guessedOpp && v.me.nominationsLeft > 0;
  return (
    <div className="stack">
      <Timer remaining={v.phase === 'answer' ? remaining : v.pausedRemainingMs} total={15_000} paused={v.phase !== 'answer'} />
      {v.topic && (
        <TopicCard t={v.topic}>
          <div className="opp-status muted">{v.opp.answered ? '相手は回答済み' : '相手は考え中…'}</div>
        </TopicCard>
      )}
      <HighLow chosen={v.me.choice} disabled={v.phase !== 'answer'} onPick={(c) => send({ type: 'answer', choice: c })} />
      <button className="btn nominate" disabled={!canNominate} onClick={() => send({ type: 'nominate_start' })}>
        {v.me.guessedOpp ? '名指し成功済み' : `相手の市区町村を名指し（残り${v.me.nominationsLeft}回）`}
      </button>
      {v.me.wrongGuesses.length > 0 && <p className="muted small">外れた名指し: {v.me.wrongGuesses.join('、')}</p>}

      {v.phase === 'nominate' && nom?.by === 'me' && (
        <div className="overlay">
          <div className="sheet">
            <Timer remaining={nom.deadline ? Math.max(0, nom.deadline - (v.serverNow + (Date.now() - receivedAt(v)))) : null} total={10_000} />
            <MuniPicker
              title={`${v.opp.pref}のどこ？`}
              fixedPref={v.opp.pref ?? undefined}
              exclude={v.me.wrongGuesses}
              onPick={(m) => send({ type: 'nominate', code: m.code })}
            />
          </div>
        </div>
      )}
      {v.phase === 'nominate' && nom?.by === 'opp' && (
        <div className="overlay"><div className="cutin wait">相手が名指ししようとしています…</div></div>
      )}
      {v.phase === 'cutin' && nom && (
        <div className="overlay">
          <div className={`cutin ${nom.correct ? 'hit' : 'miss'}`}>
            <div className="who">{nom.by === 'me' ? 'あなた' : '相手'}の名指し</div>
            <div className="name">{nom.muniName}！？</div>
            <div className="verdict">{nom.correct ? (nom.by === 'me' ? '正解！ +3点' : 'バレた…') : nom.by === 'me' ? 'ハズレ… -1点' : 'ハズレ！'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// state を受け取った時刻（名指しの残り時間の表示用）
const receivedTimes = new WeakMap<PlayerView, number>();
function receivedAt(v: PlayerView): number {
  if (!receivedTimes.has(v)) receivedTimes.set(v, Date.now());
  return receivedTimes.get(v)!;
}

function RoundResult({ h }: { h: HistoryEntry }) {
  const verdict = (c: boolean | null, d: number) => (c == null ? '同値（ノーカウント）' : c ? `正解 +${d}` : `不正解 ${d < 0 ? d : '±0'}`);
  return (
    <div className="stack">
      <div className="card topic flip">
        <div className="cat">{h.topic.category}</div>
        <h2>{h.topic.name}</h2>
        <div className="compare">
          <div>
            <div className="muted">あなた</div>
            <div className="big">{fmt(h.topic.myValue)}</div>
          </div>
          <div className="vs">vs</div>
          <div>
            <div className="muted">相手</div>
            <div className="big reveal"><CountUp value={h.oppValue} /></div>
          </div>
        </div>
        <div className="muted small">{h.topic.unit}</div>
      </div>
      <div className="verdicts">
        <div className={`verdict ${h.myCorrect ? 'ok' : h.myCorrect === false ? 'ng' : ''}`}>
          あなた（{h.myChoice === 'high' ? 'High' : h.myChoice === 'low' ? 'Low' : '時間切れ'}）<b>{verdict(h.myCorrect, h.myDelta)}</b>
        </div>
        <div className={`verdict ${h.oppCorrect ? 'ok' : h.oppCorrect === false ? 'ng' : ''}`}>
          相手（{h.oppChoice === 'high' ? 'High' : h.oppChoice === 'low' ? 'Low' : '時間切れ'}）<b>{verdict(h.oppCorrect, h.oppDelta)}</b>
        </div>
      </div>
    </div>
  );
}

function Sudden({ v, now, send }: { v: PlayerView; now: number; send: Send }) {
  const s = v.sudden!;
  const shownAt = useRef<{ showAt: number; perf: number } | null>(null);
  const visible = now >= s.showAt;
  if (visible && shownAt.current?.showAt !== s.showAt) shownAt.current = { showAt: s.showAt, perf: performance.now() };
  const [myPress, setMyPress] = useState<number | null>(null);
  useEffect(() => setMyPress(null), [s.showAt]);

  if (!visible) {
    return (
      <div className="intro sudden">
        <p>早押しモード</p>
        <div className="countdown">{Math.max(1, Math.ceil((s.showAt - now) / 1000))}</div>
        <p className="muted">先に押した方の答えで決着。正解なら勝ち、不正解なら負け！</p>
      </div>
    );
  }
  const press = (c: Choice) => {
    // お題が表示されてから押すまでの時間をスマホ側で計測して送る
    const ms = Math.round(performance.now() - (shownAt.current?.perf ?? performance.now()));
    setMyPress(ms);
    send({ type: 'press', choice: c, reactionMs: ms });
  };
  const r = s.result;
  return (
    <div className="stack">
      <div className="sudden-label">早押し！</div>
      <TopicCard t={s.topic} />
      {!r && <HighLow chosen={null} disabled={s.pressed || myPress != null} onPick={press} />}
      {!r && (s.pressed || myPress != null) && <p className="center">押しました（{((myPress ?? 0) / 1000).toFixed(2)}秒）。判定中…</p>}
      {r && (
        <div className="card">
          <div className="times">
            <div className={r.adopted === 'me' ? 'win' : ''}>あなた {r.myMs != null ? `${(r.myMs / 1000).toFixed(2)}秒` : '―'}</div>
            <div className={r.adopted === 'opp' ? 'win' : ''}>相手 {r.oppMs != null ? `${(r.oppMs / 1000).toFixed(2)}秒` : '―'}</div>
          </div>
          <p>
            {r.adopted === 'me' ? 'あなた' : '相手'}が早かった！ 答えは {r.choice === 'high' ? 'High' : 'Low'} …{' '}
            <b>{r.correct ? '正解' : '不正解'}</b>
          </p>
          <p className="muted">相手の数値: {fmt(r.oppValue)} {s.topic.unit}</p>
        </div>
      )}
    </div>
  );
}

function Finished({ v, send, onExit }: { v: PlayerView; send: Send; onExit: () => void }) {
  const f = v.finish!;
  const reason = { score: '', rounds: '15ラウンド終了', sudden: '早押しで決着', forfeit: f.winner === 'me' ? '相手が退出しました' : '時間内に戻れませんでした' }[f.reason];
  return (
    <div className="stack">
      <div className={`result-title ${f.winner === 'me' ? 'win' : 'lose'}`}>{f.winner === 'me' ? '勝利！' : '敗北…'}</div>
      {reason && <p className="center muted">{reason}</p>}
      <div className="card reveal-munis">
        <div>
          <div className="muted">あなた</div>
          <div className="big">{f.myMuni.name}</div>
          <div className="muted">{f.myMuni.pref}</div>
        </div>
        <div>
          <div className="muted">相手の正体は…</div>
          <div className="big">{f.oppMuni.name}</div>
          <div className="muted">{f.oppMuni.pref}</div>
        </div>
      </div>
      <HintHistory history={v.history} open />
      {f.reason !== 'forfeit' && (
        <button className="btn primary" disabled={f.rematch.me} onClick={() => send({ type: 'rematch' })}>
          {f.rematch.me ? (f.rematch.opp ? '開始します…' : '相手の返事を待っています') : f.rematch.opp ? '相手が再戦を希望！ もう一度' : 'もう一度'}
        </button>
      )}
      <button className="btn" onClick={onExit}>トップへ</button>
    </div>
  );
}

function HintHistory({ history, open }: { history: HistoryEntry[]; open?: boolean }) {
  return (
    <details className="history" open={open}>
      <summary>ヒント履歴（相手の数値）</summary>
      <table>
        <tbody>
          {history.map((h) => (
            <tr key={h.round}>
              <td>{h.topic.name}</td>
              <td className="num">{fmt(h.topic.myValue)}</td>
              <td className="num opp">{fmt(h.oppValue)}</td>
              <td className="muted small">{h.topic.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
