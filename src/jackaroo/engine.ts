import type { Card, CreateOptions, DiscardAction, GameAction, GameState, LegalAction, PlayAction, RandomOptions } from './types.js';
import { marbleById, playerById, V1_BOARD, validateBoard } from './board.js';
import { createDeck, shuffle, validateDeck } from './deck.js';
import { MOVEMENT, RuleError, requireRule, V1_RULES } from './rules.js';
import { assertGameState, previewPlay, validateActor } from './validation.js';

export function createGame(playerIds: readonly string[] = ['player-1', 'player-2'], options: CreateOptions = {}): GameState {
  requireRule(playerIds.length === V1_RULES.playerCount && new Set(playerIds).size === playerIds.length && playerIds.every(id => typeof id === 'string' && id.length > 0), 'Expected two unique player IDs');
  const board = structuredClone(options.board ?? V1_BOARD);
  validateBoard(board);
  const deck = options.deck ? structuredClone(options.deck) : shuffle(createDeck(), options.rng);
  validateDeck(deck);
  const state: GameState = {
    status: 'created', board,
    players: playerIds.map((id, index) => ({ id, start: board.starts[index]!, hand: [],
      marbles: Array.from({ length: board.marblesPerPlayer }, (_, marbleIndex) => ({ id: `${id}:marble:${marbleIndex}`, playerId: id, location: { kind: 'base' } })),
    })),
    deck, discard: [], currentPlayerId: null, handNumber: 0,
    handStarterIndex: V1_RULES.initialStarterIndex, pendingDiscardPlayerId: null, winnerId: null,
  };
  assertGameState(state);
  return state;
}

function dealOnDraft(state: GameState, options: RandomOptions) {
  requireRule(state.players.every(player => player.hand.length === 0), 'Cannot redeal nonempty hands');
  const needed = V1_RULES.cardsPerHand * state.players.length;
  if (state.deck.length < needed) {
    // Include the undealt remainder; replacing it would lose physical cards.
    state.deck = shuffle([...state.deck, ...state.discard], options.rng);
    state.discard = [];
  }
  requireRule(state.deck.length >= needed, 'Insufficient cards for complete deal');
  if (state.handNumber > 0) state.handStarterIndex = (state.handStarterIndex + 1) % state.players.length;
  state.handNumber++;
  for (let count = 0; count < V1_RULES.cardsPerHand; count++) {
    for (const player of state.players) player.hand.push(state.deck.shift()!);
  }
  state.currentPlayerId = state.players[state.handStarterIndex]!.id;
}

export function startGame(state: GameState, options: RandomOptions = {}): GameState {
  requireRule(state.status === 'created', 'Game already started');
  const draft = structuredClone(state);
  draft.status = 'playing';
  dealOnDraft(draft, options);
  assertGameState(draft);
  return draft;
}

export function dealCards(state: GameState, options: RandomOptions = {}): GameState {
  requireRule(state.status === 'playing', 'Game is not playing');
  requireRule(state.pendingDiscardPlayerId === null, 'Resolve pending discard before dealing');
  const draft = structuredClone(state);
  dealOnDraft(draft, options);
  assertGameState(draft);
  return draft;
}

export function getCurrentPlayer(state: GameState) {
  return state.currentPlayerId === null ? null : structuredClone(playerById(state, state.currentPlayerId));
}

function candidates(state: GameState, card: Card): PlayAction[] {
  const player = playerById(state, state.currentPlayerId!);
  const base = { playerId: player.id, cardId: card.id };
  const result: PlayAction[] = [];
  if (card.rank === 'Q') return [{ ...base, type: 'queen' }];
  if (card.rank === '10') result.push({ ...base, type: 'ten-discard' });
  if (card.rank === 'J') {
    result.push({ ...base, type: 'jack-pass' });
    for (const own of player.marbles) {
      for (const opponent of state.players.filter(other => other.id !== player.id).flatMap(other => other.marbles)) {
        result.push({ ...base, type: 'swap', ownMarbleId: own.id, opponentMarbleId: opponent.id });
      }
    }
    return result;
  }
  const steps = MOVEMENT[card.rank];
  if (steps !== undefined) {
    for (const marble of card.rank === '5' ? state.players.flatMap(owner => owner.marbles) : player.marbles) {
      result.push({ ...base, type: 'move', moves: [{ marbleId: marble.id, steps }] });
      if (card.rank === 'A' || card.rank === 'K') result.push({ ...base, type: 'release', marbleId: marble.id });
    }
  }
  if (card.rank === '7') {
    for (const first of player.marbles) for (const second of player.marbles) {
      if (first.id === second.id) continue;
      for (let points = 1; points < V1_RULES.sevenPoints; points++) {
        result.push({ ...base, type: 'move', moves: [{ marbleId: first.id, steps: points }, { marbleId: second.id, steps: V1_RULES.sevenPoints - points }] });
      }
    }
  }
  return result;
}

