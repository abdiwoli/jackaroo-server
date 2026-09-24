import assert from 'node:assert/strict';
import { applyAction, createGame, startGame } from '../jackaroo/engine.js';
import { seededRng } from './random.js';
import { auditTransition } from './audit.js';
import type { SimulationResult } from './runner.js';

export function replayTrace(seed: number, trace: NonNullable<SimulationResult['trace']>) {
  const rng = seededRng(seed);
  let state = startGame(createGame(['Player A', 'Player B'], { rng }));
  assert.deepEqual(state, trace.initialState, 'Trace initial state must match seed');
  for (const entry of trace.steps) {
    const after = applyAction(state, entry.choice.action, { rng });
    auditTransition(state, entry.choice, after);
    assert.deepEqual(after, entry.state, `Replay divergence at action ${entry.step}`);
    state = after;
  }
  assert.equal(state.status, 'finished', 'Trace must end in a complete game');
  return state;
}
