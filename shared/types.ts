export type Category = '人口' | '土地' | '財政' | '産業' | '生活' | '農産物' | '水産物' | '経済';
export type Choice = 'high' | 'low';
export type Mode = 'free' | 'draft';
export type BotLevel = 'weak' | 'normal' | 'strong';

export interface Indicator {
  id: string;
  name: string;
  unit: string;
  year: string;
  category: Category;
  source: string;
}

/** サーバー側だけが持つ自治体データ。v は indicators と同じ順番の数値（null = データなし） */
export interface MuniRecord {
  c: string; // 全国地方公共団体コード
  n: string; // 名前
  p: string; // 都道府県
  k: '市' | '町' | '村' | '区';
  v: (number | null)[];
}

export interface Dataset {
  version: string;
  dummy?: boolean;
  indicators: Indicator[];
  munis: MuniRecord[];
}

/** クライアントに配ってよい自治体情報（数値は含まない） */
export interface MuniInfo {
  code: string;
  name: string;
  pref: string;
  kind: string;
}

export interface TopicView {
  id: string;
  name: string;
  unit: string;
  year: string;
  category: Category;
  myValue: number;
}

export interface HistoryEntry {
  round: number;
  topic: TopicView;
  oppValue: number;
  myChoice: Choice | null;
  oppChoice: Choice | null;
  myCorrect: boolean | null; // null = 同値ノーカウント
  oppCorrect: boolean | null;
  myDelta: number;
  oppDelta: number;
}

export interface NominationView {
  by: 'me' | 'opp';
  muniName: string;
  correct: boolean | null; // null = 選択中 / キャンセル
  cancelled?: boolean;
}

export interface SuddenView {
  topic: TopicView;
  showAt: number;
  pressed: boolean;
  result?: {
    adopted: 'me' | 'opp';
    choice: Choice;
    correct: boolean;
    myMs: number | null;
    oppMs: number | null;
    oppValue: number;
  };
}

export type Phase =
  | 'select'
  | 'intro'
  | 'answer'
  | 'nominate'
  | 'cutin'
  | 'result'
  | 'sudden_countdown'
  | 'sudden_answer'
  | 'sudden_result'
  | 'finished';

export interface PlayerView {
  phase: Phase;
  serverNow: number;
  deadline: number | null;
  pausedRemainingMs: number | null;
  round: number;
  maxRounds: number;
  mode: Mode;
  notice: string | null;
  select?: { options: MuniInfo[] | null; chosen: boolean; oppChosen: boolean };
  me: {
    name: string;
    muni: MuniInfo | null;
    score: number;
    streak: number;
    nominationsLeft: number;
    choice: Choice | null;
    guessedOpp: boolean;
    wrongGuesses: string[];
  };
  opp: {
    name: string;
    isBot: boolean;
    botLevel?: BotLevel;
    pref: string | null;
    muni: MuniInfo | null; // 名指しで当てたか試合終了まで null
    score: number;
    streak: number;
    nominationsLeft: number;
    answered: boolean;
    guessedMe: boolean;
    connected: boolean;
  };
  topic: TopicView | null;
  history: HistoryEntry[];
  nomination: (NominationView & { deadline?: number }) | null;
  sudden: SuddenView | null;
  finish?: {
    winner: 'me' | 'opp';
    reason: 'score' | 'sudden' | 'forfeit' | 'rounds';
    myMuni: MuniInfo;
    oppMuni: MuniInfo;
    rematch: { me: boolean; opp: boolean };
  };
}

export type ClientMessage =
  | { type: 'select'; code: string }
  | { type: 'answer'; choice: Choice }
  | { type: 'nominate_start' }
  | { type: 'nominate'; code: string }
  | { type: 'press'; choice: Choice; reactionMs: number }
  | { type: 'rematch' }
  | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'state'; view: PlayerView }
  | { type: 'pong'; t: number; serverNow: number }
  | { type: 'waiting'; text: string; inviteUrl?: string }
  | { type: 'matched'; roomId: string; token: string }
  | { type: 'error'; text: string };
