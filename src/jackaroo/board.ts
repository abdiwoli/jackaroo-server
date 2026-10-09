import type { BoardConfig, GameMode, GameState, Marble, Player } from './types.js';
import { requireRule } from './rules.js';

export const V1_BOARD: Readonly<BoardConfig> = Object.freeze({
  trackSize: 64, starts: Object.freeze([0, 32]),
  marblesPerPlayer: 4, homeSize: 4,
});
export function boardForMode(mode: GameMode): Readonly<BoardConfig> {
  const starts: Record<GameMode, readonly number[]> = {
    '1v1': [0, 32], '3p': [0, 21, 43], '4p': [0, 16, 32, 48], '2v2': [0, 16, 32, 48],
  };
  return Object.freeze({ trackSize: 64, starts: Object.freeze([...starts[mode]]), marblesPerPlayer: 4, homeSize: 4 });
}
export function validateBoard(board: BoardConfig) {
  requireRule(Number.isInteger(board.trackSize) && board.trackSize > 0, 'Invalid track size');
  requireRule([2, 3, 4].includes(board.starts.length), 'Expected two, three, or four starts');
  requireRule(new Set(board.starts).size === board.starts.length, 'Starts must be distinct');
  requireRule(board.starts.every(start => Number.isInteger(start) && start >= 0 && start < board.trackSize), 'Invalid start');
  requireRule(Number.isInteger(board.marblesPerPlayer) && board.marblesPerPlayer > 0 && board.homeSize === board.marblesPerPlayer, 'Home must fit all marbles');
}
export function playerTeamId(state: Pick<GameState, 'mode' | 'players'>, player: Player): string {
  if (player.teamId) return player.teamId;
  if (state.mode === '2v2') return `team-${state.players.indexOf(player) % 2 === 0 ? 'a' : 'b'}`;
  return player.id;
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
