import * as C from '../shared/constants';
import type {
  BotLevel,
  Choice,
  ClientMessage,
  Dataset,
  HistoryEntry,
  Mode,
  MuniInfo,
  Phase,
  PlayerView,
  TopicView,
} from '../shared/types';
import { BOT_ANSWER_MS, BOT_REACTION_MS, decideChoice, decideNomination, type BotKnowledge } from './bot';
import { between, type Rng } from './rng';
import { drawDraft, pickTopic } from './topics';

export interface PlayerInit {
  name: string;
  isBot?: boolean;
  botLevel?: BotLevel;
  /** フリー対戦で事前に選んだ自治体コード */
  muniCode?: string | null;
}

interface Player {
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
  initialMuni: number | null;
  muni: number | null;
  selectOptions: number[] | null;
  selected: boolean;
  score: number;
  streak: number;
  nominationsLeft: number;
  guessedOpp: boolean;
  wrongGuesses: number[];
  choice: Choice | null;
  connected: boolean;
  rematch: boolean;
}

interface RoundRec {
  round: number;
  topic: number;
  values: [number, number];
  choices: [Choice | null, Choice | null];
  correct: [boolean | null, boolean | null];
  deltas: [number, number];
}

interface Press {
  choice: Choice;
  reactionMs: number;
  receivedAt: number;
  valid: boolean;
}

interface Sudden {
  topic: number;
  showAt: number;
  answerDeadline: number;
  graceDeadline: number | null;
  presses: [Press | null, Press | null];
  result: { adopted: 0 | 1; correct: boolean } | null;
}

interface BotTask {
  at: number;
  player: 0 | 1;
  msg: ClientMessage;
}

type Idx = 0 | 1;
const other = (p: Idx): Idx => (p === 0 ? 1 : 0);

export class Match {
  phase: Phase = 'select';
  deadline: number | null = null;
  pausedRemaining: number | null = null;
  round = 0;
  topic: number | null = null;
  usedTopics = new Set<number>();
  lastCategory: string | null = null;
  history: RoundRec[] = [];
  nomination: { by: Idx; code: number | null; correct: boolean | null; cancelled: boolean } | null = null;
  sudden: Sudden | null = null;
  finish: { winner: Idx; reason: 'score' | 'sudden' | 'forfeit' | 'rounds' } | null = null;
  notice: string | null = null;
  botTasks: BotTask[] = [];
  /** 一時停止中の bot の予定（残り時間） */
  pausedBotTasks: { remaining: number; player: Idx; msg: ClientMessage }[] = [];
  players: [Player, Player];
  private codeIndex: Map<string, number>;

  constructor(
    readonly ds: Dataset,
    readonly mode: Mode,
    inits: [PlayerInit, PlayerInit],
    readonly rng: Rng,
  ) {
    this.codeIndex = new Map(ds.munis.map((m, i) => [m.c, i]));
    this.players = inits.map((p) => {
      const idx = p.muniCode ? this.codeIndex.get(p.muniCode) ?? null : null;
      return {
        name: p.name,
        isBot: !!p.isBot,
        botLevel: p.botLevel,
        initialMuni: mode === 'free' ? idx : null,
        muni: null,
        selectOptions: null,
        selected: false,
        score: 0,
        streak: 0,
        nominationsLeft: C.NOMINATIONS,
        guessedOpp: false,
        wrongGuesses: [],
        choice: null,
        connected: true,
        rematch: false,
      };
    }) as unknown as [Player, Player];
  }

  // ───────── 開始・自治体選択 ─────────

