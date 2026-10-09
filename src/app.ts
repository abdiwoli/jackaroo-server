import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createLocalGameStore, LocalGameError } from './local-games.js';
import { RuleError } from './jackaroo/rules.js';
import { createConfiguredOnlineGameStore, type OnlineGameStore } from './room-storage.js';
import { createVoiceSession, type VoiceConfiguration } from './voice.js';
import { createCommunityStore } from './community.js';

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes <= 16384) chunks.push(buffer);
  }
  if (bytes > 16384) throw new LocalGameError(413, 'Request body too large');
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new LocalGameError(400, 'Expected a JSON object'); }
}

export function createRequestHandler(online: OnlineGameStore = createConfiguredOnlineGameStore(), voice?: VoiceConfiguration) {
  const games = createLocalGameStore();
  const community = createCommunityStore();
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method === 'GET' && path === '/health') {
      response.writeHead(200);
      response.end(JSON.stringify({ status: 'ok', service: 'jackaroo-server' }));
      return;
    }
    if (request.method === 'POST' && path === '/accounts') {
      response.writeHead(201); response.end(JSON.stringify(await community.register(await readBody(request)))); return;
    }
    if (request.method === 'POST' && path === '/guest-sessions') {
      const body = await readBody(request);
      response.writeHead(201); response.end(JSON.stringify(await community.createGuestSession(body.displayName))); return;
    }
    if (request.method === 'POST' && path === '/sessions') {
      response.writeHead(200); response.end(JSON.stringify(await community.login(await readBody(request)))); return;
    }
    if (request.method === 'POST' && path === '/auth/provider') {
      const body = await readBody(request);
      response.writeHead(200); response.end(JSON.stringify(await community.signInProvider(body.provider, body))); return;
    }
    if (request.method === 'POST' && path === '/auth/verify-email') {
      const body = await readBody(request);
      response.writeHead(200); response.end(JSON.stringify(await community.verifyEmail(body.token))); return;
    }
    if (request.method === 'POST' && path === '/auth/resend-verification') {
      const body = await readBody(request);
      response.writeHead(200); response.end(JSON.stringify(await community.resendVerification(body.email))); return;
    }
    if (request.method === 'POST' && path === '/auth/password-reset') {
      const body = await readBody(request);
      response.writeHead(200); response.end(JSON.stringify(await community.requestPasswordReset(body.email))); return;
    }
    if (request.method === 'POST' && path === '/auth/password-reset/complete') {
      const body = await readBody(request);
      response.writeHead(200); response.end(JSON.stringify(await community.resetPassword(body.token, body.password))); return;
    }
    if (path === '/me') {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (request.method === 'GET') { response.writeHead(200); response.end(JSON.stringify(await community.me(token))); return; }
      if (request.method === 'DELETE') { response.writeHead(200); response.end(JSON.stringify(await community.logout(token))); return; }
    }
    if (path === '/community/rooms' && request.method === 'GET') {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const scope = new URL(request.url ?? '/', 'http://localhost').searchParams.get('scope') ?? 'public';
      response.writeHead(200); response.end(JSON.stringify(await community.listRooms(token, scope))); return;
    }
    if (path === '/community/rooms' && request.method === 'POST') {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      response.writeHead(201); response.end(JSON.stringify(await community.createRoom(token, await readBody(request)))); return;
    }
    const communityRoom = /^\/community\/rooms\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (communityRoom) {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const roomId = communityRoom[1]!;
      const rest = communityRoom[2] ?? '';
      if (request.method === 'GET' && !rest) { response.writeHead(200); response.end(JSON.stringify(await community.getRoom(token, roomId))); return; }
      if (request.method === 'POST' && rest === 'join') { response.writeHead(200); response.end(JSON.stringify(await community.joinRoom(token, roomId))); return; }
      if (request.method === 'POST' && rest === 'comments') {
        const body = await readBody(request); response.writeHead(201); response.end(JSON.stringify(await community.comment(token, roomId, body.body))); return;
      }
      if (request.method === 'POST' && rest === 'mic-request') { response.writeHead(200); response.end(JSON.stringify(await community.requestMic(token, roomId))); return; }
      if (request.method === 'POST' && rest === 'voice-token') {
        response.writeHead(200); response.end(JSON.stringify(await community.voiceSession(token, roomId, voice ?? {
          url: process.env.LIVEKIT_URL, apiKey: process.env.LIVEKIT_API_KEY, apiSecret: process.env.LIVEKIT_API_SECRET,
        }))); return;
      }
      if (request.method === 'POST' && rest === 'games') {
        response.writeHead(201); response.end(JSON.stringify(await community.createGame(token, roomId, await readBody(request)))); return;
      }
      const mic = /^members\/([^/]+)\/mic$/.exec(rest);
      if (request.method === 'PATCH' && mic) {
        const body = await readBody(request); response.writeHead(200);
        response.end(JSON.stringify(await community.setMicPermission(token, roomId, mic[1]!, body.permission))); return;
      }
      const roomGame = /^games\/([^/]+)(?:\/(accept|actions))?$/.exec(rest);
      if (roomGame) {
        const gameId = roomGame[1]!;
        if (request.method === 'POST' && roomGame[2] === 'accept') {
          response.writeHead(200); response.end(JSON.stringify(await community.acceptGameInvite(token, roomId, gameId))); return;
        }
        if (request.method === 'GET' && !roomGame[2]) {
          response.writeHead(200); response.end(JSON.stringify(await community.getGame(token, roomId, gameId))); return;
        }
        if (request.method === 'POST' && roomGame[2] === 'actions') {
          const body = await readBody(request); response.writeHead(200);
          response.end(JSON.stringify(await community.actGame(token, roomId, gameId, body.revision, body.action))); return;
        }
      }
    }
    if (request.method === 'POST' && path === '/local-games') {
      const hasBody = Number(request.headers['content-length'] ?? 0) > 0 || !!request.headers['transfer-encoding'];
      const body = hasBody ? await readBody(request) : {};
      response.writeHead(201); response.end(JSON.stringify(games.create(body.mode))); return;
    }
    if (request.method === 'POST' && path === '/online-games') {
      const hasBody = Number(request.headers['content-length'] ?? 0) > 0 || !!request.headers['transfer-encoding'];
      const body = hasBody ? await readBody(request) : {};
      const session = await online.create(body.name, body.mode);
      response.writeHead(201); response.end(JSON.stringify(session)); return;
    }
    if (request.method === 'POST' && path === '/online-games/join') {
      const body = await readBody(request);
      const session = await online.join(body.code, body.name);
      response.writeHead(200); response.end(JSON.stringify(session)); return;
    }
    const voiceMatch = /^\/online-games\/([^/]+)\/voice-token$/.exec(path);
    if (voiceMatch && request.method === 'POST') {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const session = await createVoiceSession(online, voiceMatch[1]!, token, voice);
      response.writeHead(200); response.end(JSON.stringify(session)); return;
    }
    const onlineMatch = /^\/online-games\/([^/]+)(\/actions)?$/.exec(path);
    if (onlineMatch) {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (request.method === 'GET' && !onlineMatch[2]) {
        const view = await online.get(onlineMatch[1]!, token);
        response.writeHead(200); response.end(JSON.stringify(view)); return;
      }
      if (request.method === 'POST' && onlineMatch[2]) {
        const body = await readBody(request);
        const view = await online.act(onlineMatch[1]!, token, body.revision, body.action);
        response.writeHead(200); response.end(JSON.stringify(view)); return;
      }
    }
    const match = /^\/local-games\/([^/]+)(\/actions)?$/.exec(path);
    if (match && request.method === 'GET' && !match[2]) {
      const view = games.get(match[1]!);
      response.writeHead(200); response.end(JSON.stringify(view)); return;
    }
    if (match && request.method === 'POST' && match[2]) {
      const body = await readBody(request);
      const view = games.act(match[1]!, body.revision, body.action);
      response.writeHead(200); response.end(JSON.stringify(view)); return;
    }
    response.writeHead(404); response.end(JSON.stringify({ error: 'Not found' }));
  }
  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    await handle(request, response).catch(error => {
      const status = error instanceof LocalGameError ? error.status : error instanceof RuleError ? 422 : 500;
      response.writeHead(status);
      response.end(JSON.stringify({ error: status === 500 ? 'Unexpected server error' : error.message }));
    });
  };
}

export function createApp(online?: OnlineGameStore) {
  return createServer(createRequestHandler(online));
}
