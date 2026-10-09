import type { GameState, LegalAction, Location, Marble } from './types.js';
import { isProtected, marbleById, playerById, playerTeamId, relativePosition, trackOccupant, wrap } from './board.js';
import { requireRule } from './rules.js';

function capture(marble: Marble, result: LegalAction) {
  result.capturedMarbleIds.push(marble.id);
  marble.location = { kind: 'base' };
}

// Internal draft operation. Public engine APIs always call this on a safe copy.
export function moveOnDraft(state: GameState, playerId: string, marbleId: string, steps: number, king: boolean, result: LegalAction, five = false) {
  const marble = marbleById(state, marbleId);
  const owner = playerById(state, marble.playerId);
  const actor = playerById(state, playerId);
  const enemy = playerTeamId(state, owner) !== playerTeamId(state, actor);
  requireRule(five || marble.playerId === playerId, 'Cannot move an opponent marble');
  if (five) requireRule(marble.location.kind === 'track' && !isProtected(state, marble), 'Five requires an unprotected track marble');
  const bypassHome = five && enemy;
  requireRule(marble.location.kind !== 'base', 'Base marble cannot move');
  requireRule(steps > 0 || marble.location.kind === 'track', 'Four is track-only');
  let location: Location = structuredClone(marble.location);
  const positions: Location[] = [];
  for (let step = 1; step <= Math.abs(steps); step++) {
    if (location.kind === 'track') {
      if (!bypassHome && steps > 0 && relativePosition(state.board, owner.start, location.position) === state.board.trackSize - 1) {
        location = { kind: 'home', position: 0 };
      } else {
        location = { kind: 'track', position: wrap(state.board, location.position + Math.sign(steps)) };
      }
    } else {
      requireRule(location.kind === 'home' && steps > 0, 'Invalid home movement');
      location = { kind: 'home', position: location.position + 1 };
    }
    positions.push(structuredClone(location));
    if (location.kind === 'home') {
      requireRule(location.position < state.board.homeSize, 'Home overshoot');
      const homePosition = location.position;
      requireRule(!owner.marbles.some(other => other.id !== marbleId && other.location.kind === 'home' && other.location.position === homePosition), 'Home position blocks movement');
    } else {
      const occupant = trackOccupant(state, location.position, marbleId);
      if (!occupant) continue;
      requireRule(!isProtected(state, occupant), 'Protected start blocks movement');
      if (king) capture(occupant, result);
      else if (step === Math.abs(steps)) {
        requireRule(playerTeamId(state, playerById(state, occupant.playerId)) !== playerTeamId(state, owner), 'Own destination occupied');
        capture(occupant, result);
      }
    }
  }
  marble.location = location;
  result.paths.push({ marbleId, positions });
  result.destinations.push({ marbleId, location: structuredClone(location) });
}

export function releaseOnDraft(state: GameState, playerId: string, marbleId: string, result: LegalAction) {
  const marble = marbleById(state, marbleId);
  const player = playerById(state, playerId);
  requireRule(marble.playerId === playerId && marble.location.kind === 'base', 'Release requires own base marble');
  const occupant = trackOccupant(state, player.start);
  if (occupant) {
    requireRule(playerTeamId(state, playerById(state, occupant.playerId)) !== playerTeamId(state, player) && !isProtected(state, occupant), 'Start occupied');
    capture(occupant, result);
  }
  marble.location = { kind: 'track', position: player.start };
  result.destinations.push({ marbleId, location: structuredClone(marble.location) });
}

export function swapOnDraft(state: GameState, playerId: string, ownId: string, opponentId: string, result: LegalAction) {
  const own = marbleById(state, ownId);
  const opponent = marbleById(state, opponentId);
  requireRule(own.playerId === playerId && opponent.playerId !== playerId, 'Swap requires own/opponent pair');
  requireRule(own.location.kind === 'track' && opponent.location.kind === 'track', 'Swap requires track marbles');
  requireRule(!isProtected(state, own) && !isProtected(state, opponent), 'Protected marble cannot swap');
  [own.location, opponent.location] = [opponent.location, own.location];
  result.destinations.push({ marbleId: ownId, location: structuredClone(own.location) }, { marbleId: opponentId, location: structuredClone(opponent.location) });
}
