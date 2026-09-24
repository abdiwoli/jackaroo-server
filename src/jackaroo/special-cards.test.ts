import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { applyAction, assertGameState, checkWinner, discardCard, getLegalActions, getLegalCards } from './engine.js';
import { SUITS, type GameAction } from './types.js';
import { actionIdentity, atHome, atTrack, choose, emptyHand, exactGame, marble, movement, put, rejectAtomic, relativeTrack } from './test-fixtures.js';

test('7: complete action set includes all four singles and every ordered distinct pair/allocation', () => {
  for (const owner of [0, 1]) for (const suit of SUITS) {
    const state = exactGame('7', owner, suit);
    [5, 15, 40, 50].forEach((position, index) => atTrack(state, owner, index, relativeTrack(state, owner, position)));
    const expected: GameAction[] = [];
    for (let first = 0; first < 4; first++) {
      expected.push(movement(state, 7, owner, first));
      for (let second = 0; second < 4; second++) {
        if (first === second) continue;
        for (let points = 1; points < 7; points++) expected.push({
          ...actionIdentity(state), type: 'move', moves: [
            { marbleId: marble(state, owner, first).id, steps: points },
            { marbleId: marble(state, owner, second).id, steps: 7 - points },
          ],
        });
      }
    }
    const choices = getLegalActions(state);
    assert.equal(expected.length, 76);
    assert.equal(choices.length, expected.length);
    for (const action of expected) {
      const preview = choose(choices, action);
      assert.ok(preview, `Missing complete sequence ${JSON.stringify(action)}`);
      const next = applyAction(state, action);
      assert.equal(next.discard.length, 1);
      for (const destination of preview.destinations) {
        const actual = next.players[owner]!.marbles.find(marble => marble.id === destination.marbleId)!;
        assert.deepEqual(actual.location, destination.location);
      }
      assertGameState(next);
    }
  }
});

test('7: both segments capture independently, opponents passed during segments survive', () => {
  for (const owner of [0, 1]) {
    const other = 1 - owner;
    const state = exactGame('7', owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    atTrack(state, owner, 1, relativeTrack(state, owner, 40));
    for (const [index, relative] of [[0, 11], [1, 12], [2, 42], [3, 45]]) atTrack(state, other, index!, relativeTrack(state, owner, relative!));
    const action: GameAction = { ...actionIdentity(state), type: 'move', moves: [
      { marbleId: marble(state, owner).id, steps: 2 }, { marbleId: marble(state, owner, 1).id, steps: 5 },
    ] };
    const preview = choose(getLegalActions(state), action)!;
    assert.deepEqual(preview.capturedMarbleIds, [marble(state, other, 1).id, marble(state, other, 3).id]);
    const next = applyAction(state, action);
    for (const index of [1, 3]) assert.deepEqual(marble(next, other, index).location, { kind: 'base' });
    for (const index of [0, 2]) assert.equal(marble(next, other, index).location.kind, 'track');
    assertGameState(next);
  }
});

test('7: reverse order changes home legality; illegal order never exposed and rolls back', () => {
  for (const owner of [0, 1]) for (let points = 1; points <= 3; points++) {
    const state = exactGame('7', owner);
    atHome(state, owner, 0, 0);
    const remaining = 7 - points;
    atTrack(state, owner, 1, relativeTrack(state, owner, state.board.trackSize - remaining));
    const vacate = { marbleId: marble(state, owner).id, steps: points };
    const enter = { marbleId: marble(state, owner, 1).id, steps: remaining };
    const legal: GameAction = { ...actionIdentity(state), type: 'move', moves: [vacate, enter] };
    const illegal: GameAction = { ...actionIdentity(state), type: 'move', moves: [enter, vacate] };
    const choices = getLegalActions(state);
    assert.ok(choose(choices, legal)); assert.equal(choose(choices, illegal), undefined);
    rejectAtomic(state, illegal);
    const next = applyAction(state, legal);
    assert.deepEqual(marble(next, owner).location, { kind: 'home', position: points });
    assert.deepEqual(marble(next, owner, 1).location, { kind: 'home', position: 0 });
  }
});

test('7: protected block in segment two restores segment-one capture and all piles/turns', () => {
  for (const owner of [0, 1]) {
    const other = 1 - owner;
    const state = exactGame('7', owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    atTrack(state, other, 0, relativeTrack(state, owner, 12));
    atTrack(state, owner, 1, relativeTrack(state, owner, 30));
    atTrack(state, other, 1, state.players[other]!.start);
    const action: GameAction = { ...actionIdentity(state), type: 'move', moves: [
      { marbleId: marble(state, owner).id, steps: 2 }, { marbleId: marble(state, owner, 1).id, steps: 5 },
    ] };
    rejectAtomic(state, action);
    assert.equal(choose(getLegalActions(state), action), undefined);
  }
});

test('7: rejects unknown/opponent/base/repeated/third segments and invalid totals atomically', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('7', owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    atTrack(state, owner, 1, relativeTrack(state, owner, 20));
    atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 40));
    for (const secondId of ['missing', marble(state, 1 - owner).id, marble(state, owner, 2).id, marble(state, owner).id]) {
      rejectAtomic(state, { ...actionIdentity(state), type: 'move', moves: [
        { marbleId: marble(state, owner).id, steps: 2 }, { marbleId: secondId, steps: 5 },
      ] });
    }
    for (let first = -2; first <= 9; first++) for (let second = -2; second <= 9; second++) {
      if (first > 0 && second > 0 && first + second === 7) continue;
      rejectAtomic(state, { ...actionIdentity(state), type: 'move', moves: [
        { marbleId: marble(state, owner).id, steps: first }, { marbleId: marble(state, owner, 1).id, steps: second },
      ] });
    }
  }
});

