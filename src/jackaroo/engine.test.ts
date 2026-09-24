import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { applyAction, assertGameState, checkWinner, createGame, dealCards, discardCard, endTurn, getCurrentPlayer, getLegalActions, getLegalCards, marbleById, playCard, startGame } from './engine.js';
import { createDeck, shuffle } from './deck.js';
import { V1_BOARD } from './board.js';
import { RuleError } from './rules.js';
import type { Card, GameState, Location, MoveSegment, PlayAction, Rank } from './types.js';

function fixture(ranks: Rank[] = ['2'], otherRanks: Rank[] = ['3']): GameState {
  const state = startGame(createGame(['A', 'B'], { deck: createDeck() }));
  const pool = createDeck();
  state.players.forEach((player, index) => {
    player.hand = (index === 0 ? ranks : otherRanks).map(rank => {
      const cardIndex = pool.findIndex(card => card.rank === rank);
      assert.ok(cardIndex >= 0);
      return pool.splice(cardIndex, 1)[0]!;
    });
  });
  state.deck = pool;
  state.discard = [];
  return state;
}
function id(state: GameState, index = 0, owner = 0) { return state.players[owner]!.marbles[index]!.id; }
function set(state: GameState, index: number, location: Location, owner = 0) {
  state.players[owner]!.marbles[index]!.location = location;
}
function track(state: GameState, index: number, position: number, owner = 0) { set(state, index, { kind: 'track', position }, owner); }
function home(state: GameState, index: number, position: number, owner = 0) { set(state, index, { kind: 'home', position }, owner); }
function card(state: GameState, rank: Rank, owner = 0): Card {
  const found = state.players[owner]!.hand.find(card => card.rank === rank);
  assert.ok(found);
  return found;
}
function move(state: GameState, rank: Rank, moves: MoveSegment[]): PlayAction {
  return { type: 'move', playerId: 'A', cardId: card(state, rank).id, moves };
}
function runMove(state: GameState, rank: Rank, steps: number, index = 0) {
  return playCard(state, move(state, rank, [{ marbleId: id(state, index), steps }]));
}
function location(state: GameState, index = 0, owner = 0) { return state.players[owner]!.marbles[index]!.location; }
function rejectedUnchanged(state: GameState, action: PlayAction) {
  const before = structuredClone(state);
  assert.throws(() => playCard(state, action), RuleError);
  assert.deepEqual(state, before);
}

test('initialization: two opposite players, four base marbles, unique standard deck', () => {
  const state = createGame(['A', 'B'], { deck: createDeck() });
  assert.equal(state.status, 'created');
  assert.equal(state.currentPlayerId, null);
  assert.equal(state.handNumber, 0);
  assert.deepEqual(state.players.map(player => player.start), V1_BOARD.starts);
  assert.equal(state.players.length, 2);
  assert.ok(state.players.every(player => player.marbles.length === 4 && player.hand.length === 0 && player.marbles.every(marble => marble.location.kind === 'base')));
  assert.equal(state.deck.length, 52);
  assert.equal(new Set(state.deck.map(card => card.id)).size, 52);
  assert.equal(new Set(state.players.flatMap(player => player.marbles.map(marble => marble.id))).size, 8);
  assertGameState(state);
});

test('start deals five each from injected order, reduces deck, Player 1 begins', () => {
  const initial = createGame(['A', 'B'], { deck: createDeck() });
  const before = structuredClone(initial);
  const state = startGame(initial);
  assert.deepEqual(initial, before);
  assert.deepEqual(state.players.map(player => player.hand.length), [5, 5]);
  assert.equal(state.deck.length, 42);
  assert.equal(state.players[0]!.hand[0]!.id, before.deck[0]!.id);
  assert.equal(state.players[1]!.hand[0]!.id, before.deck[1]!.id);
  assert.equal(state.currentPlayerId, 'A');
  assert.equal(state.handNumber, 1);
  assertGameState(state);
  assert.throws(() => startGame(state), RuleError);
  assert.throws(() => dealCards(state), RuleError);
});

test('injected RNG is deterministic and invalid RNG/deck/players are rejected', () => {
  assert.deepEqual(createGame(['A', 'B'], { rng: () => 0.5 }), createGame(['A', 'B'], { rng: () => 0.5 }));
  assert.throws(() => shuffle(createDeck(), () => 1), RuleError);
  assert.throws(() => createGame(['A', 'A']), RuleError);
  assert.throws(() => createGame(['A', 'B'], { deck: createDeck().slice(1) }), RuleError);
  const duplicate = createDeck(); duplicate[1] = duplicate[0]!;
  assert.throws(() => createGame(['A', 'B'], { deck: duplicate }), RuleError);
});

