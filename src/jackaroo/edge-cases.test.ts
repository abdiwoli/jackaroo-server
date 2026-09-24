import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, assertGameState, checkWinner, createGame, dealCards, endTurn, getCurrentPlayer, getLegalActions, getLegalCards, startGame } from './engine.js';
import { createDeck } from './deck.js';
import { RuleError } from './rules.js';
import { RANKS, type GameAction } from './types.js';
import { actionIdentity, atHome, atTrack, emptyHand, exactGame, marble, movement, rejectAtomic, relativeTrack } from './test-fixtures.js';

test('every rank: base-only board permits A/K release, Queen forced discard and Jack pass', () => {
  for (const rank of RANKS) for (const owner of [0, 1]) {
    const state = exactGame(rank, owner);
    const choices = getLegalActions(state);
    const discard: GameAction = { ...actionIdentity(state), type: 'discard' };
    if (rank === 'A' || rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') {
      assert.equal(getLegalCards(state).length, 1);
      assert.ok(choices.every(choice => choice.action.type !== 'discard'));
      rejectAtomic(state, discard);
    } else {
      assert.deepEqual(getLegalCards(state), []);
      assert.equal(choices.length, 1); assert.deepEqual(choices[0]!.action, discard);
      const next = applyAction(state, discard);
      assert.equal(next.discard.length, 1);
      assert.equal(next.pendingDiscardPlayerId, null);
      assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
      assert.ok(next.players.flatMap(player => player.marbles).every(marble => marble.location.kind === 'base'));
      assertGameState(next);
    }
  }
});

test('a blocked selected card is not discardable when a different held card is legal', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('4', owner); atHome(state, owner, 0, 3);
    const blockedCard = actionIdentity(state).cardId;
    const aceIndex = state.deck.findIndex(card => card.rank === 'A');
    const ace = state.deck.splice(aceIndex, 1)[0]!;
    state.players[owner]!.hand.push(ace);
    assert.deepEqual(getLegalCards(state).map(card => card.id), [ace.id]);
    assert.ok(getLegalActions(state).every(choice => choice.action.type === 'release'));
    rejectAtomic(state, { ...actionIdentity(state), cardId: blockedCard, type: 'discard' });
  }
});

test('every rank/action choice: foreign turns, unknown cards, opponent-held cards, and replay reject atomically', () => {
  for (const rank of RANKS) for (const owner of [0, 1]) {
    const state = exactGame(rank, owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 40));
    const choices = getLegalActions(state);
    assert.ok(choices.length > 0);
    for (const choice of choices) {
      rejectAtomic(state, { ...choice.action, playerId: state.players[1 - owner]!.id });
      rejectAtomic(state, { ...choice.action, cardId: 'not-a-card' });
      rejectAtomic(state, { ...choice.action, cardId: state.players[1 - owner]!.hand[0]!.id });
    }
    const chosen = choices[0]!.action;
    const next = applyAction(state, chosen);
    // A replay cannot reuse a consumed card.
    rejectAtomic(next, chosen);
  }
});

test('invalid action shapes, unknown discriminants, missing/unknown marbles reject without mutation', () => {
  const state = exactGame('2'); atTrack(state, 0, 0, 10);
  for (const action of [null, undefined, {}, [], 2, 'move',
    { ...actionIdentity(state), type: 'unknown' },
    { ...actionIdentity(state), type: 'move' },
    { ...actionIdentity(state), type: 'move', moves: [] },
    { ...actionIdentity(state), type: 'move', moves: [undefined] },
    { ...actionIdentity(state), type: 'move', moves: [{ marbleId: 'missing', steps: 2 }] },
    { ...actionIdentity(state), type: 'move', moves: [{ marbleId: 10, steps: 2 }] },
    { ...actionIdentity(state), type: 'move', moves: [{ marbleId: marble(state).id, steps: '2' }] },
  ]) rejectAtomic(state, action as GameAction);
});

test('each forward movement card can complete the fourth marble; winner prevents redeal and all later actions', () => {
  for (const [rank, steps] of [['A', 1], ['2', 2], ['3', 3], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['K', 13]] as const) {
    for (const owner of [0, 1]) {
      const state = exactGame(rank, owner);
      atTrack(state, owner, 0, relativeTrack(state, owner, state.board.trackSize - steps));
      for (let index = 1; index < 4; index++) atHome(state, owner, index, index);
      emptyHand(state, 1 - owner);
      const action = movement(state, steps, owner);
      const next = applyAction(state, action);
      assert.equal(next.status, 'finished'); assert.equal(next.winnerId, state.players[owner]!.id);
      assert.equal(checkWinner(next), state.players[owner]!.id);
      assert.equal(next.currentPlayerId, null); assert.equal(getCurrentPlayer(next), null);
      assert.equal(next.pendingDiscardPlayerId, null); assert.equal(next.handNumber, state.handNumber);
      assert.deepEqual(getLegalActions(next), []); assert.deepEqual(getLegalCards(next), []);
      rejectAtomic(next, action);
      rejectAtomic(next, { ...actionIdentity(state), type: 'discard' });
      assert.throws(() => endTurn(next), RuleError);
      assert.throws(() => dealCards(next), RuleError);
      assert.throws(() => startGame(next), RuleError);
      assertGameState(next);
    }
  }
});

