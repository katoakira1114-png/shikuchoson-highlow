import { DurableObject } from 'cloudflare:workers';
import { MATCH_WAIT_MS } from '../shared/constants';
import type { Mode, ServerMessage } from '../shared/types';
import type { Env } from './env';
import { createRoom } from './rooms';

interface Waiting {
  ws: WebSocket;
  mode: Mode;
  name: string;
  muni: string | null;
  timer: ReturnType<typeof setTimeout>;
  done: boolean;
}

/** ランダムマッチの待ち列（全国で1つ） */
export class Matchmaker extends DurableObject<Env> {
  private queue: Waiting[] = [];

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const url = new URL(req.url);
    const mode: Mode = url.searchParams.get('mode') === 'draft' ? 'draft' : 'free';
    const name = (url.searchParams.get('name') ?? '').slice(0, 12) || 'ななし';
    const muni = mode === 'free' ? url.searchParams.get('muni') : null;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    const me: Waiting = { ws: server, mode, name, muni, done: false, timer: setTimeout(() => this.fallbackToBot(me), MATCH_WAIT_MS) };
    const leave = () => {
      clearTimeout(me.timer);
      me.done = true;
      this.queue = this.queue.filter((w) => w !== me);
    };
    server.addEventListener('close', leave);
    server.addEventListener('error', leave);

    // 同じモードで、違う自治体の人を探す
    const partner = this.queue.find((w) => !w.done && w.mode === mode && (mode === 'draft' || w.muni !== muni));
    if (partner) {
      this.queue = this.queue.filter((w) => w !== partner);
      clearTimeout(partner.timer);
      clearTimeout(me.timer);
      partner.done = me.done = true;
      void this.pair(partner, me);
    } else {
      this.queue.push(me);
      this.send(server, { type: 'waiting', text: '対戦相手を探しています' });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private async pair(a: Waiting, b: Waiting) {
    const { roomId, tokens } = await createRoom(this.env, {
      kind: 'match',
      mode: a.mode,
      players: [{ name: a.name, muniCode: a.muni }, { name: b.name, muniCode: b.muni }],
    });
    this.send(a.ws, { type: 'matched', roomId, token: tokens[0] });
    this.send(b.ws, { type: 'matched', roomId, token: tokens[1] });
  }

  private async fallbackToBot(w: Waiting) {
    if (w.done) return;
    w.done = true;
    this.queue = this.queue.filter((x) => x !== w);
    this.send(w.ws, { type: 'waiting', text: '相手が見つからなかったので bot と対戦します' });
    const { roomId, tokens } = await createRoom(this.env, {
      kind: 'match',
      mode: w.mode,
      players: [{ name: w.name, muniCode: w.muni }, { name: 'bot（普通）', isBot: true, botLevel: 'normal' }],
    });
    this.send(w.ws, { type: 'matched', roomId, token: tokens[0] });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 切断済み */
    }
  }
}
