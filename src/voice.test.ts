import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { createOnlineGameStore } from './online-games.js';
import { createVoiceSession } from './voice.js';
import { createRequestHandler } from './app.js';

const configuration = {
  url: 'wss://voice.example.test', apiKey: 'test-voice-key', apiSecret: 'test-only-secret-with-at-least-32-characters',
};

test('voice grants are tied to the authenticated seat and game, audio only and short lived', async () => {
  const store = createOnlineGameStore();
  const host = store.create();
  const guest = store.join(host.game.roomCode);
  const a = await createVoiceSession(store, host.game.id, host.token, configuration);
  const b = await createVoiceSession(store, host.game.id, guest.token, configuration);
  const verifier = new TokenVerifier(configuration.apiKey, configuration.apiSecret);
  const first = await verifier.verify(a.participantToken);
  const second = await verifier.verify(b.participantToken);
  assert.equal(a.serverUrl, configuration.url);
  assert.equal(first.sub, host.game.viewerPlayerId);
  assert.equal(second.sub, guest.game.viewerPlayerId);
  assert.equal(first.video?.room, `jackaroo-${host.game.id}`);
  assert.equal(second.video?.room, first.video?.room);
  assert.deepEqual(first.video?.canPublishSources, ['microphone']);
  assert.equal(first.video?.canPublishData, false);
  assert.equal(first.video?.canSubscribe, true);
  const remaining = (first.exp ?? 0) - Math.floor(Date.now() / 1000);
  assert.ok(remaining > 0 && remaining <= 600);
  assert.ok(!JSON.stringify(a).includes(configuration.apiSecret));
  const other = store.create();
  await assert.rejects(createVoiceSession(store, other.game.id, host.token, configuration), /session/);
  await assert.rejects(createVoiceSession(store, host.game.id, '', configuration), /session/);
});

test('voice reports unconfigured service after authenticating, without changing the game', async () => {
  const store = createOnlineGameStore();
  const host = store.create();
  const before = store.get(host.game.id, host.token);
  await assert.rejects(createVoiceSession(store, host.game.id, host.token, {}), /not available/);
  await assert.rejects(createVoiceSession(store, host.game.id, host.token, { ...configuration, url: 'http://example.test' }), /not available/);
  assert.deepEqual(store.get(host.game.id, host.token), before);
});

test('HTTP voice endpoint requires the room bearer token and cannot use a caller-selected identity', async () => {
  const store = createOnlineGameStore();
  const host = store.create();
  const server = createServer(createRequestHandler(store, configuration));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/online-games/${host.game.id}/voice-token`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    const response = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'someone-else', room: 'another-room' }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as { participantToken: string };
    const claim = await new TokenVerifier(configuration.apiKey, configuration.apiSecret).verify(body.participantToken);
    assert.equal(claim.sub, host.game.viewerPlayerId);
    assert.equal(claim.video?.room, `jackaroo-${host.game.id}`);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
