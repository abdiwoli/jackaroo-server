import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, getLegalActions, getLegalCards } from './engine.js';
import { RANKS } from './types.js';
import { actionIdentity, atTrack, exactGame, rejectAtomic } from './test-fixtures.js';

for (const trigger of ['Q', '10'] as const) test(`${trigger} allows any chosen rank to be discarded but forbids all its normal effects`, () => {
  for (const owner of [0, 1]) for (const rank of RANKS) {
    const state = exactGame(trigger, owner);
    const target = state.players[1 - owner]!;
    state.deck.push(...target.hand); target.hand = [];
    target.hand.push(state.deck.splice(state.deck.findIndex(card => card.rank === rank), 1)[0]!);
    state.players[owner]!.hand.push(state.deck.splice(state.deck.findIndex(card => card.rank === '2'), 1)[0]!);
    atTrack(state, owner, 0, 10); atTrack(state, 1 - owner, 0, 40);
    const before = structuredClone(state);
    const pending = applyAction(state, { ...actionIdentity(state), type: trigger === 'Q' ? 'queen' : 'ten-discard' });
    assert.deepEqual(state, before);
    assert.equal(pending.currentPlayerId, target.id);
    assert.equal(pending.pendingDiscardPlayerId, target.id);
    assert.deepEqual(pending.players[1 - owner]!.hand, target.hand);
    assert.deepEqual(getLegalCards(pending), []);
    const choices = getLegalActions(pending);
    assert.deepEqual(choices, [{ action: { type: 'discard', playerId: target.id, cardId: target.hand[0]!.id },
      paths: [], destinations: [], capturedMarbleIds: [] }]);
    const withoutEffect = structuredClone(pending);
    withoutEffect.pendingDiscardPlayerId = null;
    for (const normal of getLegalActions(withoutEffect).filter(choice => choice.action.type !== 'discard')) rejectAtomic(pending, normal.action);
    const after = applyAction(pending, choices[0]!.action);
    assert.equal(after.pendingDiscardPlayerId, null);
    assert.equal(after.currentPlayerId, state.players[owner]!.id);
    assert.deepEqual(after.players.map(player => player.marbles), state.players.map(player => player.marbles));
    assert.equal(after.players[1 - owner]!.hand.length, 0);
    assert.equal(after.discard.at(-1)!.id, target.hand[0]!.id);
  }
});

test('the final forced discard completes the hand and redeals without carrying the Queen effect', () => {
  const state = exactGame('Q');
  const pending = applyAction(state, { ...actionIdentity(state), type: 'queen' });
  assert.equal(pending.handNumber, state.handNumber);
  const after = applyAction(pending, getLegalActions(pending)[0]!.action);
  assert.equal(after.handNumber, state.handNumber + 1);
  assert.equal(after.pendingDiscardPlayerId, null);
  assert.deepEqual(after.players.map(player => player.hand.length), [5, 5]);
});
