import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, assertGameState, checkWinner, createDeck, createGame, discardCard, endTurn, getCurrentPlayer, getLegalActions, getLegalCards, playCard, RuleError, startGame } from './index.js';
import type { GameAction, GameState, Rank } from './index.js';
import { actionIdentity, atHome, atTrack, choose, exactGame, marble, movement, rejectAtomic, relativeTrack } from './test-fixtures.js';

function invariant(state: GameState) {
  assertGameState(state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  const cards = [...state.deck, ...state.discard, ...state.players.flatMap(player => player.hand)];
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards.map(card => card.id)).size, 52);
  assert.deepEqual(cards.map(card => card.id).sort(), createDeck().map(card => card.id).sort());
  const marbles = state.players.flatMap(player => player.marbles);
  assert.equal(new Set(marbles.map(marble => marble.id)).size, 8);
  const occupied = new Set<string>();
  for (const marble of marbles) {
    const location = marble.location;
    assert.ok(['base', 'track', 'home'].includes(location.kind));
    if (location.kind === 'base') continue;
    assert.ok(Number.isInteger(location.position) && location.position >= 0);
    assert.ok(location.position < (location.kind === 'track' ? 64 : 4));
    const key = location.kind === 'track' ? `track:${location.position}` : `${marble.playerId}:home:${location.position}`;
    assert.ok(!occupied.has(key));
    occupied.add(key);
  }
  if (state.status === 'playing') assert.ok(state.players.some(player => player.id === state.currentPlayerId && player.hand.length > 0));
  else if (state.status === 'finished') assert.equal(checkWinner(state), state.winnerId);
}

function addCard(state: GameState, owner: number, rank: Rank) {
  const index = state.deck.findIndex(card => card.rank === rank);
  assert.ok(index >= 0);
  const card = state.deck.splice(index, 1)[0]!;
  state.players[owner]!.hand.push(card);
  return card;
}

for (const rank of ['A', 'K'] as const) test(`${rank}: no base marbles means no release actions`, () => {
  for (const owner of [0, 1]) {
    const state = exactGame(rank, owner);
    for (let index = 0; index < 4; index++) atTrack(state, owner, index, relativeTrack(state, owner, 5 + index * 10));
    assert.ok(getLegalActions(state).every(choice => choice.action.type !== 'release'));
    for (const piece of state.players[owner]!.marbles) rejectAtomic(state, { ...actionIdentity(state), type: 'release', marbleId: piece.id });
  }
});

test('7: split-created destination conflicts and order-sensitive track vacancy', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('7', owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    atTrack(state, owner, 1, relativeTrack(state, owner, 7));
    const first = { marbleId: marble(state, owner).id, steps: 2 };
    const second = { marbleId: marble(state, owner, 1).id, steps: 5 };
    const illegal: GameAction = { ...actionIdentity(state), type: 'move', moves: [first, second] };
    const reverse: GameAction = { ...actionIdentity(state), type: 'move', moves: [second, first] };
    const choices = getLegalActions(state);
    assert.equal(choose(choices, illegal), undefined);
    rejectAtomic(state, illegal);
    assert.equal(choose(choices, reverse), undefined);
    rejectAtomic(state, reverse); // Both segments have the same destination.
    atTrack(state, owner, 1, relativeTrack(state, owner, 12));
    rejectAtomic(state, illegal); // First segment tries to land before vacancy.
    assert.ok(choose(getLegalActions(state), reverse));
    assert.equal(reverse.type, 'move');
    const next = playCard(state, reverse as Parameters<typeof playCard>[1]);
    assert.deepEqual(marble(next, owner).location, { kind: 'track', position: relativeTrack(state, owner, 12) });
    assert.deepEqual(marble(next, owner, 1).location, { kind: 'track', position: relativeTrack(state, owner, 17) });
    invariant(next);
  }
});