  start(now: number) {
    const [a, b] = this.players;
    if (this.mode === 'free') {
      // フリー対戦の bot は、相手と違う自治体をドラフトと同じ方法で選ぶ
      this.players.forEach((pl, i) => {
        if (!pl.isBot || pl.initialMuni != null) return;
        const theirs = this.players[1 - i].initialMuni;
        const opts = drawDraft(this.ds, new Set(theirs != null ? [theirs] : []), this.rng);
        pl.initialMuni = opts[Math.floor(this.rng() * opts.length)];
      });
    }
    if (this.mode === 'free' && a.initialMuni != null && b.initialMuni != null && a.initialMuni !== b.initialMuni) {
      a.muni = a.initialMuni;
      b.muni = b.initialMuni;
      this.enterIntro(now);
      return;
    }
    let notice: string | null = null;
    if (this.mode === 'free' && a.initialMuni != null && a.initialMuni === b.initialMuni) {
      notice = '偶然同じ自治体でした。お互いに選び直してください';
    }
    this.enterSelect(now, notice);
  }

  private enterSelect(now: number, notice: string | null) {
    this.phase = 'select';
    this.notice = notice;
    this.deadline = now + C.SELECT_MS;
    const taken = new Set<number>();
    for (const p of this.players) {
      p.muni = null;
      p.selected = false;
      if (this.mode === 'draft' || p.isBot) {
        p.selectOptions = drawDraft(this.ds, taken, this.rng);
        p.selectOptions.forEach((i) => taken.add(i));
      } else {
        p.selectOptions = null; // フリー: 全自治体から選ぶ
      }
    }
    this.players.forEach((p, i) => {
      if (p.isBot && p.selectOptions) {
        const pick = p.selectOptions[Math.floor(this.rng() * p.selectOptions.length)];
        this.botTasks.push({ at: now + between(this.rng, 800, 2500), player: i as Idx, msg: { type: 'select', code: this.ds.munis[pick].c } });
      }
    });
  }

  private handleSelect(p: Idx, code: string, now: number): string | null {
    if (this.phase !== 'select') return '今は自治体を選べません';
    const pl = this.players[p];
    if (pl.selected) return 'すでに選んでいます';
    const idx = this.codeIndex.get(code);
    if (idx == null) return 'その自治体は見つかりません';
    if (pl.selectOptions && !pl.selectOptions.includes(idx)) return '候補にない自治体です';
    pl.muni = idx;
    pl.selected = true;
    this.afterSelect(now);
    return null;
  }

  private afterSelect(now: number) {
    const [a, b] = this.players;
    if (!a.selected || !b.selected) return;
    if (a.muni === b.muni) {
      this.enterSelect(now, '偶然同じ自治体でした。お互いに選び直してください');
      return;
    }
    this.enterIntro(now);
  }

  private selectTimeout(now: number) {
    for (const p of this.players) {
      if (p.selected) continue;
      const pool = p.selectOptions ?? drawDraft(this.ds, new Set(), this.rng);
      p.muni = pool[Math.floor(this.rng() * pool.length)];
      p.selected = true;
    }
    this.afterSelect(now);
  }

  private enterIntro(now: number) {
    this.phase = 'intro';
    this.deadline = now + C.INTRO_MS;
  }

  // ───────── 通常ラウンド ─────────

  private nextRound(now: number) {
    const [a, b] = this.players;
    const t = pickTopic(this.ds, a.muni!, b.muni!, this.usedTopics, this.lastCategory, this.rng);
    if (t == null) {
      // 出せるお題がなくなったら、点数で決着
      this.decideAfterRounds(now, true);
      return;
    }
    this.round++;
    this.topic = t;
    this.usedTopics.add(t);
    this.lastCategory = this.ds.indicators[t].category;
    a.choice = null;
    b.choice = null;
    this.nomination = null;
    this.notice = null;
    this.phase = 'answer';
    this.deadline = now + C.ANSWER_MS;
    this.scheduleBotRound(now);
  }

