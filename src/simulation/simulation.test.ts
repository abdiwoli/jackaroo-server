import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, getLegalActions } from '../jackaroo/engine.js';
import { exactGame, atTrack } from '../jackaroo/test-fixtures.js';
import { seededRng } from './random.js';
import { auditTransition } from './audit.js';
import { replayTrace } from './replay.js';
import { simulateGame } from './runner.js';

test('a seeded full game completes with audited redeals/reshuffles and all ranks played', () => {
  const result = simulateGame({ seed: 1, trace: true });
  assert.equal(result.finalState.status, 'finished');
  assert.ok(result.actions > 0); assert.ok(result.redeals > 0); assert.ok(result.reshuffles > 0);
  assert.equal(result.hands, result.redeals + 1);
  assert.equal(result.rejectedProbes, result.actions * 2 + 1);
  assert.equal(result.trace!.steps.length, result.actions);
  assert.ok(Object.values(result.playedRanks).every(count => count > 0));
  assert.equal(result.captures, result.normalCaptures + result.kingCaptures + result.releaseCaptures);
});

test('same seed and policy reproduce the complete game, including reshuffle state', () => {
  const first = simulateGame({ seed: 2 });
  const second = simulateGame({ seed: 2 });
  assert.deepEqual(first, second);
});

test('complete chronological trace replays to exactly the same winner and final state', () => {
  const result = simulateGame({ seed: 3, trace: true });
  assert.deepEqual(replayTrace(result.seed, result.trace!), result.finalState);
  const corrupt = structuredClone(result.trace!);
  corrupt.steps[0]!.state.deck.reverse();
  assert.throws(() => replayTrace(result.seed, corrupt), /Replay divergence/);
});

test('different bot strategies complete real seeded games', () => {
  for (const policy of ['progress', 'random'] as const) {
    const result = simulateGame({ seed: 1, policy });
    assert.equal(result.finalState.status, 'finished');
    assert.ok(result.finalState.winnerId);
    assert.ok(result.homeEntries >= result.finalState.board.marblesPerPlayer);
  }
});

test('action limit is a reported failure, never fabricated completion; bad options reject', () => {
  assert.throws(() => simulateGame({ seed: 1, maxActions: 1 }), /did not finish within 1 actions/);
  for (const maxActions of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => simulateGame({ seed: 1, maxActions }));
  for (const seed of [-1, 0.5, NaN, Infinity, 0x100000000]) assert.throws(() => seededRng(seed));
  assert.throws(() => simulateGame({ seed: 1, policy: 'invalid' as 'mixed' }));
});

test('auditor rejects plausible but incorrect turn, hand, movement, capture and metadata changes', () => {
  const before = exactGame('2'); atTrack(before, 0, 0, 10); atTrack(before, 1, 0, 12);
  const choice = getLegalActions(before).find(choice => choice.action.type === 'move')!;
  const after = applyAction(before, choice.action);
  auditTransition(before, choice, after);
  const wrongTurn = structuredClone(after); wrongTurn.currentPlayerId = 'A';
  assert.throws(() => auditTransition(before, choice, wrongTurn));
  const replacedCard = structuredClone(after);
  replacedCard.players[0]!.hand.push(replacedCard.deck.pop()!);
  assert.throws(() => auditTransition(before, choice, replacedCard));
  const wrongMarble = structuredClone(after);
  wrongMarble.players[0]!.marbles[0]!.location = { kind: 'track', position: 13 };
  assert.throws(() => auditTransition(before, choice, wrongMarble));
  const noCapture = structuredClone(after);
  noCapture.players[1]!.marbles[0]!.location = { kind: 'track', position: 14 };
  assert.throws(() => auditTransition(before, choice, noCapture));
  const wrongMetadata = structuredClone(choice); wrongMetadata.paths[0]!.positions.reverse();
  assert.throws(() => auditTransition(before, wrongMetadata, after));
});