test('7: first segment reaches Home 4 while second segment must still commit', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('7', owner);
    atHome(state, owner, 0, 1);
    atTrack(state, owner, 1, relativeTrack(state, owner, 10));
    const next = applyAction(state, { ...actionIdentity(state), type: 'move', moves: [
      { marbleId: marble(state, owner).id, steps: 2 }, { marbleId: marble(state, owner, 1).id, steps: 5 },
    ] });
    assert.deepEqual(marble(next, owner).location, { kind: 'home', position: 3 });
    assert.deepEqual(marble(next, owner, 1).location, { kind: 'track', position: relativeTrack(state, owner, 15) });
    assert.equal(next.status, 'playing');
    assert.equal(checkWinner(next), null);
    assert.deepEqual(next.discard.map(card => card.id), [actionIdentity(state).cardId]);
    invariant(next);
  }
});

test('7: completing first marble never permits partial commit when second overshoots home', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('7', owner);
    atHome(state, owner, 0, 1);
    atTrack(state, owner, 1, relativeTrack(state, owner, 63));
    rejectAtomic(state, { ...actionIdentity(state), type: 'move', moves: [
      { marbleId: marble(state, owner).id, steps: 2 }, { marbleId: marble(state, owner, 1).id, steps: 5 },
    ] });
  }
});

test('consecutive Queens each require a separate opponent discard', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('Q', owner);
    const second = addCard(state, owner, 'Q');
    const normal = addCard(state, owner, '2');
    addCard(state, 1 - owner, '3');
    addCard(state, 1 - owner, '4');
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    const originalOpponent = structuredClone(state.players[1 - owner]!.hand);
    let next = applyAction(state, { ...actionIdentity(state), type: 'queen' });
    assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
    assert.equal(next.pendingDiscardPlayerId, next.currentPlayerId);
    next = applyAction(next, { playerId: next.currentPlayerId!, cardId: originalOpponent[0]!.id, type: 'discard' });
    rejectAtomic(next, { playerId: state.players[owner]!.id, cardId: second.id, type: 'move', moves: [{ marbleId: marble(state, owner).id, steps: 12 }] });
    next = applyAction(next, { playerId: state.players[owner]!.id, cardId: second.id, type: 'queen' });
    assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
    assert.equal(next.pendingDiscardPlayerId, next.currentPlayerId);
    next = applyAction(next, { playerId: next.currentPlayerId!, cardId: originalOpponent[1]!.id, type: 'discard' });
    assert.equal(next.pendingDiscardPlayerId, null);
    assert.deepEqual(next.players[1 - owner]!.hand, originalOpponent.slice(2));
    assert.deepEqual(next.discard.map(card => card.id), [actionIdentity(state).cardId, originalOpponent[0]!.id, second.id, originalOpponent[1]!.id]);
    next = applyAction(next, { playerId: state.players[owner]!.id, cardId: normal.id, type: 'move', moves: [{ marbleId: marble(state, owner).id, steps: 2 }] });
    assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
    invariant(next);
  }
});

test('pending discard is preserved by queries/rejections and consumed by discarding', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('2', owner);
    addCard(state, owner, '3');
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    state.pendingDiscardPlayerId = state.players[owner]!.id;
    const before = structuredClone(state);
    getCurrentPlayer(state); getLegalCards(state); getLegalActions(state);
    rejectAtomic(state, movement(state, 3, owner));
    assert.deepEqual(state, before);
    rejectAtomic(state, movement(state, 2, owner));
    const next = applyAction(state, { ...actionIdentity(state), type: 'discard' });
    assert.equal(next.pendingDiscardPlayerId, null);
    assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
    invariant(next);
  }
});

test('Jack changes exactly selected marbles with no intermediate effects', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('J', owner);
    for (let index = 0; index < 4; index++) {
      atTrack(state, owner, index, relativeTrack(state, owner, 5 + index * 5));
      atTrack(state, 1 - owner, index, relativeTrack(state, owner, 35 + index * 5));
    }
    const action: GameAction = { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, owner).id, opponentMarbleId: marble(state, 1 - owner).id };
    const choice = choose(getLegalActions(state), action)!;
    assert.deepEqual(choice.paths, []);
    assert.deepEqual(choice.capturedMarbleIds, []);
    const next = applyAction(state, action);
    const expected = structuredClone(state.players.flatMap(player => player.marbles));
    const own = expected.find(piece => piece.id === action.ownMarbleId)!;
    const other = expected.find(piece => piece.id === action.opponentMarbleId)!;
    [own.location, other.location] = [other.location, own.location];
    assert.deepEqual(next.players.flatMap(player => player.marbles), expected);
    invariant(next);
  }
});

