import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createGame, startGame } from './jackaroo/engine.js';
import { LocalGameError } from './local-games.js';
import { advanceRoom, authenticate, roomView, type Room } from './online-games.js';
import type { RoomRepository } from './room-repository.js';

const ttl = 24 * 60 * 60 * 1000;
export const hashRoomToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createPersistentOnlineGameStore(repository: RoomRepository) {
  function active(room: Room | null): Room {
    if (!room || Date.now() - room.updated >= ttl)
      throw new LocalGameError(404, 'Room expired or not found. Create a new room.');
    return room;
  }
  async function commit(room: Room, revision: number) {
    if (!await repository.save(room, revision, Date.now()))
      throw new LocalGameError(409, 'Board changed or room expired. Refresh your game.');
  }
  return {
    async create() {
      await repository.deleteExpired(Date.now());
      for (let attempt = 0; attempt < 5; attempt++) {
        const token = randomBytes(32).toString('hex');
        const room: Room = {
          id: randomUUID(), code: randomBytes(4).toString('hex').toUpperCase(), revision: 0,
          state: createGame([randomUUID(), randomUUID()]), tokens: [hashRoomToken(token)],
          updated: Date.now(), lastAction: null, lastPlayed: null,
        };
        if (await repository.insert(room)) return { token, game: roomView(room, 0) };
      }
      throw new LocalGameError(503, 'Could not allocate a room. Try again.');
    },
    async join(code: unknown) {
      if (typeof code !== 'string' || !/^[A-F0-9]{8}$/.test(code.trim().toUpperCase()))
        throw new LocalGameError(400, 'Enter the 8-character room code.');
      const room = active(await repository.findByCode(code.trim().toUpperCase()));
      if (room.tokens.length === 2) throw new LocalGameError(409, 'This room already has two players.');
      const revision = room.revision;
      const token = randomBytes(32).toString('hex');
      const state = startGame(room.state);
      room.tokens.push(hashRoomToken(token));
      room.state = state; room.revision++; room.updated = Date.now();
      await commit(room, revision);
      return { token, game: roomView(room, 1) };
    },
    async get(id: string, token: string) {
      const room = active(await repository.findById(id));
      return roomView(room, authenticate(room, hashRoomToken(token)));
    },
    async act(id: string, token: string, revision: unknown, action: unknown) {
      const room = active(await repository.findById(id));
      const previousRevision = room.revision;
      const result = advanceRoom(room, hashRoomToken(token), revision, action);
      await commit(room, previousRevision);
      return result;
    },
  };
}
