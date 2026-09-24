import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, assertGameState } from './engine.js';
import { createDeck } from './deck.js';
import { RuleError } from './rules.js';
import { SUITS, type GameAction, type GameState, type Rank } from './types.js';
import { actionIdentity, atHome, atTrack, emptyHand, exactGame, marble, movement, relativeTrack, selectedCard } from './test-fixtures.js';

function conserved(state: GameState) {
  const cards = [...state.deck, ...state.discard, ...state.players.flatMap(player => player.hand)];
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards.map(card => card.id)).size, 52);
  assert.deepEqual(cards.map(card => card.id).sort(), createDeck().map(card => card.id).sort());
  assertGameState(state);
}

function success(state: GameState, action: GameAction) {
  const before = structuredClone(state);
  const card = selectedCard(state);
  const owner = state.players.findIndex(player => player.id === action.playerId);
  const next = applyAction(state, action);
  assert.deepEqual(state, before, 'successful actions do not mutate the input');
  assert.deepEqual(next.players[owner]!.hand, before.players[owner]!.hand.filter(held => held.id !== card.id));
  assert.equal(next.players[owner]!.hand.length, before.players[owner]!.hand.length - 1);
  assert.deepEqual(next.discard, [...before.discard, card], 'append the exact physical card once');
  assert.equal(next.discard.filter(discarded => discarded.id === card.id).length, 1);
  assert.ok(next.players.every(player => player.hand.every(held => held.id !== card.id)));
  conserved(next);
  return next;
}

function failure(state: GameState, action: GameAction) {
  const before = structuredClone(state);
  const card = selectedCard(state);
  assert.throws(() => applyAction(state, action), RuleError);
  assert.deepEqual(state, before, 'marbles, piles, hands, skips and turns all remain unchanged');
  assert.deepEqual(selectedCard(state), card);
  assert.deepEqual(state.discard, before.discard);
  conserved(state);
}

function cases(name: string, rank: Rank, check: (state: GameState, owner: number) => void) {
  test(name, () => {
    for (const owner of [0, 1]) for (const suit of SUITS) {
      const state = exactGame(rank, owner, suit);
      // A pre-existing discard proves that a play appends without replacing it.
      state.discard.push(state.deck.pop()!);
      check(state, owner);
    }
  });
}

cases('1. normal play removes exactly one held card', '3', (state, owner) => {
  state.players[owner]!.hand.push(state.deck.pop()!);
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  success(state, movement(state, 3, owner));
});
cases('2. normal play appends the exact physical card to discard', '3', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  success(state, movement(state, 3, owner));
});
cases('3. invalid movement keeps the selected card held', '3', (state, owner) => {
  failure(state, movement(state, 3, owner)); // A base marble cannot move.
});
cases('4. invalid movement preserves the existing discard pile', '3', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  atTrack(state, owner, 1, relativeTrack(state, owner, 13));
  failure(state, movement(state, 3, owner));
});
for (const [number, rank] of [[5, 'A'], [6, 'K']] as const) {
  cases(`${number}. successful ${rank} release discards that card`, rank, (state, owner) => {
    const next = success(state, { ...actionIdentity(state), type: 'release', marbleId: marble(state, owner).id });
    assert.deepEqual(marble(next, owner).location, { kind: 'track', position: state.players[owner]!.start });
  });
}
cases('7. successful King movement commits kills and discards King', 'K', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 12));
  const next = success(state, movement(state, 13, owner));
  assert.deepEqual(marble(next, 1 - owner).location, { kind: 'base' });
});
cases('8. successful Jack swap discards Jack', 'J', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 20));
  const next = success(state, { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, owner).id, opponentMarbleId: marble(state, 1 - owner).id });
  assert.deepEqual(marble(next, owner).location, marble(state, 1 - owner).location);
  assert.deepEqual(marble(next, 1 - owner).location, marble(state, owner).location);
});
cases('9. failed Jack swap leaves Jack in hand', 'J', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  atTrack(state, 1 - owner, 0, state.players[1 - owner]!.start);
  failure(state, { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, owner).id, opponentMarbleId: marble(state, 1 - owner).id });
});
cases('10. successful single-marble full 7 discards 7', '7', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  const next = success(state, movement(state, 7, owner));
  assert.deepEqual(marble(next, owner).location, { kind: 'track', position: relativeTrack(state, owner, 17) });
});
cases('11. successful split 7 commits both segments and discards once', '7', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  atTrack(state, owner, 1, relativeTrack(state, owner, 40));
  const next = success(state, { ...actionIdentity(state), type: 'move', moves: [
    { marbleId: marble(state, owner).id, steps: 2 }, { marbleId: marble(state, owner, 1).id, steps: 5 },
  ] });
  assert.deepEqual(marble(next, owner).location, { kind: 'track', position: relativeTrack(state, owner, 12) });
  assert.deepEqual(marble(next, owner, 1).location, { kind: 'track', position: relativeTrack(state, owner, 45) });
});
cases('12. failed second split segment rolls back first capture and keeps 7 held', '7', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 10));
  atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 12));
  atTrack(state, owner, 1, relativeTrack(state, owner, 30));
  atTrack(state, 1 - owner, 1, state.players[1 - owner]!.start);
  failure(state, { ...actionIdentity(state), type: 'move', moves: [
    { marbleId: marble(state, owner).id, steps: 2 }, { marbleId: marble(state, owner, 1).id, steps: 5 },
  ] });
});
cases('13. Queen discards while the opponent chooses their forced discard', 'Q', (state, owner) => {
  state.players[owner]!.hand.push(state.deck.pop()!);
  const next = success(state, { ...actionIdentity(state), type: 'queen' });
  assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
  assert.equal(next.pendingDiscardPlayerId, state.players[1 - owner]!.id);
  assert.deepEqual(next.players[1 - owner]!.hand, state.players[1 - owner]!.hand);
});
cases('14. no physical card can exist simultaneously in hand and discard', 'A', (state, owner) => {
  const next = success(state, { ...actionIdentity(state), type: 'release', marbleId: marble(state, owner).id });
  const duplicate = structuredClone(next);
  duplicate.players[owner]!.hand.push(structuredClone(duplicate.discard.at(-1)!));
  assert.throws(() => assertGameState(duplicate), RuleError);
});

cases('blocked King path rolls back earlier kills and preserves King/discard', 'K', (state, owner) => {
  atTrack(state, owner, 0, relativeTrack(state, owner, 25));
  atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 26));
  atTrack(state, 1 - owner, 1, state.players[1 - owner]!.start);
  failure(state, movement(state, 13, owner));
});
cases('blocked home movement preserves card and discard', '3', (state, owner) => {
  atHome(state, owner, 0, 0);
  atHome(state, owner, 1, 2);
  failure(state, movement(state, 3, owner));
});

cases('last successful play can reshuffle discard into a conserved deck and new hands', 'Q', (state, owner) => {
  emptyHand(state, 1 - owner);
  state.discard.push(...state.deck.splice(9));
  const before = structuredClone(state);
  const card = selectedCard(state);
  const next = applyAction(state, { ...actionIdentity(state), type: 'queen' }, { rng: () => 0.5 });
  assert.deepEqual(state, before);
  assert.equal(next.handNumber, state.handNumber + 1);
  assert.deepEqual(next.players.map(player => player.hand.length), [5, 5]);
  assert.deepEqual(next.discard, []);
  assert.equal([...next.deck, ...next.players.flatMap(player => player.hand)].filter(held => held.id === card.id).length, 1);
  conserved(next);
});