test('capturing a fourth marble leaves three home marbles insufficient to win', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('2', 1 - owner);
    for (let index = 1; index < 4; index++) atHome(state, owner, index, index);
    atTrack(state, owner, 0, relativeTrack(state, owner, 63));
    atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 61));
    const next = applyAction(state, movement(state, 2, 1 - owner));
    assert.deepEqual(marble(next, owner).location, { kind: 'base' });
    assert.equal(checkWinner(next), null);
    assert.equal(next.winnerId, null);
    assert.equal(next.status, 'playing');
    invariant(next);
  }
});

test('all-illegal mixed hand advertises executable chosen discards without movement', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('4', owner);
    addCard(state, owner, '7'); addCard(state, owner, '3');
    const choices = getLegalActions(state);
    assert.equal(choices.length, 3);
    assert.deepEqual(getLegalCards(state), []);
    for (const choice of choices) {
      assert.equal(choice.action.type, 'discard');
      const next = discardCard(state, choice.action as Parameters<typeof discardCard>[1]);
      assert.deepEqual(next.players.flatMap(player => player.marbles), state.players.flatMap(player => player.marbles));
      assert.deepEqual(next.discard.map(card => card.id), [choice.action.cardId]);
      assert.equal(next.currentPlayerId, state.players[1 - owner]!.id);
      invariant(next);
    }
    const before = structuredClone(state);
    assert.throws(() => endTurn(state), RuleError);
    assert.deepEqual(state, before);
  }
});

function rng(seed: number) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x100000000; };
}

function boundedSequence(seed: number) {
  const random = rng(seed);
  let state = startGame(createGame(['A', 'B'], { rng: random }));
  invariant(state);
  assert.equal(state.currentPlayerId, 'A');
  let advertised = 0;
  // Bounded invariant fuzzing only: no full-match completion requirement or
  // simulation CLI/batch work is introduced in this Step 3 audit.
  for (let step = 0; step < 120 && state.status === 'playing'; step++) {
    const before = structuredClone(state);
    const choices = getLegalActions(state);
    assert.ok(choices.length > 0);
    for (const choice of choices) {
      const copy = JSON.parse(JSON.stringify(state)) as GameState;
      const branch = applyAction(copy, choice.action, { rng: rng(seed + step) });
      invariant(branch);
      assert.deepEqual(copy, before);
      for (const destination of choice.destinations) assert.deepEqual(branch.players.flatMap(player => player.marbles).find(piece => piece.id === destination.marbleId)!.location, destination.location);
      for (const id of choice.capturedMarbleIds) assert.deepEqual(branch.players.flatMap(player => player.marbles).find(piece => piece.id === id)!.location, { kind: 'base' });
      advertised++;
    }
    assert.deepEqual(state, before);
    rejectAtomic(state, { ...choices[0]!.action, cardId: 'nonexistent-physical-card' });
    state = applyAction(state, choices[Math.floor(random() * choices.length)]!.action, { rng: random });
    invariant(state);
    assert.equal(state.handStarterIndex, (state.handNumber - 1) % 2);
  }
  assert.ok(advertised >= 120);
  assert.ok(state.handNumber > 5, 'cross multiple redeals and reshuffle boundary');
  return { state, advertised };
}

for (const seed of [1, 7, 42, 99]) test(`seed ${seed}: every advertised action executes across 120 bounded transitions`, () => {
  boundedSequence(seed);
});
test('seeded invariant sequence and advertised-action counts are exactly reproducible', () => {
  assert.deepEqual(boundedSequence(7), boundedSequence(7));
});
