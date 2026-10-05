import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { Room } from './online-games.js';
import type { RoomRepository } from './room-repository.js';
import { createPersistentOnlineGameStore, hashRoomToken } from './persistent-online-games.js';
import { createRequestHandler } from './app.js';
import { createConfiguredOnlineGameStore } from './room-storage.js';

// Shared backing data models independent server instances, detached reads, and CAS.
function repositoryFixture() {
  const rows = new Map<string, Room>();
  const repository: RoomRepository = {
    async insert(room) {
      if ([...rows.values()].some(row => row.code === room.code)) return false;
      rows.set(room.id, structuredClone(room)); return true;
    },
    async findById(id) { return structuredClone(rows.get(id) ?? null); },
    async findByCode(code) {
      return structuredClone([...rows.values()].find(row => row.code === code) ?? null);
    },
    async save(room, revision, now) {
      const row = rows.get(room.id);
      if (!row || row.revision !== revision || row.updated + 86400000 <= now) return false;
      rows.set(room.id, structuredClone(room)); return true;
    },
    async deleteExpired(now) {
      for (const [id, room] of rows) if (room.updated + 86400000 <= now) rows.delete(id);
    },
  };
  return { rows, repository };
}

test('persistent rooms survive store recreation, keep hands private and store only token hashes', async () => {
  const { repository, rows } = repositoryFixture();
  const first = createPersistentOnlineGameStore(repository);
  const host = await first.create();
  const second = createPersistentOnlineGameStore(repository);
  const guest = await second.join(host.game.roomCode.toLowerCase());
  const restored = createPersistentOnlineGameStore(repository);
  const a = await restored.get(host.game.id, host.token);
  const b = await first.get(host.game.id, guest.token);
  assert.equal(a.status, 'playing');
  assert.equal(a.joinedPlayers, 2);
  assert.notEqual(a.viewerPlayerId, b.viewerPlayerId);
  assert.ok(a.hand.every(card => !b.hand.some(other => other.id === card.id)));
  assert.deepEqual(rows.get(host.game.id)!.tokens, [hashRoomToken(host.token), hashRoomToken(guest.token)]);
  assert.ok(!JSON.stringify([...rows.values()]).includes(host.token));
  await assert.rejects(restored.get(host.game.id, ''), /session/);
  assert.ok(!JSON.stringify(b).includes(hashRoomToken(host.token)));
});

test('concurrent joins commit one seat and concurrent moves commit one revision', async () => {
  const { repository } = repositoryFixture();
  const a = createPersistentOnlineGameStore(repository);
  const b = createPersistentOnlineGameStore(repository);
  const host = await a.create();
  const joins = await Promise.allSettled([a.join(host.game.roomCode), b.join(host.game.roomCode)]);
  assert.equal(joins.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(joins.filter(result => result.status === 'rejected').length, 1);
  const before = await a.get(host.game.id, host.token);
  const choice = before.legalActions[0]!;
  const results = await Promise.allSettled([
    a.act(host.game.id, host.token, before.revision, choice.action),
    b.act(host.game.id, host.token, before.revision, choice.action),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const after = await b.get(host.game.id, host.token);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.lastAction, choice);
});

test('invalid actions and expired rooms never overwrite persisted state', async () => {
  const { repository, rows } = repositoryFixture();
  const store = createPersistentOnlineGameStore(repository);
  const host = await store.create();
  const guest = await store.join(host.game.roomCode);
  const before = await store.get(host.game.id, host.token);
  await assert.rejects(store.act(host.game.id, guest.token, before.revision, before.legalActions[0]!.action), /turn/);
  await assert.rejects(store.act(host.game.id, host.token, before.revision, null), /Invalid/);
  assert.deepEqual(await store.get(host.game.id, host.token), before);
  const expired = rows.get(host.game.id)!;
  expired.updated = Date.now() - 86400001;
  await assert.rejects(store.get(host.game.id, host.token), /expired/);
  await assert.rejects(store.join(host.game.roomCode), /expired/);
  await store.create();
  assert.equal(rows.has(host.game.id), false);
});

test('failed database commit returns no successful move and does not change stored state', async () => {
  const { repository } = repositoryFixture();
  const store = createPersistentOnlineGameStore(repository);
  const host = await store.create();
  await store.join(host.game.roomCode);
  const before = await store.get(host.game.id, host.token);
  repository.save = async () => { throw new Error('database offline'); };
  await assert.rejects(store.act(host.game.id, host.token, before.revision, before.legalActions[0]!.action), /offline/);
  assert.deepEqual(await store.get(host.game.id, host.token), before);
});

test('HTTP awaits persistent responses and health stays available when storage is unconfigured', async () => {
  const previousMode = process.env.ROOM_STORAGE;
  const previousUrl = process.env.DATABASE_URL;
  process.env.ROOM_STORAGE = 'postgres';
  delete process.env.DATABASE_URL;
  const unconfigured = createConfiguredOnlineGameStore();
  if (previousMode === undefined) delete process.env.ROOM_STORAGE; else process.env.ROOM_STORAGE = previousMode;
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  const fixture = repositoryFixture();
  for (const [store, expected] of [
    [createPersistentOnlineGameStore(fixture.repository), 201], [unconfigured, 503],
  ] as const) {
    const server = createServer(createRequestHandler(store));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}`;
      assert.equal((await fetch(`${url}/health`)).status, 200);
      const response = await fetch(`${url}/online-games`, { method: 'POST' });
      assert.equal(response.status, expected);
      const body = await response.json() as { token?: string; game?: { status: string } };
      if (expected === 201) { assert.ok(body.token); assert.equal(body.game?.status, 'created'); }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