for (const [rank, steps] of [['A', 1], ['2', 2], ['3', 3], ['5', 5], ['6', 6], ['8', 8], ['9', 9], ['10', 10], ['K', 13]] as const) {
  test(`${rank}: exact forward ${steps}, card consumed once, turn alternates`, () => {
    const state = fixture([rank, 'Q']); track(state, 0, 10);
    const before = structuredClone(state);
    const used = card(state, rank).id;
    const next = runMove(state, rank, steps);
    assert.deepEqual(location(next), { kind: 'track', position: 10 + steps });
    assert.equal(next.currentPlayerId, 'B');
    assert.equal(next.players[0]!.hand.length, 1);
    assert.deepEqual(next.discard.map(card => card.id), [used]);
    assert.deepEqual(state, before);
    assertGameState(next);
    const wrong = move(state, rank, [{ marbleId: id(state), steps: steps + 1 }]);
    rejectedUnchanged(state, wrong);
  });
}

for (const rank of ['A', 'K'] as const) {
  test(`${rank}: releases own base marble, protected at start`, () => {
    const state = fixture([rank]);
    const next = playCard(state, { type: 'release', playerId: 'A', cardId: card(state, rank).id, marbleId: id(state) });
    assert.deepEqual(location(next), { kind: 'track', position: state.players[0]!.start });
    assert.equal(next.discard.length, 1);
    assertGameState(next);
  });
  test(`${rank}: own start blocks release; unprotected opponent there is captured`, () => {
    const state = fixture([rank]); track(state, 0, state.players[0]!.start);
    const action: PlayAction = { type: 'release', playerId: 'A', cardId: card(state, rank).id, marbleId: id(state, 1) };
    rejectedUnchanged(state, action);
    set(state, 0, { kind: 'base' }); track(state, 0, state.players[0]!.start, 1);
    const next = playCard(state, action);
    assert.deepEqual(location(next, 1), { kind: 'track', position: state.players[0]!.start });
    assert.deepEqual(location(next, 0, 1), { kind: 'base' });
  });
}

test('non-A/K ranks cannot release; Ace cannot move eleven', () => {
  for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'] as Rank[]) {
    const state = fixture([rank]);
    rejectedUnchanged(state, { type: 'release', playerId: 'A', cardId: card(state, rank).id, marbleId: id(state) });
  }
  const state = fixture(['A']); track(state, 0, 10);
  rejectedUnchanged(state, move(state, 'A', [{ marbleId: id(state), steps: 11 }]));
});

test('4 is backward-only, wraps across own start, enables home-side route', () => {
  const state = fixture(['4', '3']); track(state, 0, 1);
  rejectedUnchanged(state, move(state, '4', [{ marbleId: id(state), steps: 4 }]));
  const next = runMove(state, '4', -4);
  assert.deepEqual(location(next), { kind: 'track', position: 61 });
  next.currentPlayerId = 'A';
  assert.deepEqual(location(runMove(next, '3', 3)), { kind: 'home', position: 0 });
  const legal = getLegalActions(state).filter(legal => legal.action.cardId === card(state, '4').id);
  assert.ok(legal.length > 0);
  assert.ok(legal.every(legal => legal.action.type === 'move' && legal.action.moves[0]!.steps === -4));
});

test('4 cannot move inside/out of home or completed farthest slot', () => {
  for (const position of [0, 1, 2, 3]) {
    const state = fixture(['4']); home(state, 0, position);
    rejectedUnchanged(state, move(state, '4', [{ marbleId: id(state), steps: -4 }]));
  }
});

test('7 exposes full movement and all legal ordered two-marble allocations', () => {
  const state = fixture(['7']); track(state, 0, 10); track(state, 1, 20);
  assert.deepEqual(location(runMove(state, '7', 7)), { kind: 'track', position: 17 });
  const actions = getLegalActions(state);
  for (let first = 1; first < 7; first++) {
    for (const [a, b] of [[0, 1], [1, 0]]) {
      const sequence = [{ marbleId: id(state, a), steps: first }, { marbleId: id(state, b), steps: 7 - first }];
      assert.ok(actions.some(legal => legal.action.type === 'move' && JSON.stringify(legal.action.moves) === JSON.stringify(sequence)));
      const next = playCard(state, move(state, '7', sequence));
      assert.deepEqual(location(next, a), { kind: 'track', position: (a === 0 ? 10 : 20) + first });
      assert.deepEqual(location(next, b), { kind: 'track', position: (b === 0 ? 10 : 20) + 7 - first });
      assert.equal(next.discard.length, 1);
    }
  }
});

