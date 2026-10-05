import { createOnlineGameStore } from './online-games.js';
import { createPersistentOnlineGameStore } from './persistent-online-games.js';
import { LocalGameError } from './local-games.js';

type MemoryStore = ReturnType<typeof createOnlineGameStore>;
type PersistentStore = ReturnType<typeof createPersistentOnlineGameStore>;
export type OnlineGameStore = {
  [K in keyof MemoryStore]: (...args: Parameters<MemoryStore[K]>) =>
    ReturnType<MemoryStore[K]> | Promise<ReturnType<MemoryStore[K]>>;
};

export function createConfiguredOnlineGameStore(): OnlineGameStore {
  const storage = (process.env.ROOM_STORAGE ?? 'memory').trim();
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  if (storage === 'memory') return createOnlineGameStore();
  // Lazy initialization keeps /health independent of database availability.
  let store: Promise<PersistentStore> | undefined;
  function load() {
    if (storage !== 'postgres' || !databaseConfigured)
      throw new LocalGameError(503, 'Room storage is not configured.');
    return store ??= import('./postgres-rooms.js').then(module =>
      createPersistentOnlineGameStore(module.createPostgresRoomRepository())).catch(() => {
        store = undefined;
        throw new LocalGameError(503, 'Room storage is unavailable. Try again shortly.');
      });
  }
  return {
    create: async () => (await load()).create(),
    join: async code => (await load()).join(code),
    get: async (id, token) => (await load()).get(id, token),
    act: async (id, token, revision, action) => (await load()).act(id, token, revision, action),
  };
}
