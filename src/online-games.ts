import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { applyAction, createGame, getLegalActions, startGame } from './jackaroo/engine.js';
import type { GameAction, GameState, LegalAction } from './jackaroo/types.js';
import { LocalGameError } from './local-games.js';

interface Room {
  id: string; code: string; revision: number; state: GameState; tokens: string[];
  updated: number; lastAction: LegalAction | null;
  lastPlayed: { card: GameState['discard'][number]; playerId: string; revision: number } | null;
}
export function createOnlineGameStore() {
  const rooms = new Map<string, Room>();
  function lookup(id: string) {
    const room = rooms.get(id);
    if (!room || Date.now() - room.updated > 24 * 60 * 60 * 1000) {
      rooms.delete(id);
      throw new LocalGameError(404, 'Room expired or server restarted. Create a new room.');
    }
    return room;
  }
  function authenticate(room: Room, token: string) {
    const seat = token ? room.tokens.indexOf(token) : -1;
    if (seat < 0) throw new LocalGameError(401, 'Invalid player session.');
    return seat;
  }
  function view(room: Room, seat: number) {
    const state = room.state;
    const player = state.players[seat]!;
    return {
      id: room.id, roomCode: room.code, revision: room.revision, status: state.status,
      viewerPlayerId: player.id, joinedPlayers: room.tokens.length,
      board: structuredClone(state.board), currentPlayerId: state.currentPlayerId,
      winnerId: state.winnerId, handNumber: state.handNumber,
      pendingDiscardPlayerId: state.pendingDiscardPlayerId,
      players: state.players.map((p, index) => ({ id: p.id, name: `Player ${index + 1}`,
        start: p.start, marbles: structuredClone(p.marbles), cardCount: p.hand.length })),
      hand: structuredClone(player.hand),
      legalActions: state.currentPlayerId === player.id ? getLegalActions(state) : [],
      discardCards: structuredClone(state.discard.slice(-5)), discardCount: state.discard.length,
      lastPlayed: structuredClone(room.lastPlayed), lastAction: structuredClone(room.lastAction),
    };
  }
  return {
    create() {
      for (const [id, room] of rooms) if (Date.now() - room.updated > 86400000) rooms.delete(id);
      if (rooms.size >= 1000) throw new LocalGameError(503, 'Room capacity reached. Try again later.');
      let code: string;
      do { code = randomBytes(4).toString('hex').toUpperCase(); }
      while ([...rooms.values()].some(room => room.code === code));
      const room: Room = { id: randomUUID(), code, revision: 0,
        state: createGame([randomUUID(), randomUUID()]), tokens: [randomBytes(32).toString('hex')],
        updated: Date.now(), lastAction: null, lastPlayed: null };
      rooms.set(room.id, room);
      return { token: room.tokens[0]!, game: view(room, 0) };
    },
    join(code: unknown) {
      if (typeof code !== 'string' || !/^[A-F0-9]{8}$/.test(code.trim().toUpperCase()))
        throw new LocalGameError(400, 'Enter the 8-character room code.');
      const found = [...rooms.values()].find(room => room.code === code.trim().toUpperCase());
      if (!found) throw new LocalGameError(404, 'Room not found. Check the code.');
      const room = lookup(found.id);
      if (room.tokens.length === 2) throw new LocalGameError(409, 'This room already has two players.');
      room.tokens.push(randomBytes(32).toString('hex'));
      room.state = startGame(room.state); room.revision++; room.updated = Date.now();
      return { token: room.tokens[1]!, game: view(room, 1) };
    },
    get(id: string, token: string) {
      const room = lookup(id);
      return view(room, authenticate(room, token));
    },
    act(id: string, token: string, revision: unknown, action: unknown) {
      const room = lookup(id);
      const seat = authenticate(room, token);
      if (!Number.isInteger(revision) || revision !== room.revision)
        throw new LocalGameError(409, 'Board changed. Synchronizing your game.');
      if (!action || typeof action !== 'object' || Array.isArray(action))
        throw new LocalGameError(400, 'Invalid action.');
      const move = action as GameAction;
      if (move.playerId !== room.state.players[seat]!.id || move.playerId !== room.state.currentPlayerId)
        throw new LocalGameError(403, 'Wait for your turn.');
      const next = applyAction(room.state, move);
      // Use the engine preview for public animation, never trust client path data.
      const preview = getLegalActions(room.state).find(candidate =>
        isDeepStrictEqual(candidate.action, move));
      const card = room.state.players[seat]!.hand.find(card => card.id === move.cardId)!;
      room.lastPlayed = { card: structuredClone(card), playerId: move.playerId, revision: room.revision + 1 };
      room.lastAction = preview ?? null;
      room.state = next; room.revision++; room.updated = Date.now();
      return view(room, seat);
    },
  };
}