test('7 validates ordered resulting state: vacate home before following segment enters', () => {
  const state = fixture(['7']); track(state, 0, 59); home(state, 1, 1);
  const enter = { marbleId: id(state), steps: 6 };
  const vacate = { marbleId: id(state, 1), steps: 1 };
  rejectedUnchanged(state, move(state, '7', [enter, vacate]));
  const next = playCard(state, move(state, '7', [vacate, enter]));
  assert.deepEqual(location(next), { kind: 'home', position: 1 });
  assert.deepEqual(location(next, 1), { kind: 'home', position: 2 });
  const choices = getLegalActions(state).map(legal => legal.action);
  assert.ok(choices.some(action => isDeepStrictEqual(action, move(state, '7', [vacate, enter]))));
  assert.ok(!choices.some(action => isDeepStrictEqual(action, move(state, '7', [enter, vacate]))));
});

test('7 illegal final segment rolls back earlier destination capture and movement', () => {
  const state = fixture(['7']); track(state, 0, 60); track(state, 0, 63, 1); home(state, 1, 2);
  rejectedUnchanged(state, move(state, '7', [{ marbleId: id(state), steps: 3 }, { marbleId: id(state, 1), steps: 4 }]));
});

test('7 rejects wrong totals, repeat marble, third marble, and zero/negative allocation', () => {
  const state = fixture(['7']); track(state, 0, 10); track(state, 1, 20); track(state, 2, 40);
  for (const moves of [
    [{ marbleId: id(state), steps: 6 }],
    [{ marbleId: id(state), steps: 8 }],
    [{ marbleId: id(state), steps: 1 }, { marbleId: id(state), steps: 6 }],
    [{ marbleId: id(state), steps: 1 }, { marbleId: id(state, 1), steps: 2 }, { marbleId: id(state, 2), steps: 4 }],
    [{ marbleId: id(state), steps: 0 }, { marbleId: id(state, 1), steps: 7 }],
    [{ marbleId: id(state), steps: -1 }, { marbleId: id(state, 1), steps: 8 }],
  ]) rejectedUnchanged(state, move(state, '7', moves));
});

function swap(state: GameState, ownIndex = 0, opponentIndex = 0): PlayAction {
  return { type: 'swap', playerId: 'A', cardId: card(state, 'J').id, ownMarbleId: id(state, ownIndex), opponentMarbleId: id(state, opponentIndex, 1) };
}
test('Jack swaps track positions without movement/capture, exposes pair', () => {
  const state = fixture(['J']); track(state, 0, 17); track(state, 0, 43, 1); track(state, 1, 25, 1);
  const before = structuredClone(state);
  const next = playCard(state, swap(state));
  assert.deepEqual(location(next), { kind: 'track', position: 43 });
  assert.deepEqual(location(next, 0, 1), { kind: 'track', position: 17 });
  assert.deepEqual(location(next, 1, 1), { kind: 'track', position: 25 });
  assert.deepEqual(state, before);
  const legal = getLegalActions(state).find(legal => isDeepStrictEqual(legal.action, swap(state)));
  assert.ok(legal); assert.deepEqual(legal.paths, []); assert.deepEqual(legal.capturedMarbleIds, []);
});

test('Jack rejects base, home, and protected starts on either side', () => {
  for (const owner of [0, 1]) for (const kind of ['base', 'home', 'protected'] as const) {
    const state = fixture(['J']); track(state, 0, 17); track(state, 0, 43, 1);
    if (kind === 'base') set(state, 0, { kind: 'base' }, owner);
    if (kind === 'home') home(state, 0, 1, owner);
    if (kind === 'protected') track(state, 0, state.players[owner]!.start, owner);
    rejectedUnchanged(state, swap(state));
  }
});

