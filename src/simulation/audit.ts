import assert from 'node:assert/strict';
import type { GameState, LegalAction, Location } from '../jackaroo/types.js';
import { assertGameState } from '../jackaroo/engine.js';
import { V1_RULES } from '../jackaroo/rules.js';

export interface TransitionAudit {
  redeal: boolean;
  reshuffle: boolean;
  emptyPasses: number;
  captures: number;
  ownKingKills: number;
  homeEntries: number;
}

function ids(cards: { id: string }[]) { return cards.map(card => card.id).sort(); }

export function auditTransition(before: GameState, choice: LegalAction, after: GameState): TransitionAudit {
  assertGameState(before); assertGameState(after);
  const action = choice.action;
  assert.equal(before.status, 'playing');
  assert.equal(action.playerId, before.currentPlayerId);
  const actor = before.players.find(player => player.id === action.playerId)!;
  const played = actor.hand.find(card => card.id === action.cardId)!;
  if (before.pendingDiscardPlayerId === actor.id) assert.equal(action.type, 'discard', 'Queen target must discard without applying the card');
  assert.ok(played, 'Actor must hold the selected physical card');
  const redeal = after.handNumber === before.handNumber + 1;
  assert.ok(after.handNumber === before.handNumber || redeal, 'At most one hand transition per action');
  const remaining = before.players.map(player => player.hand.filter(card => player.id !== actor.id || card.id !== played.id));
  const bothEmpty = remaining.every(hand => hand.length === 0);
  assert.equal(redeal, bothEmpty && after.status !== 'finished');
  const needed = V1_RULES.cardsPerHand * before.players.length;
  const reshuffle = redeal && before.deck.length < needed;
  if (!redeal) {
    after.players.forEach((player, index) => assert.deepEqual(player.hand, remaining[index]));
    assert.deepEqual(after.deck, before.deck, 'No replacement draw or deck mutation mid-hand');
    assert.deepEqual(after.discard, [...before.discard, played], 'Played card enters discard once');
    assert.equal(after.handStarterIndex, before.handStarterIndex);
  } else {
    assert.equal(after.handStarterIndex, (before.handStarterIndex + 1) % before.players.length);
    assert.equal(after.currentPlayerId, after.players[after.handStarterIndex]!.id);
    assert.ok(after.players.every(player => player.hand.length === V1_RULES.cardsPerHand));
    if (reshuffle) {
      assert.equal(after.discard.length, 0);
      assert.deepEqual(ids([...after.deck, ...after.players.flatMap(player => player.hand)]), ids([...before.deck, ...before.discard, played]), 'Reshuffle preserves undealt remainder and all discards');
    } else {
      assert.deepEqual(after.deck, before.deck.slice(needed));
      after.players.forEach((player, index) => assert.deepEqual(player.hand, before.deck.slice(0, needed).filter((_, cardIndex) => cardIndex % before.players.length === index)));
      assert.deepEqual(after.discard, [...before.discard, played]);
    }
  }

  // Compare actual marble changes with supplied action metadata, and verify travelled paths
  // using relative endpoint arithmetic rather than calling the engine movement walker.
  const expected = structuredClone(before.players.flatMap(player => player.marbles));
  const byId = (id: string) => expected.find(marble => marble.id === id)!;
  const captured: string[] = [];
  const destinations: { marbleId: string; location: Location }[] = [];
  const paths: { marbleId: string; positions: Location[] }[] = [];
  function capture(id: string) {
    const target = byId(id);
    const owner = before.players.find(player => player.id === target.playerId)!;
    assert.equal(target.location.kind, 'track', 'Only active track occupants are capturable');
    assert.ok(target.location.kind === 'track' && target.location.position !== owner.start, 'Protected occupant cannot be captured');
    captured.push(id); target.location = { kind: 'base' };
  }
  if (action.type === 'jack-pass') {
    assert.equal(played.rank, 'J');
    assert.ok(before.players.filter(player => player.id !== actor.id).every(player =>
      player.marbles.every(marble => marble.location.kind !== 'track' || marble.location.position === player.start)));
  } else if (action.type === 'release') {
    const moving = byId(action.marbleId);
    assert.equal(moving.playerId, actor.id); assert.equal(moving.location.kind, 'base');
    const occupant = expected.find(marble => marble.location.kind === 'track' && marble.location.position === actor.start);
    if (occupant) { assert.notEqual(occupant.playerId, actor.id); capture(occupant.id); }
    moving.location = { kind: 'track', position: actor.start };
    destinations.push({ marbleId: moving.id, location: structuredClone(moving.location) });
  } else if (action.type === 'swap') {
    const own = byId(action.ownMarbleId); const opponent = byId(action.opponentMarbleId);
    assert.equal(own.playerId, actor.id); assert.notEqual(opponent.playerId, actor.id);
    assert.equal(own.location.kind, 'track'); assert.equal(opponent.location.kind, 'track');
    for (const target of [own, opponent]) {
      const owner = before.players.find(player => player.id === target.playerId)!;
      assert.ok(target.location.kind === 'track' && target.location.position !== owner.start);
    }
    [own.location, opponent.location] = [opponent.location, own.location];
    destinations.push({ marbleId: own.id, location: structuredClone(own.location) }, { marbleId: opponent.id, location: structuredClone(opponent.location) });
  } else if (action.type === 'move') {
    for (const segment of action.moves) {
      const moving = byId(segment.marbleId);
        const movingOwner = before.players.find(player => player.id === moving.playerId)!;
        if (played.rank === '5') {
          assert.equal(moving.location.kind, 'track');
          assert.ok(moving.location.kind === 'track' && moving.location.position !== movingOwner.start);
        } else assert.equal(moving.playerId, actor.id);
      const origin = structuredClone(moving.location);
      assert.notEqual(origin.kind, 'base');
      const positions: Location[] = [];
      for (let offset = 1; offset <= Math.abs(segment.steps); offset++) {
        let location: Location;
        if (origin.kind === 'home') {
          assert.ok(segment.steps > 0);
          location = { kind: 'home', position: origin.position + offset };
        } else {
          assert.equal(origin.kind, 'track');
            const relative = (origin.position - movingOwner.start + before.board.trackSize) % before.board.trackSize;
          const progress = relative + Math.sign(segment.steps) * offset;
            location = !(played.rank === '5' && movingOwner.id !== actor.id) && segment.steps > 0 && progress >= before.board.trackSize
            ? { kind: 'home', position: progress - before.board.trackSize }
              : { kind: 'track', position: (movingOwner.start + progress + before.board.trackSize) % before.board.trackSize };
        }
        positions.push(location);
        if (location.kind === 'home') {
          assert.ok(location.position >= 0 && location.position < before.board.homeSize);
          const position = location.position;
          assert.ok(!expected.some(other => other.id !== moving.id && other.playerId === actor.id && other.location.kind === 'home' && other.location.position === position));
        } else {
          const position = location.position;
          const occupant = expected.find(other => other.id !== moving.id && other.location.kind === 'track' && other.location.position === position);
          if (occupant) {
            const owner = before.players.find(player => player.id === occupant.playerId)!;
            assert.notEqual(position, owner.start, 'Protected start blocks traversal');
            if (played.rank === 'K') capture(occupant.id);
            else if (offset === Math.abs(segment.steps)) { assert.notEqual(occupant.playerId, movingOwner.id); capture(occupant.id); }
          }
        }
      }
      moving.location = structuredClone(positions.at(-1)!);
      paths.push({ marbleId: moving.id, positions });
      destinations.push({ marbleId: moving.id, location: structuredClone(moving.location) });
    }
  }
  assert.deepEqual(choice.paths, paths);
  assert.deepEqual(choice.capturedMarbleIds, captured);
  assert.deepEqual(choice.destinations, destinations);
  assert.deepEqual(after.players.flatMap(player => player.marbles), expected, 'Only the selected move, swap or captures change marbles');

  let emptyPasses = 0;
  if (after.status === 'finished') {
    const winner = after.players.find(player => player.id === after.winnerId)!;
    assert.ok(winner && winner.marbles.every(marble => marble.location.kind === 'home'));
    assert.deepEqual(winner.marbles.map(marble => marble.location.kind === 'home' ? marble.location.position : -1).sort((a, b) => a - b), Array.from({ length: before.board.homeSize }, (_, index) => index));
    assert.equal(after.currentPlayerId, null);
  } else {
    assert.equal(after.winnerId, null);
    assert.ok(after.players.every(player => player.marbles.some(marble => marble.location.kind !== 'home')));
    if (!redeal) {
      let scheduled = (before.players.findIndex(player => player.id === actor.id) + 1) % before.players.length;
      while (remaining[scheduled]!.length === 0) { emptyPasses++; scheduled = (scheduled + 1) % before.players.length; }
      assert.equal(after.currentPlayerId, after.players[scheduled]!.id, 'Alternation and empty-hand passing');
    }
  }
  const opponentIndex = before.players.findIndex(player => player.id !== actor.id);
  const pending = (action.type === 'queen' || action.type === 'ten-discard') && remaining[opponentIndex]!.length > 0 && after.status !== 'finished'
    ? before.players[opponentIndex]!.id : null;
  assert.equal(after.pendingDiscardPlayerId, pending, 'Queen remains pending until the target discards once');
  return {
    redeal, reshuffle, emptyPasses, captures: captured.length,
    ownKingKills: played.rank === 'K' ? captured.filter(id => byId(id).playerId === actor.id).length : 0,
    homeEntries: destinations.filter(destination => destination.location.kind === 'home' && before.players.flatMap(player => player.marbles).find(marble => marble.id === destination.marbleId)!.location.kind === 'track').length,
  };
}
