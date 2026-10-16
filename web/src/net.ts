import type { ClientMessage, MuniInfo, ServerMessage } from '../../shared/types';

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

let muniCache: Promise<MuniInfo[]> | null = null;
export function loadMunis(): Promise<MuniInfo[]> {
  muniCache ??= fetch('/api/meta', { cache: 'no-store' })
    .then((r) => r.json() as Promise<{ version: string }>)
    .then((m) => fetch(`/api/munis?v=${encodeURIComponent(m.version)}`))
    .then((r) => r.json() as Promise<MuniInfo[]>);
  return muniCache;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? '通信に失敗しました');
  return json as T;
}

/**
 * 部屋への接続。切れたら自動でつなぎ直し、ping でサーバーとの時計のずれを測る。
 */
export class RoomConnection {
  private ws: WebSocket | null = null;
  private closed = false;
  private pingTimer: number | undefined;
  private bestRtt = Infinity;
  /** サーバー時刻 = Date.now() + offset */
  offset = 0;

  constructor(
    private roomId: string,
    private token: string,
    private onMessage: (m: ServerMessage) => void,
    private onStatus: (connected: boolean) => void,
  ) {
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(wsUrl(`/api/room/${this.roomId}/ws?token=${encodeURIComponent(this.token)}`));
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus(true);
      this.ping();
      this.pingTimer = window.setInterval(() => this.ping(), 4000);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === 'pong') {
        const now = Date.now();
        const rtt = now - msg.t;
        if (rtt <= this.bestRtt * 1.5) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = msg.serverNow - (msg.t + rtt / 2);
        }
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.onStatus(false);
      if (!this.closed) setTimeout(() => this.connect(), 1500);
    };
  }

  private ping() {
    this.send({ type: 'ping', t: Date.now() });
  }

  serverNow(): number {
    return Date.now() + this.offset;
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

export function fmt(n: number): string {
  return n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}