test('7: complete ordered seven-point action can win, while blocked reverse order is rejected', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('7', owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 60));
    atTrack(state, owner, 1, relativeTrack(state, owner, 62));
    atHome(state, owner, 2, 2); atHome(state, owner, 3, 3);
    const first = { marbleId: marble(state, owner).id, steps: 5 };
    const second = { marbleId: marble(state, owner, 1).id, steps: 2 };
    rejectAtomic(state, { ...actionIdentity(state), type: 'move', moves: [second, first] });
    const next = applyAction(state, { ...actionIdentity(state), type: 'move', moves: [first, second] });
    assert.equal(next.status, 'finished'); assert.equal(next.winnerId, state.players[owner]!.id);
    assert.equal(next.discard.length, 1); assert.equal(next.handNumber, 1);
    assert.equal(checkWinner(next), state.players[owner]!.id);
    assertGameState(next);
  }
});

test('Jack: every distinct track-position pair for both players swaps unless either own start is protected', () => {
  for (const owner of [0, 1]) {
    const template = exactGame('J', owner);
    const other = 1 - owner;
    for (let ownPosition = 0; ownPosition < template.board.trackSize; ownPosition++) {
      for (let otherPosition = 0; otherPosition < template.board.trackSize; otherPosition++) {
        if (ownPosition === otherPosition) continue;
        const state = structuredClone(template);
        atTrack(state, owner, 0, ownPosition); atTrack(state, other, 0, otherPosition);
        const action: GameAction = { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, owner).id, opponentMarbleId: marble(state, other).id };
        if (ownPosition === state.players[owner]!.start || otherPosition === state.players[other]!.start) rejectAtomic(state, action);
        else {
          const next = applyAction(state, action);
          assert.deepEqual(marble(next, owner).location, { kind: 'track', position: otherPosition });
          assert.deepEqual(marble(next, other).location, { kind: 'track', position: ownPosition });
          assertGameState(next);
        }
      }
    }
  }
});

test('Jack: all suits expose exactly the valid own/opponent pairs, with empty path/capture previews', () => {
  for (const owner of [0, 1]) for (const suit of SUITS) {
    const state = exactGame('J', owner, suit);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    atTrack(state, owner, 1, relativeTrack(state, owner, 20));
    atTrack(state, owner, 2, state.players[owner]!.start);
    atHome(state, owner, 3, 3);
    const other = 1 - owner;
    atTrack(state, other, 0, relativeTrack(state, owner, 40));
    atTrack(state, other, 1, relativeTrack(state, owner, 50));
    atTrack(state, other, 2, state.players[other]!.start);
    const choices = getLegalActions(state);
    assert.equal(choices.length, 4);
    for (const ownIndex of [0, 1]) for (const otherIndex of [0, 1]) {
      const action: GameAction = { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, owner, ownIndex).id, opponentMarbleId: marble(state, other, otherIndex).id };
      const preview = choose(choices, action)!;
      assert.ok(preview); assert.deepEqual(preview.paths, []); assert.deepEqual(preview.capturedMarbleIds, []);
      assertGameState(applyAction(state, action));
    }
  }
});

