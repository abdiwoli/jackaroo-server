export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type Rank = typeof RANKS[number];
export type Suit = typeof SUITS[number];
export type GameMode = '1v1' | '3p' | '4p' | '2v2';
export interface Card { id: string; rank: Rank; suit: Suit }
export interface BoardConfig {
  trackSize: number;
  starts: readonly number[];
  marblesPerPlayer: number;
  homeSize: number;
}
export type Location = { kind: 'base' } | { kind: 'track'; position: number } | { kind: 'home'; position: number };
export interface Marble { id: string; playerId: string; location: Location }
export interface Player { id: string; start: number; teamId?: string; marbles: Marble[]; hand: Card[] }
export interface GameState {
  mode?: GameMode;
  status: 'created' | 'playing' | 'finished';
  board: BoardConfig;
  players: Player[];
  deck: Card[];
  discard: Card[];
  currentPlayerId: string | null;
  handNumber: number;
  handStarterIndex: number;
  pendingDiscardPlayerId: string | null;
  winnerId: string | null;
}
export interface MoveSegment { marbleId: string; steps: number }
interface ActionBase { playerId: string; cardId: string }
export type PlayAction = ActionBase & (
  { type: 'move'; moves: MoveSegment[] } |
  { type: 'release'; marbleId: string } |
  { type: 'swap'; ownMarbleId: string; opponentMarbleId: string } |
  { type: 'queen' }
  | { type: 'ten-discard' }
  | { type: 'jack-pass' }
);
export type DiscardAction = ActionBase & { type: 'discard' };
export type GameAction = PlayAction | DiscardAction;
export interface LegalAction {
  action: GameAction;
  paths: { marbleId: string; positions: Location[] }[];
  capturedMarbleIds: string[];
  destinations: { marbleId: string; location: Location }[];
}
export type RNG = () => number;
export interface RandomOptions { rng?: RNG }
export interface CreateOptions extends RandomOptions { board?: BoardConfig; deck?: Card[]; mode?: GameMode }
