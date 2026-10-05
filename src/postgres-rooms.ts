import { Prisma, PrismaClient, type GameRoom } from '@prisma/client';
import type { Room } from './online-games.js';
import type { RoomRepository } from './room-repository.js';
import { LocalGameError } from './local-games.js';

function encode(room: Room) {
  return {
    id: room.id, code: room.code, revision: room.revision,
    payload: JSON.parse(JSON.stringify({
      state: room.state, lastAction: room.lastAction, lastPlayed: room.lastPlayed,
    })) as Prisma.InputJsonValue,
    tokenHashes: room.tokens, updatedAt: new Date(room.updated),
    expiresAt: new Date(room.updated + 86400000),
  };
}
function decode(row: GameRoom | null): Room | null {
  if (!row) return null;
  const payload = row.payload as unknown as Pick<Room, 'state' | 'lastAction' | 'lastPlayed'>;
  return { id: row.id, code: row.code, revision: row.revision, tokens: row.tokenHashes,
    updated: row.updatedAt.getTime(), ...payload };
}
async function databaseCall<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch { throw new LocalGameError(503, 'Room storage is unavailable. Try again shortly.'); }
}

// Reused across requests in this instance; never disconnect after each invocation.
let client: PrismaClient | undefined;
function sharedClient() {
  const url = process.env.DATABASE_URL?.trim();
  return client ??= new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}
export function createPostgresRoomRepository(database = sharedClient()): RoomRepository {
  return {
    insert: room => databaseCall(async () => {
      try { await database.gameRoom.create({ data: encode(room) }); return true; }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
        throw error;
      }
    }),
    findById: id => databaseCall(async () => {
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
      return decode(await database.gameRoom.findUnique({ where: { id } }));
    }),
    findByCode: code => databaseCall(async () => decode(await database.gameRoom.findUnique({ where: { code } }))),
    save: (room, expectedRevision, now) => databaseCall(async () => {
      const result = await database.gameRoom.updateMany({
        where: { id: room.id, revision: expectedRevision, expiresAt: { gt: new Date(now) } },
        data: encode(room),
      });
      return result.count === 1;
    }),
    deleteExpired: now => databaseCall(async () => {
      await database.gameRoom.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
    }),
  };
}
