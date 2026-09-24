import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, assertGameState, getLegalActions } from './engine.js';
import { RANKS, SUITS, type GameAction, type Location } from './types.js';
import { actionIdentity, atHome, atTrack, choose, exactGame, marble, movement, put, rejectAtomic, relativeTrack } from './test-fixtures.js';

// Expectations use relative route endpoints, independently of the engine's step walker.
const FORWARD = [['A', 1], ['2', 2], ['3', 3], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['K', 13]] as const;

for (const [rank, distance] of FORWARD) {
  test(`${rank}: every track/home origin for both players has the exact legal route or overshoot rejection`, () => {
    for (const owner of [0, 1]) {
      const template = exactGame(rank, owner);
      for (let origin = 0; origin < template.board.trackSize + template.board.homeSize; origin++) {
        const state = structuredClone(template);
        const start: Location = origin < state.board.trackSize
          ? { kind: 'track', position: relativeTrack(state, owner, origin) }
          : { kind: 'home', position: origin - state.board.trackSize };
        put(state, owner, 0, start);
        const action = movement(state, distance, owner);
        const end = origin + distance;
        const legal = choose(getLegalActions(state), action);
        if (end >= state.board.trackSize + state.board.homeSize || (rank === '5' && (origin === 0 || origin >= state.board.trackSize))) {
          assert.equal(legal, undefined);
          rejectAtomic(state, action);
        }
        else {
          assert.ok(legal, `Missing ${rank} move from relative origin ${origin} for player ${owner}`);
          const snapshot = structuredClone(state);
          const next = applyAction(state, action);
          assert.deepEqual(marble(next, owner).location, end < state.board.trackSize
            ? { kind: 'track', position: relativeTrack(state, owner, end) }
            : { kind: 'home', position: end - state.board.trackSize });
          assert.deepEqual(state, snapshot);
          assertGameState(next);
          assert.equal(next.discard.filter(card => card.id === action.cardId).length, 1);
          assert.equal(legal.paths[0]!.positions.length, distance);
          assert.deepEqual(legal.destinations[0]!.location, marble(next, owner).location);
        }
      }
    }
  });
  test(`${rank}: all four suits have the same movement effect`, () => {
    for (const owner of [0, 1]) for (const suit of SUITS) {
      const state = exactGame(rank, owner, suit);
      atTrack(state, owner, 0, relativeTrack(state, owner, 10));
      const next = applyAction(state, movement(state, distance, owner));
      assert.deepEqual(marble(next, owner).location, { kind: 'track', position: relativeTrack(state, owner, 10 + distance) });
    }
  });
  test(`${rank}: base cannot move, incorrect/zero/fractional/reversed distances rejected`, () => {
    const state = exactGame(rank);
    rejectAtomic(state, movement(state, distance));
    atTrack(state, 0, 0, 10);
    for (const invalid of [0, -distance, distance + 1, distance - 0.5, NaN, Infinity]) rejectAtomic(state, movement(state, invalid));
  });
}

for (const [rank, distance] of FORWARD.filter(([rank]) => rank !== 'K')) {
  test(`${rank}: ordinary passage, destination capture/own blocking, and protected-start boundaries`, () => {
    for (const owner of [0, 1]) {
      const other = 1 - owner;
      for (let encountered = 1; encountered <= distance; encountered++) {
        for (const occupantOwner of [owner, other]) {
          const state = exactGame(rank, owner);
          atTrack(state, owner, 0, relativeTrack(state, owner, 10));
          const index = occupantOwner === owner ? 1 : 0;
          const occupantPosition = relativeTrack(state, owner, 10 + encountered);
          atTrack(state, occupantOwner, index, occupantPosition);
          const action = movement(state, distance, owner);
          if (encountered === distance && occupantOwner === owner) rejectAtomic(state, action);
          else {
            const next = applyAction(state, action);
            assert.deepEqual(marble(next, occupantOwner, index).location,
              encountered === distance ? { kind: 'base' } : { kind: 'track', position: occupantPosition });
            assertGameState(next);
          }
        }
        const blocked = exactGame(rank, owner);
        atTrack(blocked, owner, 0, relativeTrack(blocked, owner, blocked.board.trackSize / 2 - encountered));
        atTrack(blocked, other, 0, blocked.players[other]!.start);
        rejectAtomic(blocked, movement(blocked, distance, owner));
      }
    }
  });
}

test('4: every circular origin wraps backward four for both players and all suits', () => {
  for (const owner of [0, 1]) for (const suit of SUITS) {
    const template = exactGame('4', owner, suit);
    for (let origin = 0; origin < template.board.trackSize; origin++) {
      const state = structuredClone(template);
      atTrack(state, owner, 0, relativeTrack(state, owner, origin));
      const next = applyAction(state, movement(state, -4, owner));
      assert.deepEqual(marble(next, owner).location, { kind: 'track', position: relativeTrack(state, owner, origin - 4) });
      assertGameState(next);
    }
  }
});

