// 効果音とBGM。音源ファイルは使わず、ブラウザの Web Audio でその場で合成する。

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bgmGain: GainNode | null = null;

function load(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : v === '1';
  } catch {
    return def;
  }
}
function save(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* noop */
  }
}

export const settings = { se: load('hl-se', true), bgm: load('hl-bgm', true) };

/** スマホは最初のタップまで音を出せないので、タップ時に呼ぶ */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = settings.bgm ? 0.18 : 0;
    bgmGain.connect(master);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  if (wanted && !current) bgm(wanted);
}

function tone(freq: number, start: number, dur: number, opts: { wave?: Wave; vol?: number; to?: number; dest?: AudioNode } = {}) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.wave ?? 'square';
  o.frequency.setValueAtTime(freq, start);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
  const vol = opts.vol ?? 0.25;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(opts.dest ?? master);
  o.start(start);
  o.stop(start + dur + 0.02);
}

const N = (semi: number) => 440 * Math.pow(2, (semi - 9) / 12); // 0 = C4

export type Se = 'tap' | 'correct' | 'wrong' | 'tie' | 'start' | 'tick' | 'go' | 'cutin' | 'hit' | 'miss' | 'win' | 'lose' | 'reveal';

export function se(kind: Se) {
  if (!settings.se || !ctx) return;
  const t = ctx.currentTime + 0.01;
  switch (kind) {
    case 'tap':
      tone(N(24), t, 0.05, { wave: 'square', vol: 0.12 });
      break;
    case 'correct': // ピコーン！
      tone(N(19), t, 0.09, { wave: 'square', vol: 0.22 });
      tone(N(31), t + 0.09, 0.55, { wave: 'square', vol: 0.22 });
      tone(N(31), t + 0.09, 0.55, { wave: 'sine', vol: 0.2 });
      break;
    case 'wrong': // ブブー
      tone(N(-5), t, 0.18, { wave: 'sawtooth', vol: 0.2 });
      tone(N(-6), t + 0.22, 0.4, { wave: 'sawtooth', vol: 0.2 });
      break;
    case 'tie':
      tone(N(12), t, 0.15, { wave: 'triangle' });
      tone(N(12), t + 0.18, 0.15, { wave: 'triangle' });
      break;
    case 'start': // デデン
      tone(N(0), t, 0.12, { wave: 'square', vol: 0.2 });
      tone(N(7), t + 0.14, 0.3, { wave: 'square', vol: 0.2 });
      break;
    case 'tick':
      tone(N(36), t, 0.04, { wave: 'square', vol: 0.1 });
      break;
    case 'go':
      tone(N(24), t, 0.35, { wave: 'square', vol: 0.25 });
      break;
    case 'reveal': // ドラムロールの締め
      for (let i = 0; i < 10; i++) tone(N(0 + i), t + i * 0.06, 0.05, { wave: 'triangle', vol: 0.12 });
      break;
    case 'cutin': // ジャジャーン
      tone(N(-12), t, 0.6, { wave: 'sawtooth', vol: 0.18, to: N(0) });
      [0, 4, 7, 12].forEach((s) => tone(N(s), t + 0.05, 0.6, { wave: 'square', vol: 0.1 }));
      break;
    case 'hit':
      [0, 4, 7, 12, 16].forEach((s, i) => tone(N(12 + s), t + i * 0.07, 0.3, { wave: 'square', vol: 0.18 }));
      break;
    case 'miss':
      tone(N(7), t, 0.25, { wave: 'triangle', vol: 0.25, to: N(-5) });
      tone(N(0), t + 0.25, 0.4, { wave: 'triangle', vol: 0.25, to: N(-12) });
      break;
    case 'win': // ファンファーレ
      [[0, 0.12], [0, 0.12], [0, 0.12], [8, 0.3], [10, 0.3], [12, 0.6]].reduce((at, [s, d]) => {
        tone(N(12 + s), at, d, { wave: 'square', vol: 0.2 });
        tone(N(s), at, d, { wave: 'triangle', vol: 0.15 });
        return at + d + 0.02;
      }, t);
      break;
    case 'lose':
      [7, 6, 5, 4].forEach((s, i) => tone(N(s), t + i * 0.28, 0.3, { wave: 'triangle', vol: 0.22 }));
      break;
  }
}

// ───────── BGM（簡単なループを先読みで鳴らす） ─────────

type Track = { bpm: number; bass: number[]; melody: (number | null)[] };
const TRACKS: Record<'battle' | 'sudden' | 'menu', Track> = {
  menu: {
    bpm: 100,
    bass: [-12, -12, -5, -5, -7, -7, -10, -10],
    melody: [7, null, 12, null, 11, 9, 7, null, 5, null, 9, null, 7, 5, 4, null],
  },
  battle: {
    bpm: 132,
    bass: [-12, -12, -9, -9, -14, -14, -7, -7],
    melody: [0, 3, 7, 3, 10, 7, 3, 7, 2, 5, 9, 5, 12, 9, 7, 5],
  },
  sudden: {
    bpm: 168,
    bass: [-12, -11, -12, -11, -12, -11, -10, -9],
    melody: [12, null, 12, 11, 12, null, 15, 14, 12, null, 10, null, 11, null, 7, null],
  },
};

let current: keyof typeof TRACKS | null = null;
let wanted: keyof typeof TRACKS | null = null;
let timer: number | undefined;
let step = 0;
let nextAt = 0;

export function bgm(track: keyof typeof TRACKS | null) {
  wanted = track;
  if (!ctx) return; // 最初のタップ（unlock）で鳴らし始める
  if (track === current) return;
  current = track;
  window.clearInterval(timer);
  timer = undefined;
  if (!track) return;
  step = 0;
  nextAt = ctx.currentTime + 0.1;
  timer = window.setInterval(schedule, 50);
}

function schedule() {
  if (!ctx || !current || !bgmGain) return;
  const tr = TRACKS[current];
  const sixteenth = 60 / tr.bpm / 4;
  while (nextAt < ctx.currentTime + 0.2) {
    const m = tr.melody[step % tr.melody.length];
    if (m != null) tone(N(m + 12), nextAt, sixteenth * 0.9, { wave: 'square', vol: 0.12, dest: bgmGain });
    if (step % 2 === 0) tone(N(tr.bass[(step / 2) % tr.bass.length]), nextAt, sixteenth * 1.8, { wave: 'triangle', vol: 0.3, dest: bgmGain });
    if (step % 4 === 0) tone(80, nextAt, 0.08, { wave: 'sine', vol: 0.35, to: 40, dest: bgmGain });
    nextAt += sixteenth;
    step++;
  }
}

export function setSe(on: boolean) {
  settings.se = on;
  save('hl-se', on);
}

export function setBgm(on: boolean) {
  settings.bgm = on;
  save('hl-bgm', on);
  if (bgmGain && ctx) bgmGain.gain.setTargetAtTime(on ? 0.18 : 0, ctx.currentTime, 0.05);
}
