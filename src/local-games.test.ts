import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.js';
import { createLocalGameStore } from './local-games.js';

type View = ReturnType<ReturnType<typeof createLocalGameStore>['create']>;
async function withServer(run: (base: string) => Promise<void>) {
  const server = createApp();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}`);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
async function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function create(base: string): Promise<View> {
  const response = await post(base, '/local-games', {});
  assert.equal(response.status, 201);
  return response.json();
}

test('local board API creates a real game, returns current hand/actions, and supports web CORS', async () => {
  await withServer(async base => {
    const options = await fetch(`${base}/local-games`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:8081', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-origin'), '*');
    assert.equal(options.headers.get('access-control-allow-headers'), 'Content-Type, Authorization');
    const game = await create(base);
    assert.equal(game.status, 'playing'); assert.equal(game.revision, 0);
    assert.equal(game.currentPlayerId, 'Player 1'); assert.equal(game.hand.length, 5);
    assert.deepEqual(game.players.map(player => player.cardCount), [5, 5]);
    assert.deepEqual(game.board.starts, [0, 32]); assert.equal(game.board.trackSize, 64);
    assert.ok(game.legalActions.length > 0);
    assert.ok(game.players.every(player => player.marbles.length === 4 && player.marbles.every(marble => marble.location.kind === 'base')));
    assert.ok(game.players.every(player => !('hand' in player)));
    assert.ok(!('deck' in game) && !('discard' in game));
    assert.deepEqual(game.discardCards, []); assert.equal(game.discardCount, 0); assert.equal(game.lastPlayed, null);
    const response = await fetch(`${base}/local-games/${game.id}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), game);
  });
});

test('local API commits a backend-supplied action and rejects duplicate stale submissions', async () => {
  await withServer(async base => {
    const before = await create(base);
    const action = before.legalActions[0]!.action;
    const route = `/local-games/${before.id}/actions`;
    const result = await post(base, route, { revision: before.revision, action });
    assert.equal(result.status, 200);
    const after: View = await result.json();
    assert.equal(after.revision, 1);
    const played = before.hand.find(card => card.id === action.cardId)!;
    assert.deepEqual(after.discardCards, [played]); assert.equal(after.discardCount, 1);
    assert.deepEqual(after.lastPlayed, { card: played, playerId: action.playerId, revision: 1 });
    assert.equal(after.players.find(player => player.id === action.playerId)!.cardCount, 4);
    for (const destination of before.legalActions[0]!.destinations) {
      const marble = after.players.flatMap(player => player.marbles).find(marble => marble.id === destination.marbleId)!;
      assert.deepEqual(marble.location, destination.location);
    }
    const duplicate = await post(base, route, { revision: before.revision, action });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await (await fetch(`${base}/local-games/${before.id}`)).json(), after);
  });
});

test('local API rejects fake/out-of-turn/malformed actions without any state or revision change', async () => {
  await withServer(async base => {
    const game = await create(base);
    const action = game.legalActions[0]!.action;
    for (const invalid of [null, {}, { ...action, cardId: 'fake' }, { ...action, playerId: 'Player 2' }, { ...action, type: 'unknown' }]) {
      const response = await post(base, `/local-games/${game.id}/actions`, { revision: 0, action: invalid });
      assert.equal(response.status, 422);
      assert.deepEqual(await (await fetch(`${base}/local-games/${game.id}`)).json(), game);
    }
    for (const revision of [undefined, -1, 0.5, '0']) {
      const response = await post(base, `/local-games/${game.id}/actions`, { revision, action });
      assert.equal(response.status, 422);
    }
  });
});

test('local API reports bad JSON, oversized requests and missing games cleanly', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/local-games/missing`)).status, 404);
    const game = await create(base);
    const route = `/local-games/${game.id}/actions`;
    for (const body of ['{', 'null', '[]']) {
      const response = await fetch(`${base}${route}`, { method: 'POST', body });
      assert.equal(response.status, 400);
    }
    assert.equal((await post(base, route, { padding: 'x'.repeat(17000) })).status, 413);
    assert.equal((await fetch(`${base}/local-games`, { method: 'DELETE' })).status, 404);
  });
});

test('local game snapshots are detached; new games and server stores remain independent', () => {
  const store = createLocalGameStore();
  const game = store.create(); const expected = structuredClone(game);
  game.hand[0]!.id = 'changed'; game.players[0]!.marbles[0]!.location = { kind: 'track', position: 8 };
  game.legalActions.length = 0;
  assert.deepEqual(store.get(game.id), expected);
  const next = store.create(); assert.notEqual(next.id, game.id);
  assert.deepEqual(store.get(game.id), expected);
  assert.throws(() => createLocalGameStore().get(game.id), /not found/);
});
