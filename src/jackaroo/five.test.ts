import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, getLegalActions } from './engine.js';
import { SUITS } from './types.js';
import { atHome, atTrack, choose, exactGame, marble, movement, rejectAtomic, relativeTrack } from './test-fixtures.js';

test('5 moves either opponent around all unprotected track positions, bypassing home', () => {
  for (const actor of [0, 1]) for (const suit of SUITS) for (let origin = 1; origin < 64; origin++) {
    const state = exactGame('5', actor, suit), owner = 1 - actor;
    atTrack(state, owner, 0, relativeTrack(state, owner, origin));
    const action = movement(state, 5, owner);
    const legal = choose(getLegalActions(state), action);
    assert.ok(legal);
    assert.deepEqual(legal.paths[0]!.positions, Array.from({ length: 5 }, (_, i) => ({ kind: 'track', position: relativeTrack(state, owner, origin + i + 1) })));
    const next = applyAction(state, action);
    assert.deepEqual(marble(next, owner).location, { kind: 'track', position: relativeTrack(state, owner, origin + 5) });
    assert.equal(next.discard.at(-1)!.id, action.cardId);
  }
});

test('5 excludes base, home and protected starts for either owner', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('5');
    rejectAtomic(state, movement(state, 5, owner));
    atTrack(state, owner, 0, state.players[owner]!.start);
    rejectAtomic(state, movement(state, 5, owner));
    for (let position = 0; position < 4; position++) {
      atHome(state, owner, 0, position);
      rejectAtomic(state, movement(state, 5, owner));
    }
  }
});

test('5 respects moving-owner occupancy and protected path blockers atomically', () => {
  const state = exactGame('5');
  atTrack(state, 1, 0, 10);
  atTrack(state, 1, 1, 15);
  rejectAtomic(state, movement(state, 5, 1));
  marble(state, 1, 1).location = { kind: 'base' };
  atTrack(state, 0, 0, 15);
  assert.deepEqual(marble(applyAction(state, movement(state, 5, 1)), 0).location, { kind: 'base' });
  atTrack(state, 1, 0, 62);
  atTrack(state, 0, 0, 0);
  rejectAtomic(state, movement(state, 5, 1));
});

test('other number cards still cannot move opponents', () => {
  for (const rank of ['2', '3', '6', '7', '8', '9', '10'] as const) {
    const state = exactGame(rank);
    atTrack(state, 1, 0, 10);
    rejectAtomic(state, movement(state, Number(rank), 1));
  }
});
