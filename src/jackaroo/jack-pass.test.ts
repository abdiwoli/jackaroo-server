import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, getLegalActions } from './engine.js';
import { actionIdentity, atHome, atTrack, exactGame, rejectAtomic } from './test-fixtures.js';

test('Jack passes without a target even when another card has a legal move', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('J', owner);
    const aceIndex = state.deck.findIndex(card => card.rank === 'A');
    state.players[owner]!.hand.push(state.deck.splice(aceIndex, 1)[0]!);
    const choice = getLegalActions(state).find(choice => choice.action.type === 'jack-pass');
    assert.ok(choice);
    const next = applyAction(state, choice.action);
    assert.deepEqual(next.players.map(player => player.marbles), state.players.map(player => player.marbles));
    assert.deepEqual(choice.paths, []);
    assert.deepEqual(choice.destinations, []);
    assert.equal(next.discard.at(-1)!.id, choice.action.cardId);
    assert.equal(next.players[owner]!.hand.length, 1);
    assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
  }
});

test('home and protected opponent pieces cannot swap and allow Jack pass', () => {
  const state = exactGame('J');
  atHome(state, 1, 0, 0);
  atTrack(state, 1, 1, 32);
  assert.ok(getLegalActions(state).some(choice => choice.action.type === 'jack-pass'));
});

test('Jack pass is forbidden with an eligible opponent or a different card', () => {
  const state = exactGame('J');
  atTrack(state, 0, 0, 10);
  atTrack(state, 1, 0, 20);
  assert.ok(getLegalActions(state).some(choice => choice.action.type === 'swap'));
  assert.ok(!getLegalActions(state).some(choice => choice.action.type === 'jack-pass'));
  rejectAtomic(state, { ...actionIdentity(state), type: 'jack-pass' });
  const other = exactGame('2');
  rejectAtomic(other, { ...actionIdentity(other), type: 'jack-pass' });
});