  private knowledge(p: Idx): BotKnowledge {
    const me = this.players[p];
    const opp = this.players[other(p)];
    return {
      ds: this.ds,
      level: me.botLevel ?? 'normal',
      own: me.muni!,
      oppPref: this.ds.munis[opp.muni!].p,
      revealed: this.history.map((h) => ({ topic: h.topic, value: h.values[other(p)] })),
      knownOpp: me.guessedOpp ? opp.muni : null,
      wrongGuesses: me.wrongGuesses,
    };
  }

  private scheduleBotRound(now: number) {
    this.players.forEach((pl, i) => {
      if (!pl.isBot) return;
      const p = i as Idx;
      const level = pl.botLevel ?? 'normal';
      const k = this.knowledge(p);
      const [lo, hi] = BOT_ANSWER_MS[level];
      const answerAt = now + between(this.rng, lo, hi);
      this.botTasks.push({ at: answerAt, player: p, msg: { type: 'answer', choice: decideChoice(k, this.topic!, this.rng) } });
      if (pl.nominationsLeft > 0) {
        const target = decideNomination(k, this.round, C.NOMINATIONS - pl.nominationsLeft, this.rng);
        if (target != null) {
          const at = now + between(this.rng, 800, Math.max(900, answerAt - now - 200));
          this.botTasks.push({ at, player: p, msg: { type: 'nominate_start' } });
          this.botTasks.push({ at: at + between(this.rng, 1500, 4000), player: p, msg: { type: 'nominate', code: this.ds.munis[target].c } });
        }
      }
    });
  }

  private handleAnswer(p: Idx, choice: Choice, now: number): string | null {
    if (this.phase !== 'answer') return '今は回答できません';
    const pl = this.players[p];
    if (pl.choice) return 'すでに回答しています';
    pl.choice = choice;
    if (this.players[0].choice && this.players[1].choice) this.resolveRound(now);
    return null;
  }

  private resolveRound(now: number) {
    const t = this.topic!;
    const values = this.players.map((pl) => this.ds.munis[pl.muni!].v[t] as number) as [number, number];
    const rec: RoundRec = { round: this.round, topic: t, values, choices: [null, null], correct: [null, null], deltas: [0, 0] };
    this.players.forEach((pl, i) => {
      const mine = values[i];
      const theirs = values[1 - i];
      rec.choices[i] = pl.choice;
      if (mine === theirs) {
        rec.correct[i] = null; // 同値はノーカウント・コンボ維持
        return;
      }
      const truth: Choice = mine > theirs ? 'high' : 'low';
      const ok = pl.choice === truth; // 時間切れ（null）は不正解
      rec.correct[i] = ok;
      const before = pl.score;
      if (ok) {
        pl.streak++;
        pl.score += Math.min(pl.streak, C.COMBO_CAP);
      } else {
        pl.streak = 0;
        pl.score = Math.max(0, pl.score - 1);
      }
      rec.deltas[i] = pl.score - before;
    });
    this.history.push(rec);
    this.dropBotTasks(['answer', 'nominate_start', 'nominate']);
    this.phase = 'result';
    this.deadline = now + C.RESULT_MS;
  }

  private afterResult(now: number) {
    const [a, b] = this.players;
    if (a.score >= C.WIN_SCORE || b.score >= C.WIN_SCORE) {
      if (a.score === b.score) this.enterSudden(now);
      else this.end(a.score > b.score ? 0 : 1, 'score');
      return;
    }
    if (this.round >= C.MAX_ROUNDS) {
      this.decideAfterRounds(now, false);
      return;
    }
    this.nextRound(now);
  }

  private decideAfterRounds(now: number, _noTopics: boolean) {
    const [a, b] = this.players;
    if (a.score === b.score) this.enterSudden(now);
    else this.end(a.score > b.score ? 0 : 1, 'rounds');
  }

  // ───────── 名指しカットイン ─────────

