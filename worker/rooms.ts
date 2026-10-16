import type { Env } from './env';
import type { RoomInit } from './room';

export async function createRoom(env: Env, init: RoomInit): Promise<{ roomId: string; tokens: string[] }> {
  const roomId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
  const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify(init) });
  const { tokens } = (await res.json()) as { tokens: string[] };
  return { roomId, tokens };
}

export function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}