function legalPlays(state: GameState): LegalAction[] {
  if (state.status !== 'playing' || state.currentPlayerId === null) return [];
  if (state.pendingDiscardPlayerId === state.currentPlayerId) return [];
  const result: LegalAction[] = [];
  for (const card of playerById(state, state.currentPlayerId).hand) {
    for (const action of candidates(state, card)) {
      try { result.push(previewPlay(state, action).legal); }
      catch (error) { if (!(error instanceof RuleError)) throw error; }
    }
  }
  return result;
}

export function getLegalActions(state: GameState): LegalAction[] {
  const plays = legalPlays(state);
  if (plays.length || state.status !== 'playing' || state.currentPlayerId === null) return plays;
  return playerById(state, state.currentPlayerId).hand.map(card => ({
    action: { type: 'discard', playerId: state.currentPlayerId!, cardId: card.id }, paths: [], capturedMarbleIds: [], destinations: [],
  }));
}

// Legal playable cards only; forced-discard choices are in getLegalActions.
export function getLegalCards(state: GameState): Card[] {
  const ids = new Set(legalPlays(state).map(legal => legal.action.cardId));
  return structuredClone(state.players.flatMap(player => player.hand).filter(card => ids.has(card.id)));
}

export function checkWinner(state: GameState): string | null {
  return state.players.find(player => player.marbles.length === state.board.marblesPerPlayer &&
    player.marbles.every(marble => marble.location.kind === 'home') &&
    new Set(player.marbles.map(marble => marble.location.kind === 'home' ? marble.location.position : -1)).size === state.board.homeSize)?.id ?? null;
}

function nextTurnOnDraft(state: GameState, options: RandomOptions) {
  let nextIndex = (state.players.findIndex(player => player.id === state.currentPlayerId) + 1) % state.players.length;
  // A Queen requires the opponent to choose a card to discard. An empty hand
  // has no card to surrender; clear that effect before any new deal.
  if (state.pendingDiscardPlayerId && playerById(state, state.pendingDiscardPlayerId).hand.length === 0) {
    state.pendingDiscardPlayerId = null;
  }
  if (state.players.every(player => player.hand.length === 0)) {
    dealOnDraft(state, options);
    return;
  }
  while (state.players[nextIndex]!.hand.length === 0) nextIndex = (nextIndex + 1) % state.players.length;
  state.currentPlayerId = state.players[nextIndex]!.id;
}

// Only an empty scheduled hand may pass publicly. Card plays end turns internally.
export function endTurn(state: GameState, options: RandomOptions = {}): GameState {
  requireRule(state.status === 'playing' && state.currentPlayerId !== null, 'Game is not playing');
  requireRule(playerById(state, state.currentPlayerId).hand.length === 0, 'Cannot voluntarily pass a nonempty hand');
  const draft = structuredClone(state);
  nextTurnOnDraft(draft, options);
  assertGameState(draft);
  return draft;
}

function finishAction(draft: GameState, action: GameAction, options: RandomOptions) {
  const hand = playerById(draft, action.playerId).hand;
  const index = hand.findIndex(card => card.id === action.cardId);
  draft.discard.push(hand.splice(index, 1)[0]!);
  const winner = checkWinner(draft);
  if (winner) {
    draft.status = 'finished'; draft.winnerId = winner;
    draft.currentPlayerId = null; draft.pendingDiscardPlayerId = null;
  } else nextTurnOnDraft(draft, options);
  assertGameState(draft);
  return draft;
}

export function playCard(state: GameState, action: PlayAction, options: RandomOptions = {}): GameState {
  return finishAction(previewPlay(state, action).draft, action, options);
}

export function discardCard(state: GameState, action: DiscardAction, options: RandomOptions = {}): GameState {
  requireRule(action && action.type === 'discard', 'Expected discard action');
  validateActor(state, action);
  requireRule(legalPlays(state).length === 0, 'Must play an available legal action');
  const draft = structuredClone(state);
  if (draft.pendingDiscardPlayerId === action.playerId) draft.pendingDiscardPlayerId = null;
  return finishAction(draft, action, options);
}

export function applyAction(state: GameState, action: GameAction, options: RandomOptions = {}): GameState {
  requireRule(action && typeof action === 'object', 'Invalid action');
  return action.type === 'discard' ? discardCard(state, action, options) : playCard(state, action, options);
}

export { marbleById, assertGameState };