  private handleNominateStart(p: Idx, now: number): string | null {
    if (this.phase !== 'answer') return '今は名指しできません';
    const pl = this.players[p];
    if (pl.guessedOpp) return 'すでに当てています';
    if (pl.nominationsLeft <= 0) return '名指しの回数が残っていません';
    pl.nominationsLeft--;
    this.pausedRemaining = Math.max(0, (this.deadline ?? now) - now);
    this.pausedBotTasks = this.botTasks
      .filter((t) => t.msg.type === 'answer' || t.msg.type === 'nominate_start' || (t.msg.type === 'nominate' && t.player !== p))
      .map((t) => ({ remaining: Math.max(0, t.at - now), player: t.player, msg: t.msg }));
    this.dropBotTasks(['answer', 'nominate_start'], null);
    this.botTasks = this.botTasks.filter((t) => !(t.msg.type === 'nominate' && t.player !== p));
    this.nomination = { by: p, code: null, correct: null, cancelled: false };
    this.phase = 'nominate';
    this.deadline = now + C.NOMINATE_MS;
    return null;
  }

  private handleNominate(p: Idx, code: string, now: number): string | null {
    if (this.phase !== 'nominate' || !this.nomination || this.nomination.by !== p) return '今は名指しできません';
    const idx = this.codeIndex.get(code);
    const opp = this.players[other(p)];
    if (idx == null || this.ds.munis[idx].p !== this.ds.munis[opp.muni!].p) return '相手の都道府県の市区町村から選んでください';
    const pl = this.players[p];
    const correct = idx === opp.muni;
    this.nomination.code = idx;
    this.nomination.correct = correct;
    if (correct) {
      pl.score += C.NOMINATE_POINTS;
      pl.guessedOpp = true;
    } else {
      pl.score = Math.max(0, pl.score - C.NOMINATE_PENALTY);
      pl.wrongGuesses.push(idx);
    }
    this.phase = 'cutin';
    this.deadline = now + C.CUTIN_MS;
    return null;
  }

  private nominateTimeout(now: number) {
    if (this.nomination) this.nomination.cancelled = true;
    this.resumeRound(now);
  }

  private resumeRound(now: number) {
    this.phase = 'answer';
    this.deadline = now + (this.pausedRemaining ?? 0);
    this.pausedRemaining = null;
    for (const t of this.pausedBotTasks) this.botTasks.push({ at: now + t.remaining, player: t.player, msg: t.msg });
    this.pausedBotTasks = [];
    // 名指しの後に bot が当てていれば、答えを考え直す
    this.players.forEach((pl, i) => {
      if (!pl.isBot || pl.choice || !pl.guessedOpp) return;
      for (const t of this.botTasks) {
        if (t.player === i && t.msg.type === 'answer') t.msg = { type: 'answer', choice: decideChoice(this.knowledge(i as Idx), this.topic!, this.rng) };
      }
    });
  }

  // ───────── 早押し ─────────

  private enterSudden(now: number) {
    const [a, b] = this.players;
    const t = pickTopic(this.ds, a.muni!, b.muni!, this.usedTopics, this.lastCategory, this.rng, true);
    if (t == null) {
      // 理論上ほぼ起こらないが、出題できなければ先攻を乱数で決める
      this.end(this.rng() < 0.5 ? 0 : 1, 'sudden');
      return;
    }
    this.usedTopics.add(t);
    this.lastCategory = this.ds.indicators[t].category;
    this.topic = t;
    const showAt = now + C.SUDDEN_COUNTDOWN_MS;
    this.sudden = { topic: t, showAt, answerDeadline: showAt + C.SUDDEN_ANSWER_MS, graceDeadline: null, presses: [null, null], result: null };
    this.nomination = null;
    this.phase = 'sudden_countdown';
    this.deadline = showAt;
    this.players.forEach((pl, i) => {
      if (!pl.isBot) return;
      const [lo, hi] = BOT_REACTION_MS[pl.botLevel ?? 'normal'];
      const ms = Math.round(between(this.rng, lo, hi));
      const choice = decideChoice(this.knowledge(i as Idx), t, this.rng);
      this.botTasks.push({ at: showAt + ms, player: i as Idx, msg: { type: 'press', choice, reactionMs: ms } });
    });
  }