test('4: backward passage/capture, own landing, and protected starts on either side', () => {
  for (const owner of [0, 1]) for (const occupantOwner of [owner, 1 - owner]) {
    for (let crossed = 1; crossed <= 4; crossed++) {
      const state = exactGame('4', owner);
      atTrack(state, owner, 0, relativeTrack(state, owner, 20));
      const index = occupantOwner === owner ? 1 : 0;
      const position = relativeTrack(state, owner, 20 - crossed);
      atTrack(state, occupantOwner, index, position);
      if (crossed === 4 && occupantOwner === owner) rejectAtomic(state, movement(state, -4, owner));
      else {
        const next = applyAction(state, movement(state, -4, owner));
        assert.deepEqual(marble(next, occupantOwner, index).location,
          crossed === 4 ? { kind: 'base' } : { kind: 'track', position });
      }
      const blocked = exactGame('4', owner);
      atTrack(blocked, occupantOwner, index, blocked.players[occupantOwner]!.start);
      atTrack(blocked, owner, 0, (blocked.players[occupantOwner]!.start + crossed) % blocked.board.trackSize);
      rejectAtomic(blocked, movement(blocked, -4, owner));
    }
  }
});

test('4: all home positions reject backward movement and legal actions expose no forward option', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('4', owner);
    for (let position = 0; position < state.board.homeSize; position++) {
      atHome(state, owner, 0, position);
      rejectAtomic(state, movement(state, -4, owner));
      assert.ok(getLegalActions(state).every(legal => legal.action.type === 'discard'));
    }
    atTrack(state, owner, 0, relativeTrack(state, owner, 1));
    for (const steps of [4, 0, -3, -5, -4.5]) rejectAtomic(state, movement(state, steps, owner));
    const choices = getLegalActions(state);
    assert.equal(choices.length, 1);
    assert.ok(choices.every(legal => legal.action.type === 'move' && legal.action.moves[0]!.steps === -4));
  }
});

for (const [rank, distance] of FORWARD) {
  test(`${rank}: every occupied own-home slot blocks crossing/landing; opponent home stays private`, () => {
    for (const owner of [0, 1]) for (let occupied = 0; occupied < 4; occupied++) {
      const state = exactGame(rank, owner);
      // Route finishes at the final home slot; test each home blocker along the path.
      const origin = state.board.trackSize + state.board.homeSize - 1 - distance;
      if (origin >= state.board.trackSize && occupied <= origin - state.board.trackSize) continue;
      const originLocation: Location = origin < state.board.trackSize
        ? { kind: 'track', position: relativeTrack(state, owner, origin) }
        : { kind: 'home', position: origin - state.board.trackSize };
      put(state, owner, 0, originLocation);
      atHome(state, owner, 1, occupied);
      rejectAtomic(state, movement(state, distance, owner));
      const privateState = exactGame(rank, owner);
      put(privateState, owner, 0, originLocation);
      atHome(privateState, 1 - owner, 0, occupied);
      const next = applyAction(privateState, movement(privateState, distance, owner));
      assert.deepEqual(marble(next, owner).location, { kind: 'home', position: 3 });
      assert.deepEqual(marble(next, 1 - owner).location, { kind: 'home', position: occupied });
      assertGameState(next);
    }
  });
}

test('all ranks: only A/K release; legal releases and captured starts match previews for both owners/suits', () => {
  for (const rank of RANKS) for (const owner of [0, 1]) for (const suit of SUITS) {
    const state = exactGame(rank, owner, suit);
    const action: GameAction = { ...actionIdentity(state), type: 'release', marbleId: marble(state, owner).id };
    if (rank !== 'A' && rank !== 'K') { rejectAtomic(state, action); continue; }
    const choices = getLegalActions(state);
    assert.equal(choices.filter(legal => legal.action.type === 'release').length, 4);
    assert.ok(choose(choices, action));
    const next = applyAction(state, action);
    assert.deepEqual(marble(next, owner).location, { kind: 'track', position: state.players[owner]!.start });
    const occupied = structuredClone(state);
    atTrack(occupied, owner, 1, occupied.players[owner]!.start);
    rejectAtomic(occupied, action);
    assert.ok(getLegalActions(occupied).every(legal => legal.action.type !== 'release'));
    const capture = structuredClone(state);
    atTrack(capture, 1 - owner, 0, capture.players[owner]!.start);
    const preview = choose(getLegalActions(capture), action)!;
    assert.deepEqual(preview.capturedMarbleIds, [marble(capture, 1 - owner).id]);
    assert.deepEqual(preview.paths, []);
    const captured = applyAction(capture, action);
    assert.deepEqual(marble(captured, 1 - owner).location, { kind: 'base' });
    assertGameState(captured);
    const active = structuredClone(state); atTrack(active, owner, 0, relativeTrack(active, owner, 10));
    rejectAtomic(active, action);
    rejectAtomic(state, { ...action, marbleId: marble(state, 1 - owner).id });
  }
});

test('all cards: special actions cannot be borrowed from another rank', () => {
  for (const rank of RANKS) {
    const state = exactGame(rank); atTrack(state, 0, 0, 10); atTrack(state, 1, 0, 40);
    if (rank !== 'Q') rejectAtomic(state, { ...actionIdentity(state), type: 'queen' });
    if (rank !== 'J') rejectAtomic(state, { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state).id, opponentMarbleId: marble(state, 1).id });
    if (rank === 'Q' || rank === 'J') for (const steps of [1, 11, 12, 13]) rejectAtomic(state, movement(state, steps));
  }
});

test('regression: sparse movement arrays must reject as RuleError, not bypass segment validation', () => {
  const state = exactGame('2'); atTrack(state, 0, 0, 10);
  const action = { ...actionIdentity(state), type: 'move', moves: new Array(1) } as GameAction;
  rejectAtomic(state, action);
});