test('Queen waits for the opponent to choose a discard, never moves +12', () => {
  const state = fixture(['Q', '2'], ['3', '6']); track(state, 0, 10);
  const opponentHand = structuredClone(state.players[1]!.hand);
  rejectedUnchanged(state, move(state, 'Q', [{ marbleId: id(state), steps: 12 }]));
  const next = playCard(state, { type: 'queen', playerId: 'A', cardId: card(state, 'Q').id });
  assert.equal(next.currentPlayerId, 'B'); assert.equal(next.pendingDiscardPlayerId, 'B');
  assert.deepEqual(next.players[1]!.hand, opponentHand);
  assert.deepEqual(location(next), location(state));
  const discarded = discardCard(next, { type: 'discard', playerId: 'B', cardId: opponentHand[0]!.id });
  assert.equal(discarded.currentPlayerId, 'A');
  assert.equal(discarded.pendingDiscardPlayerId, null);
  assert.equal(runMove(discarded, '2', 2).currentPlayerId, 'B');
});

test('Queen effect clears for an empty hand and before a redeal', () => {
  const state = fixture(['Q', '2'], []);
  const next = playCard(state, { type: 'queen', playerId: 'A', cardId: card(state, 'Q').id });
  assert.equal(next.currentPlayerId, 'A'); assert.equal(next.pendingDiscardPlayerId, null);
  const lastQueen = fixture(['Q'], []);
  const redealt = playCard(lastQueen, { type: 'queen', playerId: 'A', cardId: card(lastQueen, 'Q').id });
  assert.equal(redealt.handNumber, 2); assert.equal(redealt.currentPlayerId, 'B');
  assert.equal(redealt.pendingDiscardPlayerId, null);
});

test('King kills multiple opponents and own marble in travelled order, including destination', () => {
  const state = fixture(['K']); track(state, 0, 10); track(state, 0, 13, 1); track(state, 1, 15); track(state, 1, 23, 1);
  const choices = getLegalActions(state);
  const choice = choices.find(legal => legal.action.type === 'move' && legal.action.moves[0]!.marbleId === id(state));
  assert.ok(choice);
  assert.deepEqual(choice.capturedMarbleIds, [id(state, 0, 1), id(state, 1), id(state, 1, 1)]);
  assert.equal(choice.paths[0]!.positions.length, 13);
  assert.deepEqual(choice.paths[0]!.positions[12], { kind: 'track', position: 23 });
  const next = runMove(state, 'K', 13);
  assert.deepEqual(location(next), { kind: 'track', position: 23 });
  assert.deepEqual(location(next, 0, 1), { kind: 'base' });
  assert.deepEqual(location(next, 1), { kind: 'base' });
  assert.deepEqual(location(next, 1, 1), { kind: 'base' });
  assertGameState(next);
});

test('King can land on and kill own unprotected destination', () => {
  const state = fixture(['K']); track(state, 0, 10); track(state, 1, 23);
  const next = runMove(state, 'K', 13);
  assert.deepEqual(location(next, 1), { kind: 'base' });
  assert.deepEqual(location(next), { kind: 'track', position: 23 });
});

test('King protected start blocks path atomically after earlier kill', () => {
  const state = fixture(['K']); track(state, 0, 20); track(state, 0, 24, 1); track(state, 1, 32, 1);
  rejectedUnchanged(state, move(state, 'K', [{ marbleId: id(state), steps: 13 }]));
  assert.deepEqual(location(state, 0, 1), { kind: 'track', position: 24 });
});

test('normal destination capture, passing ordinary own/opponent marbles does not capture', () => {
  const state = fixture(['8']); track(state, 0, 10); track(state, 0, 12, 1); track(state, 1, 14); track(state, 1, 18, 1);
  const next = runMove(state, '8', 8);
  assert.deepEqual(location(next), { kind: 'track', position: 18 });
  assert.deepEqual(location(next, 0, 1), { kind: 'track', position: 12 });
  assert.deepEqual(location(next, 1), { kind: 'track', position: 14 });
  assert.deepEqual(location(next, 1, 1), { kind: 'base' });
});

test('normal own destination is illegal; protected opponent blocks landing and passage', () => {
  const own = fixture(['2']); track(own, 0, 10); track(own, 1, 12);
  rejectedUnchanged(own, move(own, '2', [{ marbleId: id(own), steps: 2 }]));
  for (const origin of [30, 31]) {
    const state = fixture(['2']); track(state, 0, origin); track(state, 0, 32, 1);
    rejectedUnchanged(state, move(state, '2', [{ marbleId: id(state), steps: 2 }]));
  }
});