test('Jack: every base/home/protected combination and wrong owner pairing is rejected', () => {
  for (const owner of [0, 1]) for (const targetOwner of [owner, 1 - owner]) {
    for (const location of [{ kind: 'base' }, ...[0, 1, 2, 3].map(position => ({ kind: 'home' as const, position })), { kind: 'track', position: -1 }] as const) {
      const state = exactGame('J', owner);
      atTrack(state, owner, 0, relativeTrack(state, owner, 10)); atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 40));
      put(state, targetOwner, 0, location.kind === 'track' ? { kind: 'track', position: state.players[targetOwner]!.start } : location);
      rejectAtomic(state, { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, owner).id, opponentMarbleId: marble(state, 1 - owner).id });
    }
    const state = exactGame('J', owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10)); atTrack(state, owner, 1, relativeTrack(state, owner, 20)); atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 40));
    for (const opponentMarbleId of [marble(state, owner).id, marble(state, owner, 1).id, 'unknown']) rejectAtomic(state, {
      ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, owner).id, opponentMarbleId,
    });
    rejectAtomic(state, { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state, 1 - owner).id, opponentMarbleId: marble(state, owner).id });
  }
});

test('Jack: relocation changes the next relative route without travelled steps or intermediate blocking', () => {
  const state = exactGame('J'); atTrack(state, 0, 0, 10); atTrack(state, 1, 0, 63); atTrack(state, 1, 1, 32);
  const action: GameAction = { ...actionIdentity(state), type: 'swap', ownMarbleId: marble(state).id, opponentMarbleId: marble(state, 1).id };
  assertGameState(applyAction(state, action)); // Protected intervening start does not block a relocation.
  const next = applyAction(state, action);
  const aceIndex = next.deck.findIndex(card => card.rank === 'A');
  next.players[0]!.hand.push(next.deck.splice(aceIndex, 1)[0]!);
  next.currentPlayerId = 'A';
  const home = applyAction(next, movement(next, 1));
  assert.deepEqual(marble(home).location, { kind: 'home', position: 0 });
});

test('Queen: all suits/owners/hand boundaries require one chosen discard and respect alternating starters', () => {
  for (const owner of [0, 1]) for (const suit of SUITS) for (const ownExtra of [false, true]) for (const otherEmpty of [false, true]) for (const starter of [0, 1]) {
    const state = exactGame('Q', owner, suit);
    const other = 1 - owner;
    state.handStarterIndex = starter; state.handNumber = starter + 1;
    if (ownExtra) {
      const index = state.deck.findIndex(card => card.rank === '2');
      state.players[owner]!.hand.push(state.deck.splice(index, 1)[0]!);
    }
    if (otherEmpty) emptyHand(state, other);
    const opponentHand = structuredClone(state.players[other]!.hand);
    const next = applyAction(state, { ...actionIdentity(state), type: 'queen' });
    assert.equal(next.pendingDiscardPlayerId, otherEmpty ? null : state.players[other]!.id);
    assert.ok(next.players.flatMap(player => player.marbles).every(marble => marble.location.kind === 'base'));
    if (!ownExtra && otherEmpty) {
      assert.equal(next.handNumber, state.handNumber + 1);
      assert.equal(next.currentPlayerId, state.players[1 - starter]!.id);
      assert.deepEqual(next.players.map(player => player.hand.length), [5, 5]);
    } else {
      assert.deepEqual(next.players[other]!.hand, opponentHand);
      assert.equal(next.currentPlayerId, state.players[otherEmpty ? owner : other]!.id);
      assert.equal(next.handNumber, state.handNumber);
    }
    assertGameState(next);
    if (ownExtra && !otherEmpty) {
      const after = applyAction(next, { type: 'discard', playerId: next.currentPlayerId!, cardId: opponentHand[0]!.id });
      assert.equal(after.currentPlayerId, state.players[owner]!.id);
      assert.equal(after.pendingDiscardPlayerId, null);
    }
  }
});

test('Queen: blocked movement does not prevent legal Queen; forced discard is forbidden', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('Q', owner);
    atHome(state, owner, 0, 3);
    const choices = getLegalActions(state);
    assert.equal(choices.length, 1); assert.equal(choices[0]!.action.type, 'queen');
    assert.equal(getLegalCards(state).length, 1);
    rejectAtomic(state, { ...actionIdentity(state), type: 'discard' });
  }
});

test('King: own/opponent kills at each of thirteen positions, every owner/suit; moving marble survives', () => {
  for (const owner of [0, 1]) for (const suit of SUITS) for (let step = 1; step <= 13; step++) for (const targetOwner of [owner, 1 - owner]) {
    const state = exactGame('K', owner, suit);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    const targetIndex = targetOwner === owner ? 1 : 0;
    atTrack(state, targetOwner, targetIndex, relativeTrack(state, owner, 10 + step));
    const action = movement(state, 13, owner);
    const preview = choose(getLegalActions(state), action)!;
    assert.deepEqual(preview.capturedMarbleIds, [marble(state, targetOwner, targetIndex).id]);
    assert.equal(preview.paths[0]!.positions.length, 13);
    const next = applyAction(state, action);
    assert.deepEqual(marble(next, targetOwner, targetIndex).location, { kind: 'base' });
    assert.deepEqual(marble(next, owner).location, { kind: 'track', position: relativeTrack(state, owner, 23) });
    assertGameState(next);
  }
});

