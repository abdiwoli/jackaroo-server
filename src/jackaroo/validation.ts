import type { Card, GameAction, GameState, LegalAction, PlayAction } from './types.js';
import { playerById, validateBoard } from './board.js';
import { validateDeck } from './deck.js';
import { validateCardAction } from './cards.js';
import { moveOnDraft, releaseOnDraft, swapOnDraft } from './movement.js';
import { requireRule, V1_RULES } from './rules.js';

export function validateActor(state: GameState, action: GameAction): Card {
  requireRule(state.status === 'playing', 'Game is not playing');
  requireRule(action && typeof action.playerId === 'string' && typeof action.cardId === 'string', 'Invalid action identity');
  requireRule(action.playerId === state.currentPlayerId, 'Out-of-turn action');
  const card = playerById(state, action.playerId).hand.find(card => card.id === action.cardId);
  requireRule(card, 'Card not in player hand');
  return card;
}

export function previewPlay(state: GameState, action: PlayAction): { draft: GameState; legal: LegalAction } {
  const card = validateActor(state, action);
  requireRule(state.pendingDiscardPlayerId !== action.playerId, 'Forced discard: discard one card without using its effect');
  validateCardAction(state, card, action);
  const draft = structuredClone(state);
  const legal: LegalAction = { action: structuredClone(action), paths: [], capturedMarbleIds: [], destinations: [] };
  switch (action.type) {
    case 'move':
      for (const move of action.moves) moveOnDraft(draft, action.playerId, move.marbleId, move.steps, card.rank === 'K', legal, card.rank === '5');
      break;
    case 'release': releaseOnDraft(draft, action.playerId, action.marbleId, legal); break;
    case 'swap': swapOnDraft(draft, action.playerId, action.ownMarbleId, action.opponentMarbleId, legal); break;
    case 'queen':
    case 'ten-discard': {
      const index = draft.players.findIndex(player => player.id === action.playerId);
      draft.pendingDiscardPlayerId = draft.players[(index + 1) % draft.players.length]!.id;
      break;
    }
  }
  return { draft, legal };
}

// Trusted-state integrity check, also useful for exact test fixtures.
export function assertGameState(state: GameState) {
  validateBoard(state.board);
  requireRule(state.players.length === V1_RULES.playerCount && new Set(state.players.map(player => player.id)).size === state.players.length, 'Invalid players');
  const occupied = new Set<string>();
  const marbleIds = new Set<string>();
  state.players.forEach((player, index) => {
    requireRule(player.start === state.board.starts[index] && player.marbles.length === state.board.marblesPerPlayer, 'Invalid player geometry');
    for (const marble of player.marbles) {
      requireRule(marble.playerId === player.id && !marbleIds.has(marble.id), 'Invalid marble identity');
      marbleIds.add(marble.id);
      const location = marble.location;
      if (location.kind === 'base') continue;
      requireRule(Number.isInteger(location.position) && location.position >= 0 && location.position < (location.kind === 'track' ? state.board.trackSize : state.board.homeSize), 'Invalid marble position');
      const key = location.kind === 'track' ? `track:${location.position}` : `home:${player.id}:${location.position}`;
      requireRule(!occupied.has(key), 'Marbles cannot share a position');
      occupied.add(key);
    }
  });
  validateDeck([...state.deck, ...state.discard, ...state.players.flatMap(player => player.hand)]);
  requireRule(state.pendingDiscardPlayerId === null || state.players.some(player => player.id === state.pendingDiscardPlayerId), 'Invalid pending discard');
  requireRule(state.status !== 'playing' || state.players.some(player => player.id === state.currentPlayerId), 'Invalid current player');
  requireRule(state.status !== 'finished' || (state.currentPlayerId === null && state.players.some(player => player.id === state.winnerId)), 'Invalid finished state');
}
