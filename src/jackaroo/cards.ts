import type { Card, GameState, PlayAction } from './types.js';
import { MOVEMENT, requireRule, V1_RULES } from './rules.js';
import { isProtected } from './board.js';

export function validateCardAction(state: GameState, card: Card, action: PlayAction) {
  switch (action.type) {
    case 'ten-discard':
      requireRule(card.rank === '10', 'Only Ten can choose its discard effect');
      return;
    case 'jack-pass':
      requireRule(card.rank === 'J', 'Only Jack can pass without swapping');
      requireRule(!state.players.some(player => player.id !== action.playerId && player.marbles.some(marble =>
        marble.location.kind === 'track' && !isProtected(state, marble))), 'Opponent has an eligible swap target');
      return;
    case 'release':
      requireRule(card.rank === 'A' || card.rank === 'K', 'Only Ace and King release');
      return;
    case 'queen':
      requireRule(card.rank === 'Q', 'Only Queen forces the next player to discard');
      return;
    case 'swap':
      requireRule(card.rank === 'J', 'Only Jack swaps');
      return;
    case 'move': {
      const value = MOVEMENT[card.rank];
      requireRule(value !== undefined, 'Card has no movement');
      requireRule(Array.isArray(action.moves) && action.moves.length > 0, 'Missing movement sequence');
      requireRule(Array.from(action.moves).every(move => move && typeof move.marbleId === 'string' && Number.isInteger(move.steps)), 'Movement must identify a marble and use integer steps');
      if (card.rank === '7') {
        requireRule(action.moves.length <= V1_RULES.maxSevenMarbles, 'Seven uses at most two marbles');
        requireRule(new Set(action.moves.map(move => move.marbleId)).size === action.moves.length, 'Seven marbles must be different');
        requireRule(action.moves.every(move => move.steps > 0) && action.moves.reduce((sum, move) => sum + move.steps, 0) === V1_RULES.sevenPoints, 'Seven must total exactly seven');
      } else {
        requireRule(action.moves.length === 1 && action.moves[0]!.steps === value, 'Incorrect card movement');
      }
      requireRule(state.status === 'playing', 'Game is not playing');
      return;
    }
    default: requireRule(false, 'Unknown card action');
  }
}
