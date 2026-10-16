import { DurableObject } from 'cloudflare:workers';
import { INVITE_TTL_MS, RECONNECT_MS } from '../shared/constants';
import type { ClientMessage, Mode, ServerMessage } from '../shared/types';
import { dataset } from '../server/dataset';
import { Match, type PlayerInit } from '../server/engine';
import type { Env } from './env';

export interface RoomInit {
  kind: 'match' | 'invite';
  mode: Mode;
  players: PlayerInit[];
}

type Idx = 0 | 1;

/** 1試合 = 1部屋。状態はメモリに持ち、判定はすべてここで行う */
export class Room extends DurableObject<Env> {
  private init: RoomInit | null = null;
  private tokens: string[] = [];
  private match: Match | null = null;
  private sockets: [Set<WebSocket>, Set<WebSocket>] = [new Set(), new Set()];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private forfeitTimers: (ReturnType<typeof setTimeout> | null)[] = [null, null];
  private createdAt = 0;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init') return this.handleInit(await req.json());
    if (url.pathname === '/join') return this.handleJoin(await req.json());
    if (url.pathname === '/ws') return this.handleSocket(req, url.searchParams.get('token') ?? '');
    return new Response('not found', { status: 404 });
  }

  private handleInit(init: RoomInit): Response {
    if (this.init) return Response.json({ error: 'already initialized' }, { status: 409 });
    this.init = init;
    this.createdAt = Date.now();
    this.tokens = init.players.map((p) => (p.isBot ? '' : crypto.randomUUID()));
    if (init.players.length === 2) this.startMatch();
    return Response.json({ tokens: this.tokens });
  }

  private handleJoin(body: { name: string; muniCode?: string | null }): Response {
    if (!this.init || this.init.kind !== 'invite') return Response.json({ error: 'この招待URLは使えません' }, { status: 404 });
    if (this.init.players.length >= 2) return Response.json({ error: 'この部屋はもう満員です' }, { status: 409 });
    if (Date.now() - this.createdAt > INVITE_TTL_MS) return Response.json({ error: '招待URLの有効期限（30分）が切れています' }, { status: 410 });
    this.init.players.push({ name: body.name, muniCode: body.muniCode ?? null });
    const token = crypto.randomUUID();
    this.tokens.push(token);
    this.startMatch();
    return Response.json({ token });
  }

  private startMatch() {
    const init = this.init!;
    this.match = new Match(dataset, init.mode, [init.players[0], init.players[1]], Math.random);
    this.match.start(Date.now());
    this.broadcast();
  }

  private handleSocket(req: Request, token: string): Response {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const idx = token ? this.tokens.indexOf(token) : -1;
    if (idx < 0) return new Response('invalid token', { status: 403 });
    const p = idx as Idx;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.sockets[p].add(server);
    if (this.forfeitTimers[p]) {
      clearTimeout(this.forfeitTimers[p]!);
      this.forfeitTimers[p] = null;
    }
    this.match?.setConnected(p, true);
    server.addEventListener('message', (ev) => this.onMessage(p, server, ev.data));
    const onGone = () => this.onClose(p, server);
    server.addEventListener('close', onGone);
    server.addEventListener('error', onGone);
    if (this.match) this.broadcast();
    else this.send(server, { type: 'waiting', text: '招待した相手が来るのを待っています' });
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(p: Idx, ws: WebSocket, data: string | ArrayBuffer) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong', t: msg.t, serverNow: Date.now() });
      return;
    }
    if (!this.match) return;
    const err = this.match.handle(p, msg, Date.now());
    if (err) this.send(ws, { type: 'error', text: err });
    this.broadcast();
  }

  private onClose(p: Idx, ws: WebSocket) {
    if (!this.sockets[p].delete(ws) || this.sockets[p].size > 0) return;
    if (!this.match) return;
    this.match.setConnected(p, false);
    this.broadcast();
    if (this.match.phase === 'finished') return;
    // 30秒以内に戻らなければ不戦敗
    this.forfeitTimers[p] = setTimeout(() => {
      this.forfeitTimers[p] = null;
      if (this.sockets[p].size === 0 && this.match) {
        this.match.forfeit(p);
        this.broadcast();
      }
    }, RECONNECT_MS);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 切断済み */
    }
  }

  private broadcast() {
    const m = this.match;
    if (!m) return;
    const now = Date.now();
    m.tick(now);
    ([0, 1] as Idx[]).forEach((p) => {
      if (this.sockets[p].size === 0) return;
      const msg: ServerMessage = { type: 'state', view: m.viewFor(p, now) };
      for (const ws of this.sockets[p]) this.send(ws, msg);
    });
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const wake = this.match?.nextWake();
    if (wake == null) return;
    this.timer = setTimeout(() => this.broadcast(), Math.max(0, wake - Date.now()) + 5);
  }
}
