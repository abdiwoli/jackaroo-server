import type { BoardConfig, GameState, Marble, Player } from './types.js';
import { requireRule, V1_RULES } from './rules.js';

export const V1_BOARD: Readonly<BoardConfig> = Object.freeze({
  trackSize: 64, starts: Object.freeze([0, 32]),
  marblesPerPlayer: 4, homeSize: 4,
});
export function validateBoard(board: BoardConfig) {
  requireRule(Number.isInteger(board.trackSize) && board.trackSize > 0, 'Invalid track size');
  requireRule(board.starts.length === V1_RULES.playerCount, 'V1 requires two starts');
  requireRule(new Set(board.starts).size === board.starts.length, 'Starts must be distinct');
  requireRule(board.starts.every(start => Number.isInteger(start) && start >= 0 && start < board.trackSize), 'Invalid start');
  requireRule(relativePosition(board, board.starts[0]!, board.starts[1]!) * 2 === board.trackSize, 'Starts must be opposite');
  requireRule(Number.isInteger(board.marblesPerPlayer) && board.marblesPerPlayer > 0 && board.homeSize === board.marblesPerPlayer, 'Home must fit all marbles');
}
export function wrap(board: BoardConfig, position: number) {
  return ((position % board.trackSize) + board.trackSize) % board.trackSize;
}
export function relativePosition(board: BoardConfig, start: number, position: number) {
  return wrap(board, position - start);
}
export function playerById(state: GameState, id: string): Player {
  const player = state.players.find(player => player.id === id);
  requireRule(player, 'Unknown player');
  return player;
}
export function marbleById(state: GameState, id: string): Marble {
  const marble = state.players.flatMap(player => player.marbles).find(marble => marble.id === id);
  requireRule(marble, 'Unknown marble');
  return marble;
}
export function trackOccupant(state: GameState, position: number, exceptId?: string) {
  return state.players.flatMap(player => player.marbles).find(marble =>
    marble.id !== exceptId && marble.location.kind === 'track' && marble.location.position === position);
}
export function isProtected(state: GameState, marble: Marble) {
  return marble.location.kind === 'track' && marble.location.position === playerById(state, marble.playerId).start;
}