  private handlePress(p: Idx, choice: Choice, reactionMs: number, now: number, trusted: boolean): string | null {
    const s = this.sudden;
    if (!s || (this.phase !== 'sudden_answer' && this.phase !== 'sudden_countdown') || s.result) return '今は押せません';
    if (s.presses[p]) return 'すでに押しています';
    // スマホ側で測った秒数のうち、届いた時刻からみてありえない値は無効にする（改ざん対策）
    const maxPossible = now - s.showAt + C.CLOCK_SKEW_TOLERANCE_MS;
    const valid = trusted || (Number.isFinite(reactionMs) && reactionMs >= C.MIN_REACTION_MS && reactionMs <= maxPossible);
    s.presses[p] = { choice, reactionMs: Math.round(reactionMs), receivedAt: now, valid };
    if (valid && s.graceDeadline == null) s.graceDeadline = Math.min(now + C.SUDDEN_GRACE_MS, s.answerDeadline);
    if (s.presses[0] && s.presses[1]) this.resolveSudden(now);
    return null;
  }

  private resolveSudden(now: number) {
    const s = this.sudden!;
    const valid = ([0, 1] as Idx[]).filter((i) => s.presses[i]?.valid);
    if (valid.length === 0) {
      this.notice = 'どちらも押さなかったので、次のお題で仕切り直しです';
      this.dropBotTasks(['press']);
      this.enterSudden(now);
      return;
    }
    valid.sort((x, y) => {
      const a = s.presses[x]!;
      const b = s.presses[y]!;
      return a.reactionMs - b.reactionMs || a.receivedAt - b.receivedAt;
    });
    const adopted = valid[0];
    const press = s.presses[adopted]!;
    const mine = this.ds.munis[this.players[adopted].muni!].v[s.topic] as number;
    const theirs = this.ds.munis[this.players[other(adopted)].muni!].v[s.topic] as number;
    const correct = press.choice === (mine > theirs ? 'high' : 'low');
    s.result = { adopted, correct };
    this.dropBotTasks(['press']);
    this.phase = 'sudden_result';
    this.deadline = now + C.SUDDEN_RESULT_MS;
  }

  // ───────── 終了・再戦・切断 ─────────

  private end(winner: Idx, reason: 'score' | 'sudden' | 'forfeit' | 'rounds') {
    this.finish = { winner, reason };
    this.phase = 'finished';
    this.deadline = null;
    this.botTasks = [];
    this.players.forEach((pl) => {
      if (pl.isBot) pl.rematch = true;
    });
  }

  forfeit(p: Idx) {
    if (this.phase === 'finished') return;
    this.end(other(p), 'forfeit');
  }

  setConnected(p: Idx, connected: boolean) {
    this.players[p].connected = connected;
  }

  private handleRematch(p: Idx, now: number): string | null {
    if (this.phase !== 'finished') return '試合中です';
    if (this.finish?.reason === 'forfeit') return '相手が退出したため再戦できません';
    this.players[p].rematch = true;
    if (this.players[0].rematch && this.players[1].rematch) this.reset(now);
    return null;
  }

  private reset(now: number) {
    for (const pl of this.players) {
      Object.assign(pl, {
        muni: null, selectOptions: null, selected: false, score: 0, streak: 0, nominationsLeft: C.NOMINATIONS,
        guessedOpp: false, wrongGuesses: [], choice: null, rematch: false,
      });
    }
    Object.assign(this, {
      round: 0, topic: null, usedTopics: new Set(), lastCategory: null, history: [], nomination: null,
      sudden: null, finish: null, notice: null, botTasks: [], pausedBotTasks: [], pausedRemaining: null,
    });
    // 再戦では、相手の自治体がもう分かっているので選び直す
    this.enterSelect(now, null);
  }

