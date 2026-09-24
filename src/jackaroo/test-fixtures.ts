import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { assertGameState, createGame, startGame, applyAction } from './engine.js';
import { createDeck } from './deck.js';
import { RuleError } from './rules.js';
import type { Card, GameAction, GameState, LegalAction, Location, Marble, Rank, Suit } from './types.js';

export function exactGame(rank: Rank, owner = 0, suit: Suit = 'hearts'): GameState {
  const state = startGame(createGame(['A', 'B'], { deck: createDeck() }));
  const cards = createDeck();
  const selected = cards.splice(cards.findIndex(card => card.rank === rank && card.suit === suit), 1)[0]!;
  const other = cards.splice(cards.findIndex(card => card.rank === '2'), 1)[0]!;
  state.players.forEach((player, index) => { player.hand = index === owner ? [selected] : [other]; });
  state.deck = cards;
  state.currentPlayerId = state.players[owner]!.id;
  assertGameState(state);
  return state;
}

export function marble(state: GameState, owner = 0, index = 0): Marble {
  return state.players[owner]!.marbles[index]!;
}
export function put(state: GameState, owner: number, index: number, location: Location) {
  marble(state, owner, index).location = location;
}
export function atTrack(state: GameState, owner: number, index: number, position: number) {
  put(state, owner, index, { kind: 'track', position });
}
export function atHome(state: GameState, owner: number, index: number, position: number) {
  put(state, owner, index, { kind: 'home', position });
}
export function selectedCard(state: GameState): Card {
  return state.players.find(player => player.id === state.currentPlayerId)!.hand[0]!;
}
export function actionIdentity(state: GameState) {
  return { playerId: state.currentPlayerId!, cardId: selectedCard(state).id };
}
export function movement(state: GameState, steps: number, owner = 0, index = 0): GameAction {
  return { ...actionIdentity(state), type: 'move', moves: [{ marbleId: marble(state, owner, index).id, steps }] };
}
export function relativeTrack(state: GameState, owner: number, relative: number) {
  return (state.players[owner]!.start + relative + state.board.trackSize) % state.board.trackSize;
}
export function rejectAtomic(state: GameState, action: GameAction) {
  assertGameState(state);
  const snapshot = structuredClone(state);
  assert.throws(() => applyAction(state, action), RuleError);
  assert.deepEqual(state, snapshot);
}
export function choose(choices: LegalAction[], action: GameAction) {
  return choices.find(choice => isDeepStrictEqual(choice.action, action));
}
export function emptyHand(state: GameState, owner: number) {
  state.discard.push(...state.players[owner]!.hand);
  state.players[owner]!.hand = [];
}