test('protection is owner plus own start, not another player standing on that start', () => {
  const backward = fixture(['4']); track(backward, 0, 4); track(backward, 0, 0, 1);
  const next = runMove(backward, '4', -4);
  assert.deepEqual(location(next), { kind: 'track', position: 0 });
  assert.deepEqual(location(next, 0, 1), { kind: 'base' });
});

test('private home entry is player-relative for both players; mandatory at route boundary', () => {
  const state = fixture(['3'], ['3']); track(state, 0, 62); track(state, 0, 30, 1);
  assert.deepEqual(location(runMove(state, '3', 3)), { kind: 'home', position: 1 });
  state.currentPlayerId = 'B';
  const next = playCard(state, { type: 'move', playerId: 'B', cardId: card(state, '3', 1).id, moves: [{ marbleId: id(state, 0, 1), steps: 3 }] });
  assert.deepEqual(location(next, 0, 1), { kind: 'home', position: 1 });
  // A passes B's home entrance on the ordinary shared route, without entering B home.
  const passing = fixture(['3']); track(passing, 0, 30);
  assert.deepEqual(location(runMove(passing, '3', 3)), { kind: 'track', position: 33 });
});

test('home overshoot, occupied landing, and occupied passage are rejected', () => {
  const overshoot = fixture(['8']); track(overshoot, 0, 63);
  rejectedUnchanged(overshoot, move(overshoot, '8', [{ marbleId: id(overshoot), steps: 8 }]));
  for (const occupied of [0, 1]) {
    const state = fixture(['2']); track(state, 0, 63); home(state, 1, occupied);
    rejectedUnchanged(state, move(state, '2', [{ marbleId: id(state), steps: 2 }]));
  }
  const within = fixture(['2']); home(within, 0, 0);
  assert.deepEqual(location(runMove(within, '2', 2)), { kind: 'home', position: 2 });
});

test('King cannot kill home occupant; later home collision rolls back earlier track kill', () => {
  const state = fixture(['K']); track(state, 0, 52); track(state, 0, 55, 1); home(state, 1, 0);
  rejectedUnchanged(state, move(state, 'K', [{ marbleId: id(state), steps: 13 }]));
});

test('no legal cards exposes explicit discard choices; discard consumes without effect', () => {
  const state = fixture(['2', '3']);
  assert.deepEqual(getLegalCards(state), []);
  const actions = getLegalActions(state);
  assert.equal(actions.length, 2); assert.ok(actions.every(legal => legal.action.type === 'discard'));
  const next = discardCard(state, { type: 'discard', playerId: 'A', cardId: card(state, '3').id });
  assert.equal(next.players[0]!.hand.length, 1); assert.equal(next.discard[0]!.rank, '3');
  assert.equal(next.currentPlayerId, 'B');
  assert.ok(next.players.flatMap(player => player.marbles).every(marble => marble.location.kind === 'base'));
});

test('voluntary discard/pass rejected when any legal action exists, including Queen', () => {
  for (const ranks of [['2', 'A'], ['2', 'Q']] as Rank[][]) {
    const state = fixture(ranks); const before = structuredClone(state);
    assert.throws(() => discardCard(state, { type: 'discard', playerId: 'A', cardId: card(state, '2').id }), RuleError);
    assert.throws(() => endTurn(state), RuleError);
    assert.deepEqual(state, before);
    assert.equal(getLegalCards(state).length, 1);
    assert.ok(getLegalActions(state).every(legal => legal.action.type !== 'discard'));
  }
});

test('empty scheduled hands pass; completed hands redeal and alternate starter', () => {
  const state = fixture(['2'], ['3', '6']); track(state, 0, 10); track(state, 0, 40, 1);
  const next = runMove(state, '2', 2);
  const afterB = playCard(next, { type: 'move', playerId: 'B', cardId: card(next, '3', 1).id, moves: [{ marbleId: id(next, 0, 1), steps: 3 }] });
  assert.equal(afterB.currentPlayerId, 'B');
  const redealt = playCard(afterB, { type: 'move', playerId: 'B', cardId: card(afterB, '6', 1).id, moves: [{ marbleId: id(afterB, 0, 1), steps: 6 }] });
  assert.equal(redealt.handNumber, 2); assert.equal(redealt.handStarterIndex, 1); assert.equal(redealt.currentPlayerId, 'B');
  assert.deepEqual(redealt.players.map(player => player.hand.length), [5, 5]);
  const empty = structuredClone(redealt);
  empty.discard.push(...empty.players.flatMap(player => player.hand));
  empty.players.forEach(player => { player.hand = []; });
  const third = endTurn(empty);
  assert.equal(third.handNumber, 3); assert.equal(third.currentPlayerId, 'A');
  assertGameState(third);
});

