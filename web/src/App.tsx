import { useEffect, useState } from 'react';
import type { BotLevel, Mode, MuniInfo, ServerMessage } from '../../shared/types';
import { Game } from './Game';
import { MuniPicker } from './MuniPicker';
import { postJson, wsUrl } from './net';
import { bgm, se, unlock } from './sound';
import { SoundToggle } from './SoundToggle';

type Action = { kind: 'random' | 'invite' | 'bot'; mode: Mode; level?: BotLevel };
type Screen =
  | { k: 'home' }
  | { k: 'pick'; action: Action }
  | { k: 'queue'; mode: Mode; muni: string | null }
  | { k: 'join'; roomId: string; mode: Mode }
  | { k: 'game'; roomId: string; token: string; inviteUrl?: string }
  | { k: 'rules' };

const SESSION_KEY = 'hl-session';

function store<T>(key: string, value?: T): T | null {
  try {
    if (value === undefined) return JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できない環境 */
  }
  return null;
}

function initialScreen(): Screen {
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  const saved = store<{ roomId: string; token: string }>(SESSION_KEY);
  if (saved) return { k: 'game', ...saved };
  if (room && /^[0-9a-f]{12}$/.test(room)) return { k: 'join', roomId: room, mode: params.get('mode') === 'draft' ? 'draft' : 'free' };
  return { k: 'home' };
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('hl-name') ?? '';
    } catch {
      return '';
    }
  });
  const [mode, setMode] = useState<Mode>('draft');
  const [meta, setMeta] = useState<{ dummy: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // スマホは最初のタップで音を解禁する。ボタンを押したら軽いクリック音
    const onDown = (e: PointerEvent) => {
      unlock();
      if (screen.k !== 'game') bgm('menu');
      if ((e.target as HTMLElement).closest('button')) se('tap');
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [screen.k]);
  useEffect(() => {
    if (screen.k !== 'game') bgm('menu');
  }, [screen.k]);
  useEffect(() => {
    fetch('/api/meta').then((r) => r.json() as Promise<{ dummy: boolean }>).then(setMeta).catch(() => {});
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('hl-name', name);
    } catch {
      /* noop */
    }
  }, [name]);

  const goGame = (roomId: string, token: string, inviteUrl?: string) => {
    store(SESSION_KEY, { roomId, token });
    history.replaceState(null, '', '/');
    setScreen({ k: 'game', roomId, token, inviteUrl });
  };
  const home = () => {
    store(SESSION_KEY, null);
    history.replaceState(null, '', '/');
    setScreen({ k: 'home' });
  };

  const run = async (a: Action, muni: MuniInfo | null) => {
    setError(null);
    try {
      if (a.kind === 'random') setScreen({ k: 'queue', mode: a.mode, muni: muni?.code ?? null });
      else if (a.kind === 'bot') {
        const r = await postJson<{ roomId: string; token: string }>('/api/bot', { mode: a.mode, level: a.level, name, muni: muni?.code });
        goGame(r.roomId, r.token);
      } else {
        const r = await postJson<{ roomId: string; token: string; inviteUrl: string }>('/api/invite', { mode: a.mode, name, muni: muni?.code });
        goGame(r.roomId, r.token, r.inviteUrl);
      }
    } catch (e) {
      setError((e as Error).message);
      setScreen({ k: 'home' });
    }
  };
  const start = (a: Action) => (a.mode === 'free' ? setScreen({ k: 'pick', action: a }) : run(a, null));

  const banner = meta?.dummy && <div className="banner">開発中：数値はテスト用のダミーデータです（本物の統計ではありません）</div>;

  if (screen.k === 'game') return <>{banner}<Game {...screen} onExit={home} /></>;

  return (
    <div className="page">
      {banner}
      <SoundToggle />
      <header className="title">
        <h1>市区町村<br />High &amp; Low</h1>
        <p className="muted">相手の市区町村はどこ？ 数値で読み合う1対1の推理バトル</p>
      </header>

      {error && <p className="error">{error}</p>}

      {screen.k === 'home' && (
        <div className="stack">
          <label className="label">
            ニックネーム
            <input className="input" maxLength={12} value={name} placeholder="ななし" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="segmented">
            <button className={mode === 'draft' ? 'on' : ''} onClick={() => setMode('draft')}>ドラフト<small>3候補から選ぶ</small></button>
            <button className={mode === 'free' ? 'on' : ''} onClick={() => setMode('free')}>フリー<small>好きな自治体で</small></button>
          </div>
          <button className="btn primary" onClick={() => start({ kind: 'random', mode })}>ランダムマッチ</button>
          <button className="btn" onClick={() => start({ kind: 'invite', mode })}>友達を招待して対戦</button>
          <div className="bot-row">
            <span>bot と対戦</span>
            {(['weak', 'normal', 'strong'] as BotLevel[]).map((lv) => (
              <button key={lv} className="btn small" onClick={() => start({ kind: 'bot', mode, level: lv })}>
                {{ weak: '弱い', normal: '普通', strong: '強い' }[lv]}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => setScreen({ k: 'rules' })}>遊び方</button>
        </div>
      )}

      {screen.k === 'pick' && (
        <div className="stack">
          <MuniPicker title="あなたの市区町村を選んでください" onPick={(m) => run(screen.action, m)} />
          <button className="link" onClick={() => setScreen({ k: 'home' })}>戻る</button>
        </div>
      )}

      {screen.k === 'queue' && <Queue mode={screen.mode} muni={screen.muni} name={name} onMatched={goGame} onCancel={home} />}

      {screen.k === 'join' && <Join {...screen} name={name} setName={setName} onJoined={goGame} onCancel={home} />}

      {screen.k === 'rules' && <Rules onBack={() => setScreen({ k: 'home' })} />}
    </div>
  );
}

function Queue(props: { mode: Mode; muni: string | null; name: string; onMatched: (roomId: string, token: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('対戦相手を探しています');
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const q = new URLSearchParams({ mode: props.mode, name: props.name });
    if (props.muni) q.set('muni', props.muni);
    const ws = new WebSocket(wsUrl(`/api/queue?${q}`));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as ServerMessage;
      if (m.type === 'waiting') setText(m.text);
      if (m.type === 'matched') {
        ws.onclose = null;
        ws.close();
        props.onMatched(m.roomId, m.token);
      }
    };
    ws.onclose = () => setText('通信が切れました。戻ってやり直してください');
    const t = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => {
      ws.onclose = null;
      ws.close();
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="stack center">
      <div className="spinner" />
      <p>{text}</p>
      <p className="muted">{sec}秒（20秒で bot に切り替わります）</p>
      <button className="link" onClick={props.onCancel}>やめる</button>
    </div>
  );
}

function Join(props: { roomId: string; mode: Mode; name: string; setName: (s: string) => void; onJoined: (r: string, t: string) => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const join = async (muni: MuniInfo | null) => {
    try {
      const r = await postJson<{ token: string }>(`/api/invite/${props.roomId}/join`, { name: props.name, muni: muni?.code });
      props.onJoined(props.roomId, r.token);
    } catch (e) {
      setError((e as Error).message);
      setPicking(false);
    }
  };
  if (picking) return <MuniPicker title="あなたの市区町村を選んでください" onPick={(m) => join(m)} />;
  return (
    <div className="stack">
      <h2>招待されました（{props.mode === 'draft' ? 'ドラフト' : 'フリー'}対戦）</h2>
      {error && <p className="error">{error}</p>}
      <label className="label">
        ニックネーム
        <input className="input" maxLength={12} value={props.name} placeholder="ななし" onChange={(e) => props.setName(e.target.value)} />
      </label>
      <button className="btn primary" onClick={() => (props.mode === 'free' ? setPicking(true) : join(null))}>対戦に参加する</button>
      <button className="link" onClick={props.onCancel}>トップへ</button>
    </div>
  );
}

function Rules({ onBack }: { onBack: () => void }) {
  const [inds, setInds] = useState<{ name: string; year: string; source: string }[]>([]);
  useEffect(() => {
    fetch('/api/meta').then((r) => r.json() as Promise<{ indicators: typeof inds }>).then((m) => setInds(m.indicators)).catch(() => {});
  }, []);
  return (
    <div className="stack rules">
      <h2>遊び方</h2>
      <ol>
        <li>自分の市区町村を決めます。相手に見えるのは都道府県だけです。</li>
        <li>お題（人口、面積など）が出たら、自分の数値が相手より <b>High</b>（高い）か <b>Low</b>（低い）かを15秒以内に選びます。</li>
        <li>正解で +1点。連続正解で +2、+3 と増えます（上限 +3）。不正解は -1点。</li>
        <li>結果では相手の<b>数値だけ</b>が公開されます。市区町村名は試合終了まで秘密です。</li>
        <li>公開された数値から相手の市区町村を推理して<b>名指し</b>できます（1試合3回）。当たれば +3点、外れたら -1点。</li>
        <li>先に10点に届いた方の勝ち（最大15ラウンド）。同点なら<b>早押し</b>で決着します。</li>
      </ol>
      <h3>お題とデータの出典</h3>
      <p className="muted small">政府・自治体などが公開している統計データを加工して使っています。</p>
      <table className="sources">
        <tbody>
          {inds.map((i) => (
            <tr key={i.name}>
              <td>{i.name}</td>
              <td className="muted small">{i.source}（{i.year}）</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" onClick={onBack}>戻る</button>
    </div>
  );
}