test('three home marbles plus one base/track marble is never a win', () => {
  for (const owner of [0, 1]) for (const lastOnTrack of [false, true]) {
    const state = exactGame('2', owner);
    for (let index = 1; index < 4; index++) atHome(state, owner, index, index);
    if (lastOnTrack) atTrack(state, owner, 0, relativeTrack(state, owner, 63));
    assertGameState(state); assert.equal(checkWinner(state), null);
  }
});

test('draw-pile boundaries conserve all 52 cards; reshuffle occurs only below a complete ten-card deal', () => {
  for (const remaining of [0, 1, 2, 9, 10, 11, 42, 52]) {
    const state = exactGame('2'); emptyHand(state, 0); emptyHand(state, 1);
    const physical = createDeck();
    state.deck = physical.slice(0, remaining); state.discard = physical.slice(remaining);
    const snapshot = structuredClone(state);
    let samples = 0;
    const next = dealCards(state, { rng: () => { samples++; return 0.25; } });
    assertGameState(next);
    assert.deepEqual(next.players.map(player => player.hand.length), [5, 5]);
    if (remaining < 10) {
      assert.equal(samples, 51); assert.equal(next.deck.length, 42); assert.equal(next.discard.length, 0);
    } else {
      assert.equal(samples, 0); assert.equal(next.deck.length, remaining - 10);
      assert.deepEqual(next.discard, snapshot.discard);
      assert.equal(next.players[0]!.hand[0]!.id, snapshot.deck[0]!.id);
    }
    assert.deepEqual(state, snapshot);
  }
});

test('invalid reshuffle RNG rolls back a whole successful movement/capture/card/turn transition', () => {
  for (const sample of [-1, 1, NaN, Infinity]) {
    const state = exactGame('A'); emptyHand(state, 1);
    atTrack(state, 0, 0, 10); atTrack(state, 1, 0, 11);
    state.discard.push(...state.deck.splice(2));
    assertGameState(state);
    const snapshot = structuredClone(state);
    assert.throws(() => applyAction(state, movement(state, 1), { rng: () => sample }), RuleError);
    assert.deepEqual(state, snapshot);
  }
});

test('public empty-hand pass does not consume cards; nonempty/unstarted/finished turns cannot pass', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('2', owner); emptyHand(state, owner);
    const snapshot = structuredClone(state);
    const next = endTurn(state);
    assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
    assert.deepEqual(next.deck, state.deck); assert.deepEqual(next.discard, state.discard);
    assert.deepEqual(state, snapshot); assertGameState(next);
  }
  const created = createGame(['A', 'B'], { deck: createDeck() });
  assert.throws(() => endTurn(created), RuleError);
  const blocked = exactGame('2');
  assert.throws(() => endTurn(blocked), RuleError); // Must explicitly discard, not bypass the card.
});

test('queries and injected deck/board snapshots cannot mutate authoritative state', () => {
  const deck = createDeck();
  const board = { trackSize: 64, starts: [0, 32], marblesPerPlayer: 4, homeSize: 4 };
  const created = createGame(['A', 'B'], { deck, board });
  deck[0]!.id = 'changed'; board.starts[0] = 8;
  assertGameState(created);
  const state = exactGame('A'); atTrack(state, 0, 0, 10);
  const snapshot = structuredClone(state);
  const player = getCurrentPlayer(state)!; player.marbles[0]!.location = { kind: 'base' };
  const cards = getLegalCards(state); cards[0]!.id = 'changed';
  const choices = getLegalActions(state);
  for (const choice of choices) {
    choice.action.cardId = 'changed';
    choice.capturedMarbleIds.push('changed');
    if (choice.paths[0]) choice.paths[0].positions.length = 0;
    if (choice.destinations[0]) choice.destinations[0].location = { kind: 'base' };
  }
  assert.deepEqual(state, snapshot);
});

test('same-rank physical cards remain distinct legal choices and only the selected suit is consumed', () => {
  for (const rank of ['A', '7', 'J', 'Q', 'K'] as const) {
    const state = exactGame(rank);
    const index = state.deck.findIndex(card => card.rank === rank && card.suit === 'spades');
    const duplicateRank = state.deck.splice(index, 1)[0]!;
    state.players[0]!.hand.push(duplicateRank);
    atTrack(state, 0, 0, 10); atTrack(state, 0, 1, 20); atTrack(state, 1, 0, 40);
    const choices = getLegalActions(state);
    assert.deepEqual(new Set(getLegalCards(state).map(card => card.id)), new Set(state.players[0]!.hand.map(card => card.id)));
    const original = choices.filter(choice => choice.action.cardId === actionIdentity(state).cardId);
    const duplicate = choices.filter(choice => choice.action.cardId === duplicateRank.id);
    assert.equal(original.length, duplicate.length);
    assert.ok(duplicate.length > 0);
    const next = applyAction(state, duplicate[0]!.action);
    assert.deepEqual(next.players[0]!.hand.map(card => card.id), [actionIdentity(state).cardId]);
    assert.deepEqual(next.discard.map(card => card.id), [duplicateRank.id]);
    assertGameState(next);
  }
});