test('reshuffle preserves remaining undealt cards and all 52 unique identities', () => {
  const state = fixture([], []);
  const leftovers = state.deck.slice(0, 2);
  state.discard = state.deck.slice(2); state.deck = leftovers;
  const before = structuredClone(state);
  const redealt = dealCards(state, { rng: () => 0.5 });
  assert.equal(redealt.deck.length, 42); assert.equal(redealt.discard.length, 0);
  assert.deepEqual(redealt.players.map(player => player.hand.length), [5, 5]);
  const ids = [...redealt.deck, ...redealt.players.flatMap(player => player.hand)].map(card => card.id);
  assert.equal(new Set(ids).size, 52);
  assert.ok(leftovers.every(card => ids.includes(card.id)));
  assert.deepEqual(state, before); assertGameState(redealt);
});

test('all four home positions finish game; further plays/discards/passes rejected', () => {
  const state = fixture(['A', '2']); track(state, 0, 63); home(state, 1, 1); home(state, 2, 2); home(state, 3, 3);
  assert.equal(checkWinner(state), null);
  const next = runMove(state, 'A', 1);
  assert.equal(next.status, 'finished'); assert.equal(next.winnerId, 'A');
  assert.equal(next.currentPlayerId, null); assert.equal(checkWinner(next), 'A');
  assert.deepEqual(getLegalActions(next), []); assert.deepEqual(getLegalCards(next), []);
  assert.throws(() => playCard(next, move(next, '2', [{ marbleId: id(next), steps: 2 }])), RuleError);
  assert.throws(() => discardCard(next, { type: 'discard', playerId: 'A', cardId: card(next, '2').id }), RuleError);
  assert.throws(() => endTurn(next), RuleError);
  assertGameState(next);
});

test('reject out-of-turn, fake card, opponent movement, base movement without mutating state', () => {
  const state = fixture(['2']); track(state, 0, 10); track(state, 0, 40, 1);
  const valid = move(state, '2', [{ marbleId: id(state), steps: 2 }]);
  rejectedUnchanged(state, { ...valid, playerId: 'B' });
  rejectedUnchanged(state, { ...valid, cardId: 'missing-card' });
  rejectedUnchanged(state, move(state, '2', [{ marbleId: id(state, 0, 1), steps: 2 }]));
  rejectedUnchanged(state, move(state, '2', [{ marbleId: id(state, 1), steps: 2 }]));
});

test('legal choices are executable previews and detached from authoritative state', () => {
  const state = fixture(['A', '7', 'J', 'Q', 'K']); track(state, 0, 10); track(state, 1, 20); track(state, 0, 43, 1);
  const before = structuredClone(state);
  const actions = getLegalActions(state);
  assert.ok(actions.length > 0);
  for (const legal of actions) {
    const next = applyAction(state, legal.action);
    assertGameState(next);
    for (const destination of legal.destinations) assert.deepEqual(marbleById(next, destination.marbleId).location, destination.location);
    for (const captured of legal.capturedMarbleIds) assert.deepEqual(marbleById(next, captured).location, { kind: 'base' });
  }
  actions[0]!.action.cardId = 'changed';
  const current = getCurrentPlayer(state)!; current.hand.length = 0;
  assert.deepEqual(state, before);
});

test('geometry is centralized: smaller opposite-start fixture uses same movement logic', () => {
  const state = startGame(createGame(['A', 'B'], { deck: createDeck(), board: { trackSize: 40, starts: [5, 25], marblesPerPlayer: 4, homeSize: 4 } }));
  const cardA = state.players[0]!.hand.find(card => card.rank === '3')!;
  track(state, 0, 3);
  const next = playCard(state, { type: 'move', playerId: 'A', cardId: cardA.id, moves: [{ marbleId: id(state), steps: 3 }] });
  assert.deepEqual(location(next), { kind: 'home', position: 1 });
});

test('regression: malformed movement segments reject as rule errors without partial changes', () => {
  const state = fixture(['2']); track(state, 0, 10);
  for (const moves of [[null], [{}], [{ marbleId: id(state), steps: '2' }]]) {
    rejectedUnchanged(state, { type: 'move', playerId: 'A', cardId: card(state, '2').id, moves } as unknown as PlayAction);
  }
});