  // ───────── 入力と時間の処理 ─────────

  handle(p: Idx, msg: ClientMessage, now: number, trusted = false): string | null {
    this.tick(now);
    const r = this.apply(p, msg, now, trusted);
    this.tick(now);
    return r;
  }

  private apply(p: Idx, msg: ClientMessage, now: number, trusted: boolean): string | null {
    switch (msg.type) {
      case 'select':
        return this.handleSelect(p, msg.code, now);
      case 'answer':
        return this.handleAnswer(p, msg.choice, now);
      case 'nominate_start':
        return this.handleNominateStart(p, now);
      case 'nominate':
        return this.handleNominate(p, msg.code, now);
      case 'press':
        return this.handlePress(p, msg.choice, msg.reactionMs, now, trusted);
      case 'rematch':
        return this.handleRematch(p, now);
      default:
        return null;
    }
  }

  private dropBotTasks(types: ClientMessage['type'][], player: Idx | null = null) {
    this.botTasks = this.botTasks.filter((t) => !(types.includes(t.msg.type) && (player == null || t.player === player)));
  }

  private effectiveDeadline(): number | null {
    if ((this.phase === 'sudden_answer' || this.phase === 'sudden_countdown') && this.sudden?.graceDeadline != null) {
      return Math.min(this.sudden.graceDeadline, this.deadline ?? Infinity);
    }
    return this.deadline;
  }

  /** 次に何かが起きる時刻（サーバーのタイマー用） */
  nextWake(): number | null {
    const times = this.botTasks.map((t) => t.at);
    const d = this.effectiveDeadline();
    if (d != null) times.push(d);
    return times.length ? Math.min(...times) : null;
  }

  tick(now: number) {
    for (let guard = 0; guard < 100; guard++) {
      this.botTasks.sort((a, b) => a.at - b.at);
      const d = this.effectiveDeadline();
      const task = this.botTasks[0];
      if (task && task.at <= now && (d == null || task.at <= d)) {
        this.botTasks.shift();
        this.apply(task.player, task.msg, task.at, true);
        continue;
      }
      if (d != null && d <= now) {
        this.onDeadline(d);
        continue;
      }
      return;
    }
  }

  private onDeadline(at: number) {
    switch (this.phase) {
      case 'select':
        return this.selectTimeout(at);
      case 'intro':
        return this.nextRound(at);
      case 'answer':
        return this.resolveRound(at);
      case 'nominate':
        return this.nominateTimeout(at);
      case 'cutin':
        return this.resumeRound(at);
      case 'result':
        return this.afterResult(at);
      case 'sudden_countdown': {
        const s = this.sudden!;
        if (s.graceDeadline != null && s.graceDeadline <= at) return this.finishSuddenPresses(at);
        this.phase = 'sudden_answer';
        this.deadline = s.answerDeadline;
        return;
      }
      case 'sudden_answer':
        return this.finishSuddenPresses(at);
      case 'sudden_result': {
        const s = this.sudden!;
        const r = s.result!;
        return this.end(r.correct ? r.adopted : other(r.adopted), 'sudden');
      }
      default:
        this.deadline = null;
    }
  }

  private finishSuddenPresses(at: number) {
    const s = this.sudden!;
    s.presses = s.presses.map((x) => x ?? { choice: 'high', reactionMs: Infinity, receivedAt: at, valid: false }) as [Press, Press];
    this.resolveSudden(at);
  }

  // ───────── 画面に送る情報 ─────────

  private info(idx: number): MuniInfo {
    const m = this.ds.munis[idx];
    return { code: m.c, name: m.n, pref: m.p, kind: m.k };
  }

  private topicView(t: number, p: Idx): TopicView {
    const ind = this.ds.indicators[t];
    return { id: ind.id, name: ind.name, unit: ind.unit, year: ind.year, category: ind.category, myValue: this.ds.munis[this.players[p].muni!].v[t] as number };
  }

