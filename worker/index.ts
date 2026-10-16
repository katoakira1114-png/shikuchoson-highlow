import type { BotLevel, Mode } from '../shared/types';
import { meta, muniList } from '../server/dataset';
import type { Env } from './env';
import { createRoom, roomStub } from './rooms';

export { Room } from './room';
export { Matchmaker } from './matchmaker';

const LEVEL_NAME: Record<BotLevel, string> = { weak: '弱い', normal: '普通', strong: '強い' };
const ROOM_ID = /^[0-9a-f]{12}$/;

function cleanName(v: unknown): string {
  return (typeof v === 'string' ? v.trim().slice(0, 12) : '') || 'ななし';
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/api/munis') return Response.json(muniList, { headers: { 'cache-control': 'public, max-age=3600' } });
    if (path === '/api/meta') return Response.json(meta);

    if (path === '/api/queue') {
      return env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).fetch(req);
    }

    if (path === '/api/bot' && req.method === 'POST') {
      const b = (await req.json()) as { mode: Mode; level: BotLevel; name: string; muni?: string };
      const level: BotLevel = ['weak', 'normal', 'strong'].includes(b.level) ? b.level : 'normal';
      const mode: Mode = b.mode === 'draft' ? 'draft' : 'free';
      const { roomId, tokens } = await createRoom(env, {
        kind: 'match',
        mode,
        players: [{ name: cleanName(b.name), muniCode: b.muni ?? null }, { name: `bot（${LEVEL_NAME[level]}）`, isBot: true, botLevel: level }],
      });
      return Response.json({ roomId, token: tokens[0] });
    }

    if (path === '/api/invite' && req.method === 'POST') {
      const b = (await req.json()) as { mode: Mode; name: string; muni?: string };
      const mode: Mode = b.mode === 'draft' ? 'draft' : 'free';
      const { roomId, tokens } = await createRoom(env, { kind: 'invite', mode, players: [{ name: cleanName(b.name), muniCode: b.muni ?? null }] });
      return Response.json({ roomId, token: tokens[0], inviteUrl: `${url.origin}/?room=${roomId}&mode=${mode}` });
    }

    const join = path.match(/^\/api\/invite\/([0-9a-f]+)\/join$/);
    if (join && req.method === 'POST' && ROOM_ID.test(join[1])) {
      const b = (await req.json()) as { name: string; muni?: string };
      return roomStub(env, join[1]).fetch('https://room/join', { method: 'POST', body: JSON.stringify({ name: cleanName(b.name), muniCode: b.muni ?? null }) });
    }

    const ws = path.match(/^\/api\/room\/([0-9a-f]+)\/ws$/);
    if (ws && ROOM_ID.test(ws[1])) {
      return roomStub(env, ws[1]).fetch(new Request(`https://room/ws?token=${encodeURIComponent(url.searchParams.get('token') ?? '')}`, req));
    }

    if (path.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
