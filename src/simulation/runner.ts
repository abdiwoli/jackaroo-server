import assert from 'node:assert/strict';
import { applyAction, assertGameState, createGame, getLegalActions, startGame } from '../jackaroo/engine.js';
import { RANKS, type GameState, type LegalAction, type Rank } from '../jackaroo/types.js';
import { requireRule, RuleError } from '../jackaroo/rules.js';
import { seededRng } from './random.js';
import { selectAction, type Policy } from './policy.js';
import { auditTransition } from './audit.js';

export interface SimulationOptions { seed: number; policy?: Policy; maxActions?: number; trace?: boolean }
export interface TraceEntry {
  step: number;
  hand: number;
  actor: string;
  cardRank: Rank;
  choice: LegalAction;
  state: GameState;
}
export interface SimulationResult {
  seed: number; policy: Policy; winnerId: string; actions: number; hands: number;
  redeals: number; reshuffles: number; captures: number; ownKingKills: number;
  homeEntries: number; emptyPasses: number; queenSkips: number; splitSevens: number;
  releases: number; swaps: number; discards: number; normalCaptures: number;
  kingCaptures: number; releaseCaptures: number; rejectedProbes: number;
  playedRanks: Record<Rank, number>;
  finalState: GameState;
  trace?: { initialState: GameState; steps: TraceEntry[] };
}

export function simulateGame(options: SimulationOptions): SimulationResult {
  const maxActions = options.maxActions ?? 5000;
  requireRule(Number.isSafeInteger(maxActions) && maxActions > 0, 'Action limit must be a positive integer');
  const policy = options.policy ?? 'mixed';
  requireRule(['progress', 'mixed', 'random'].includes(policy), 'Unknown bot policy');
  const deckRng = seededRng(options.seed);
  const choiceRng = seededRng((options.seed ^ 0x9e3779b9) >>> 0);
  let state = startGame(createGame(['Player A', 'Player B'], { rng: deckRng }));
  assertGameState(state);
  assert.equal(state.currentPlayerId, state.players[0]!.id);
  const result: SimulationResult = {
    seed: options.seed, policy, winnerId: '', actions: 0, hands: 1,
    redeals: 0, reshuffles: 0, captures: 0, ownKingKills: 0, homeEntries: 0,
    emptyPasses: 0, queenSkips: 0, splitSevens: 0, releases: 0,
    swaps: 0, discards: 0, normalCaptures: 0, kingCaptures: 0,
    releaseCaptures: 0, rejectedProbes: 0,
    playedRanks: Object.fromEntries(RANKS.map(rank => [rank, 0])) as Record<Rank, number>,
    finalState: state,
    ...(options.trace ? { trace: { initialState: structuredClone(state), steps: [] } } : {}),
  };
  try {
    while (state.status === 'playing' && result.actions < maxActions) {
      const snapshot = structuredClone(state);
      const choices = getLegalActions(state);
      assert.deepEqual(state, snapshot, 'Generating legal actions cannot mutate state');
      const choice = selectAction(state, choices, choiceRng, policy);
      const actor = state.players.find(player => player.id === choice.action.playerId)!;
      const card = actor.hand.find(card => card.id === choice.action.cardId)!;
      // Rejected action probes during real games, without changing state or RNG.
      const other = state.players.find(player => player.id !== actor.id)!;
      for (const invalid of [{ ...choice.action, playerId: other.id }, { ...choice.action, cardId: 'fake-card' }]) {
        assert.throws(() => applyAction(state, invalid), RuleError);
        assert.deepEqual(state, snapshot); result.rejectedProbes++;
      }
      const after = applyAction(state, choice.action, { rng: deckRng });
      assert.deepEqual(state, snapshot, 'Committing a legal action cannot mutate input');
      const audit = auditTransition(state, choice, after);
      result.actions++;
      result.redeals += Number(audit.redeal); result.reshuffles += Number(audit.reshuffle);
      result.captures += audit.captures; result.ownKingKills += audit.ownKingKills;
      result.homeEntries += audit.homeEntries; result.emptyPasses += audit.emptyPasses;
      const action = choice.action;
      if (action.type === 'discard') result.discards++;
      else {
        result.playedRanks[card.rank]++;
        if (action.type === 'queen') result.queenSkips++;
        if (action.type === 'release') { result.releases++; result.releaseCaptures += audit.captures; }
        if (action.type === 'swap') result.swaps++;
        if (action.type === 'move') {
          if (card.rank === '7' && action.moves.length === 2) result.splitSevens++;
          if (card.rank === 'K') result.kingCaptures += audit.captures;
          else result.normalCaptures += audit.captures;
        }
      }
      result.trace?.steps.push({ step: result.actions, hand: state.handNumber, actor: actor.id, cardRank: card.rank, choice: structuredClone(choice), state: structuredClone(after) });
      state = after;
    }
    requireRule(state.status === 'finished', `Game did not finish within ${maxActions} actions`);
    assert.equal(getLegalActions(state).length, 0);
    const finalProbe = { type: 'queen' as const, playerId: state.winnerId!, cardId: 'fake-card' };
    assert.throws(() => applyAction(state, finalProbe), RuleError); result.rejectedProbes++;
    result.winnerId = state.winnerId!; result.hands = state.handNumber; result.finalState = state;
    return result;
  } catch (error) {
    throw new Error(`Simulation seed=${options.seed} policy=${policy} failed at action ${result.actions + 1}, hand ${state.handNumber}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