  viewFor(p: Idx, now: number): PlayerView {
    const me = this.players[p];
    const op = this.players[other(p)];
    const o = other(p);
    const revealOpp = me.guessedOpp || this.phase === 'finished';
    const history: HistoryEntry[] = this.history.map((h) => ({
      round: h.round,
      topic: this.topicView(h.topic, p),
      oppValue: h.values[o],
      myChoice: h.choices[p],
      oppChoice: h.choices[o],
      myCorrect: h.correct[p],
      oppCorrect: h.correct[o],
      myDelta: h.deltas[p],
      oppDelta: h.deltas[o],
    }));
    const inRound = this.phase === 'answer' || this.phase === 'nominate' || this.phase === 'cutin' || this.phase === 'result';
    const nom = this.nomination;
    const s = this.sudden;
    const view: PlayerView = {
      phase: this.phase,
      serverNow: now,
      deadline: this.effectiveDeadline(),
      pausedRemainingMs: this.pausedRemaining,
      round: this.round,
      maxRounds: C.MAX_ROUNDS,
      mode: this.mode,
      notice: this.notice,
      me: {
        name: me.name,
        muni: me.muni != null ? this.info(me.muni) : null,
        score: me.score,
        streak: me.streak,
        nominationsLeft: me.nominationsLeft,
        choice: me.choice,
        guessedOpp: me.guessedOpp,
        wrongGuesses: me.wrongGuesses.map((i) => this.ds.munis[i].n),
      },
      opp: {
        name: op.name,
        isBot: op.isBot,
        botLevel: op.botLevel,
        pref: op.muni != null ? this.ds.munis[op.muni].p : null,
        muni: revealOpp && op.muni != null ? this.info(op.muni) : null,
        score: op.score,
        streak: op.streak,
        nominationsLeft: op.nominationsLeft,
        answered: !!op.choice,
        guessedMe: op.guessedOpp,
        connected: op.connected,
      },
      topic: inRound && this.topic != null ? this.topicView(this.topic, p) : null,
      history,
      nomination: nom && (this.phase === 'nominate' || this.phase === 'cutin' || (this.phase === 'answer' && nom.cancelled))
        ? {
            by: nom.by === p ? 'me' : 'opp',
            muniName: nom.code != null ? this.ds.munis[nom.code].n : '',
            correct: nom.correct,
            cancelled: nom.cancelled,
            deadline: this.phase === 'nominate' ? this.deadline ?? undefined : undefined,
          }
        : null,
      sudden: s && (this.phase === 'sudden_countdown' || this.phase === 'sudden_answer' || this.phase === 'sudden_result')
        ? {
            topic: this.topicView(s.topic, p),
            showAt: s.showAt,
            pressed: !!s.presses[p],
            result: s.result
              ? {
                  adopted: s.result.adopted === p ? 'me' : 'opp',
                  choice: s.presses[s.result.adopted]!.choice,
                  correct: s.result.correct,
                  myMs: s.presses[p]?.valid ? s.presses[p]!.reactionMs : null,
                  oppMs: s.presses[o]?.valid ? s.presses[o]!.reactionMs : null,
                  oppValue: this.ds.munis[op.muni!].v[s.topic] as number,
                }
              : undefined,
          }
        : null,
    };
    if (this.phase === 'select') {
      view.select = {
        options: me.selectOptions ? me.selectOptions.map((i) => this.info(i)) : null,
        chosen: me.selected,
        oppChosen: op.selected,
      };
    }
    if (this.phase === 'finished' && this.finish && me.muni != null && op.muni != null) {
      view.finish = {
        winner: this.finish.winner === p ? 'me' : 'opp',
        reason: this.finish.reason,
        myMuni: this.info(me.muni),
        oppMuni: this.info(op.muni),
        rematch: { me: me.rematch, opp: op.rematch },
      };
    }
    return view;
  }
}
