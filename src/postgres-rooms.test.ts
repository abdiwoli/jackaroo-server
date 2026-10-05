import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPersistentOnlineGameStore, hashRoomToken } from './persistent-online-games.js';

// Run against a migrated, disposable database using TEST_DATABASE_URL.
test('PostgreSQL preserves rooms across clients and atomically rejects competing joins and moves', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { createPostgresRoomRepository } = await import('./postgres-rooms.js');
  const options = { datasources: { db: { url: process.env.TEST_DATABASE_URL! } } };
  const first = new PrismaClient(options);
  const second = new PrismaClient(options);
  const third = new PrismaClient(options);
  let roomId: string | undefined;
  try {
    const a = createPersistentOnlineGameStore(createPostgresRoomRepository(first));
    const b = createPersistentOnlineGameStore(createPostgresRoomRepository(second));
    const host = await a.create(); roomId = host.game.id;
    const joins = await Promise.allSettled([a.join(host.game.roomCode), b.join(host.game.roomCode)]);
    assert.equal(joins.filter(result => result.status === 'fulfilled').length, 1);
    const guest = joins.find(result => result.status === 'fulfilled');
    assert.ok(guest && guest.status === 'fulfilled');
    // A newly created client must restore the same seats/state from the database.
    const restored = createPersistentOnlineGameStore(createPostgresRoomRepository(third));
    const view = await restored.get(roomId, host.token);
    assert.equal(view.joinedPlayers, 2);
    const guestView = await restored.get(roomId, guest.value.token);
    assert.ok(view.hand.every(card => !guestView.hand.some(other => other.id === card.id)));
    const row = await third.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    assert.deepEqual(row.tokenHashes, [hashRoomToken(host.token), hashRoomToken(guest.value.token)]);
    const choice = view.legalActions[0]!;
    const moves = await Promise.allSettled([
      a.act(roomId, host.token, view.revision, choice.action),
      b.act(roomId, host.token, view.revision, choice.action),
    ]);
    assert.equal(moves.filter(result => result.status === 'fulfilled').length, 1);
    const after = await restored.get(roomId, host.token);
    assert.equal(after.revision, view.revision + 1);
    assert.deepEqual(after.lastAction, choice);
    await third.gameRoom.update({ where: { id: roomId }, data: {
      updatedAt: new Date(Date.now() - 86400001), expiresAt: new Date(Date.now() - 1),
    } });
    await assert.rejects(restored.get(roomId, host.token), /expired/);
    assert.equal(await createPostgresRoomRepository(first).save({
      id: roomId, code: row.code, revision: after.revision + 1,
      state: (await createPostgresRoomRepository(third).findById(roomId))!.state,
      tokens: row.tokenHashes, updated: Date.now(), lastAction: null, lastPlayed: null,
    }, after.revision, Date.now()), false);
  } finally {
    try { if (roomId) await third.gameRoom.deleteMany({ where: { id: roomId } }); }
    finally { await Promise.all([first.$disconnect(), second.$disconnect(), third.$disconnect()]); }
  }
});
