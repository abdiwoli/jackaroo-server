import type { GameState, LegalAction, Location, RNG } from '../jackaroo/types.js';
import { requireRule } from '../jackaroo/rules.js';

export type Policy = 'progress' | 'mixed' | 'random';

function value(state: GameState, ownerId: string, location: Location) {
  if (location.kind === 'base') return 0;
  if (location.kind === 'home') return state.board.trackSize * 2 + (location.position + 1) * 20;
  const owner = state.players.find(player => player.id === ownerId)!;
  return 5 + (location.position - owner.start + state.board.trackSize) % state.board.trackSize;
}

// Bots choose only from authoritative legal actions; this is a strategy, not legality logic.
export function selectAction(state: GameState, choices: LegalAction[], rng: RNG, policy: Policy): LegalAction {
  requireRule(choices.length > 0, 'Playing game has no action choices');
  if (policy === 'random' || (policy === 'mixed' && rng() < 0.15)) return choices[Math.floor(rng() * choices.length)]!;
  const marbles = state.players.flatMap(player => player.marbles);
  function score(choice: LegalAction) {
    let result = 0;
    for (const destination of choice.destinations) {
      const marble = marbles.find(marble => marble.id === destination.marbleId)!;
      const change = value(state, marble.playerId, destination.location) - value(state, marble.playerId, marble.location);
      result += marble.playerId === state.currentPlayerId ? change : -change * 0.35;
    }
    for (const id of choice.capturedMarbleIds) {
      const marble = marbles.find(marble => marble.id === id)!;
      result += marble.playerId === state.currentPlayerId ? -value(state, marble.playerId, marble.location) : value(state, marble.playerId, marble.location) * 0.35;
    }
    if (choice.action.type === 'queen' || choice.action.type === 'ten-discard') result += 2;
    return result;
  }
  let best = -Infinity;
  let tied: LegalAction[] = [];
  for (const choice of choices) {
    const points = score(choice);
    if (points > best) { best = points; tied = [choice]; }
    else if (points === best) tied.push(choice);
  }
  return tied[Math.floor(rng() * tied.length)]!;
}