test('King: all seven other marbles can be killed in path order independent of player array order', () => {
  for (const owner of [0, 1]) {
    const state = exactGame('K', owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10));
    const targets = [marble(state, 1 - owner, 3), marble(state, owner, 2), marble(state, 1 - owner, 0), marble(state, owner, 1), marble(state, 1 - owner, 2), marble(state, owner, 3), marble(state, 1 - owner, 1)];
    const offsets = [1, 2, 3, 5, 7, 11, 13];
    targets.forEach((target, index) => { target.location = { kind: 'track', position: relativeTrack(state, owner, 10 + offsets[index]!) }; });
    const action = movement(state, 13, owner);
    const preview = choose(getLegalActions(state), action)!;
    assert.deepEqual(preview.capturedMarbleIds, targets.map(target => target.id));
    const next = applyAction(state, action);
    assert.equal(next.players.flatMap(player => player.marbles).filter(marble => marble.location.kind === 'base').length, 7);
    assertGameState(next);
  }
});

test('King: protected block at every path offset rejects the whole move and is never offered', () => {
  for (const owner of [0, 1]) for (let blockedStep = 1; blockedStep <= 13; blockedStep++) {
    const state = exactGame('K', owner);
    const other = 1 - owner;
    atTrack(state, owner, 0, relativeTrack(state, owner, state.board.trackSize / 2 - blockedStep));
    atTrack(state, other, 0, state.players[other]!.start);
    if (blockedStep > 1) atTrack(state, owner, 1, relativeTrack(state, owner, state.board.trackSize / 2 - blockedStep + 1));
    const action = movement(state, 13, owner);
    rejectAtomic(state, action);
    assert.equal(choose(getLegalActions(state), action), undefined);
  }
});

test('King: own protected moving marble may leave start; own home marbles block, opponent home remains safe', () => {
  for (const owner of [0, 1]) {
    const fromStart = exactGame('K', owner);
    atTrack(fromStart, owner, 0, fromStart.players[owner]!.start);
    assert.deepEqual(marble(applyAction(fromStart, movement(fromStart, 13, owner)), owner).location, { kind: 'track', position: relativeTrack(fromStart, owner, 13) });
    for (let homePosition = 0; homePosition < 4; homePosition++) {
      const state = exactGame('K', owner);
      atTrack(state, owner, 0, relativeTrack(state, owner, 54));
      atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 55));
      atHome(state, owner, 1, homePosition);
      rejectAtomic(state, movement(state, 13, owner));
      const safe = exactGame('K', owner);
      atTrack(safe, owner, 0, relativeTrack(safe, owner, 54));
      atHome(safe, 1 - owner, 0, homePosition);
      const next = applyAction(safe, movement(safe, 13, owner));
      assert.deepEqual(marble(next, owner).location, { kind: 'home', position: 3 });
      assert.deepEqual(marble(next, 1 - owner).location, { kind: 'home', position: homePosition });
    }
  }
});

test('all generated special-card previews are detached and describe committed moves/kills exactly', () => {
  for (const rank of ['7', 'J', 'Q', 'K'] as const) for (const owner of [0, 1]) {
    const state = exactGame(rank, owner);
    atTrack(state, owner, 0, relativeTrack(state, owner, 10)); atTrack(state, owner, 1, relativeTrack(state, owner, 20));
    atTrack(state, 1 - owner, 0, relativeTrack(state, owner, 13)); atTrack(state, 1 - owner, 1, relativeTrack(state, owner, 45));
    const snapshot = structuredClone(state);
    for (const choice of getLegalActions(state)) {
      const next = applyAction(state, choice.action);
      for (const destination of choice.destinations) {
        const actual = next.players.flatMap(player => player.marbles).find(marble => marble.id === destination.marbleId)!;
        assert.deepEqual(actual.location, destination.location);
      }
      for (const capture of choice.capturedMarbleIds) {
        const actual = next.players.flatMap(player => player.marbles).find(marble => marble.id === capture)!;
        assert.deepEqual(actual.location, { kind: 'base' });
      }
      assertGameState(next);
    }
    assert.ok(isDeepStrictEqual(state, snapshot));
  }
});

test('regression: direct discardCard rejects null with RuleError and unchanged state', () => {
  const state = exactGame('2');
  const snapshot = structuredClone(state);
  assert.throws(() => discardCard(state, null as unknown as Parameters<typeof discardCard>[1]), { name: 'RuleError' });
  assert.deepEqual(state, snapshot);
});
