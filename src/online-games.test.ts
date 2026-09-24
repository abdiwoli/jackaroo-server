import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.js';
import { createOnlineGameStore } from './online-games.js';

test('online rooms isolate seats, hands and actions and reject stale/unauthorized requests', () => {
  const store = createOnlineGameStore();
  const host = store.create();
  assert.equal(host.game.status, 'created');
  assert.deepEqual(host.game.hand, []);
  assert.throws(() => store.get(host.game.id, ''), /session/);
  const guest = store.join(host.game.roomCode.toLowerCase());
  assert.notEqual(host.token, guest.token);
  assert.notEqual(host.game.viewerPlayerId, guest.game.viewerPlayerId);
  assert.throws(() => store.join(host.game.roomCode), /two players/);
  const a = store.get(host.game.id, host.token);
  const b = store.get(host.game.id, guest.token);
  assert.equal(a.status, 'playing');
  assert.ok(a.hand.length > 0 && b.hand.length > 0);
  assert.ok(a.hand.every(card => !b.hand.some(other => other.id === card.id)));
  assert.ok(a.players.every(player => !('hand' in player)));
  const active = a.currentPlayerId === a.viewerPlayerId ? host : guest;
  const waiting = active === host ? guest : host;
  const before = store.get(host.game.id, active.token);
  assert.equal(store.get(host.game.id, waiting.token).legalActions.length, 0);
  const choice = before.legalActions[0]!;
  assert.throws(() => store.act(host.game.id, waiting.token, before.revision, choice.action), /turn/);
  assert.deepEqual(store.get(host.game.id, active.token), before);
  const after = store.act(host.game.id, active.token, before.revision, choice.action);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.lastAction, choice);
  assert.throws(() => store.act(host.game.id, active.token, before.revision, choice.action), /changed/);
  const other = store.get(host.game.id, waiting.token);
  assert.deepEqual(other.players, after.players);
  assert.deepEqual(other.lastPlayed, after.lastPlayed);
  assert.ok(!JSON.stringify(other).includes(active.token));
  const separate = store.create();
  assert.throws(() => store.get(separate.game.id, active.token), /session/);
  other.players[0]!.marbles.length = 0;
  assert.equal(store.get(host.game.id, waiting.token).players[0]!.marbles.length, 4);
});

test('online HTTP endpoints support two authenticated devices and block local endpoint access', async () => {
  const server = createApp();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const create = await fetch(`${base}/online-games`, { method: 'POST' });
    assert.equal(create.status, 201);
    const host = await create.json() as ReturnType<ReturnType<typeof createOnlineGameStore>['create']>;
    const join = await fetch(`${base}/online-games/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: host.game.roomCode }) });
    assert.equal(join.status, 200);
    assert.equal((await fetch(`${base}/online-games/${host.game.id}`)).status, 401);
    assert.equal((await fetch(`${base}/local-games/${host.game.id}`)).status, 404);
    const response = await fetch(`${base}/online-games/${host.game.id}`, { headers: { Authorization: `Bearer ${host.token}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { joinedPlayers: number }).joinedPlayers, 2);
    const preflight = await fetch(`${base}/online-games/${host.game.id}`, { method: 'OPTIONS' });
    assert.match(preflight.headers.get('Access-Control-Allow-Headers')!, /Authorization/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
