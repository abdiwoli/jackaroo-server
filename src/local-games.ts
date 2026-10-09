import { randomUUID } from 'node:crypto';
import { applyAction, createGame, getLegalActions, startGame } from './jackaroo/engine.js';
import { requireRule } from './jackaroo/rules.js';
import type { GameAction, GameMode, GameState } from './jackaroo/types.js';

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
      mode: state.mode,
      board: structuredClone(state.board), currentPlayerId: state.currentPlayerId,
      winnerId: state.winnerId, handNumber: state.handNumber,
      pendingDiscardPlayerId: state.pendingDiscardPlayerId,
      players: state.players.map(player => ({
        id: player.id, start: player.start, teamId: player.teamId, marbles: structuredClone(player.marbles), cardCount: player.hand.length,
      })),
      hand: structuredClone(current?.hand ?? []), legalActions: getLegalActions(state),
      discardCards: structuredClone(state.discard.slice(-5)), discardCount: state.discard.length,
      lastPlayed: structuredClone(game.lastPlayed),
    };
  }
  return {
    create(mode: unknown = '1v1') {
      requireRule(mode === '1v1' || mode === '3p' || mode === '4p' || mode === '2v2', 'Unknown game mode');
      const count = mode === '1v1' ? 2 : mode === '3p' ? 3 : 4;
      const ids = Array.from({ length: count }, (_, index) => `Player ${index + 1}`);
      const game: LocalGame = { id: randomUUID(), revision: 0, state: startGame(createGame(ids, { mode: mode as GameMode })), lastPlayed: null };
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
