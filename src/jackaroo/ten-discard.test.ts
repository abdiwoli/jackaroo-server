import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, getLegalActions } from './engine.js';
import { RANKS, SUITS } from './types.js';
import { actionIdentity, atTrack, emptyHand, exactGame, movement, rejectAtomic } from './test-fixtures.js';

test('Ten offers forward movement and opponent discard as separate alternatives for both players and every suit', () => {
  for (const owner of [0, 1]) for (const suit of SUITS) {
    const state = exactGame('10', owner, suit);
    atTrack(state, owner, 0, 10);
    const choices = getLegalActions(state);
    assert.ok(choices.some(choice => choice.action.type === 'move'));
    const discard = choices.find(choice => choice.action.type === 'ten-discard')!;
    assert.ok(discard);
    const moved = applyAction(state, movement(state, 10, owner));
    assert.deepEqual(moved.players[owner]!.marbles[0]!.location, { kind: 'track', position: 20 });
    assert.equal(moved.pendingDiscardPlayerId, null);
    const forced = applyAction(state, discard.action);
    assert.deepEqual(forced.players.map(player => player.marbles), state.players.map(player => player.marbles));
    assert.equal(forced.pendingDiscardPlayerId, state.players[1 - owner]!.id);
    assert.deepEqual(forced.players[1 - owner]!.hand, state.players[1 - owner]!.hand);
    assert.deepEqual(discard.paths, []);
    assert.deepEqual(discard.destinations, []);
  }
});

test('Ten can force discard without any movable piece, but other ranks cannot use the Ten action', () => {
  const state = exactGame('10');
  assert.deepEqual(getLegalActions(state).map(choice => choice.action.type), ['ten-discard']);
  for (const rank of RANKS.filter(rank => rank !== '10')) {
    const other = exactGame(rank);
    rejectAtomic(other, { ...actionIdentity(other), type: 'ten-discard' });
  }
});

test('Ten discard targeting an empty hand clears before the next deal', () => {
  const state = exactGame('10');
  emptyHand(state, 1);
  const next = applyAction(state, { ...actionIdentity(state), type: 'ten-discard' });
  assert.equal(next.pendingDiscardPlayerId, null);
  assert.equal(next.handNumber, state.handNumber + 1);
  assert.deepEqual(next.players.map(player => player.hand.length), [5, 5]);
});
