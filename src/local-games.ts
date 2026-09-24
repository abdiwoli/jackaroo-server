import { randomUUID } from 'node:crypto';
import { applyAction, createGame, getLegalActions, startGame } from './jackaroo/engine.js';
import { requireRule } from './jackaroo/rules.js';
import type { GameAction, GameState } from './jackaroo/types.js';

interface LocalGame { id: string; revision: number; state: GameState; lastPlayed: { card: GameState['discard'][number]; playerId: string; revision: number } | null }
export class LocalGameError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function createLocalGameStore() {
  const games = new Map<string, LocalGame>();
  function lookup(id: string) {
    const game = games.get(id);
    if (!game) throw new LocalGameError(404, 'Local game not found. Start a new game.');
    return game;
  }
  function view(game: LocalGame) {
    const { state } = game;
    const current = state.players.find(player => player.id === state.currentPlayerId);
    return {
      id: game.id, revision: game.revision, status: state.status,
      board: structuredClone(state.board), currentPlayerId: state.currentPlayerId,
      winnerId: state.winnerId, handNumber: state.handNumber,
      pendingDiscardPlayerId: state.pendingDiscardPlayerId,
      players: state.players.map(player => ({
        id: player.id, start: player.start, marbles: structuredClone(player.marbles), cardCount: player.hand.length,
      })),
      hand: structuredClone(current?.hand ?? []), legalActions: getLegalActions(state),
      discardCards: structuredClone(state.discard.slice(-5)), discardCount: state.discard.length,
      lastPlayed: structuredClone(game.lastPlayed),
    };
  }
  return {
    create() {
      const game: LocalGame = { id: randomUUID(), revision: 0, state: startGame(createGame(['Player 1', 'Player 2'])), lastPlayed: null };
      games.set(game.id, game);
      return view(game);
    },
    get(id: string) { return view(lookup(id)); },
    act(id: string, revision: unknown, action: unknown) {
      const game = lookup(id);
      requireRule(Number.isInteger(revision) && Number(revision) >= 0, 'Missing or invalid game revision');
      if (revision !== game.revision) throw new LocalGameError(409, 'Board changed. Refresh before playing again.');
      requireRule(action && typeof action === 'object' && !Array.isArray(action), 'Invalid action');
      // All card, turn, ownership, movement and winning decisions stay in the engine.
      const next = applyAction(game.state, action as GameAction);
      const identity = action as GameAction;
      const card = game.state.players.find(player => player.id === identity.playerId)!.hand.find(card => card.id === identity.cardId)!;
      game.lastPlayed = { card: structuredClone(card), playerId: identity.playerId, revision: game.revision + 1 };
      game.state = next; game.revision++;
      return view(game);
    },
  };
}
