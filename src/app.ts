import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createLocalGameStore, LocalGameError } from './local-games.js';
import { RuleError } from './jackaroo/rules.js';
import { createOnlineGameStore } from './online-games.js';

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

export function createApp() {
  const games = createLocalGameStore();
  const online = createOnlineGameStore();
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method === 'GET' && path === '/health') {
      response.writeHead(200);
      response.end(JSON.stringify({ status: 'ok', service: 'jackaroo-server' }));
      return;
    }
    if (request.method === 'POST' && path === '/local-games') {
      response.writeHead(201); response.end(JSON.stringify(games.create())); return;
    }
    if (request.method === 'POST' && path === '/online-games') {
      response.writeHead(201); response.end(JSON.stringify(online.create())); return;
    }
    if (request.method === 'POST' && path === '/online-games/join') {
      const body = await readBody(request);
      const session = online.join(body.code);
      response.writeHead(200); response.end(JSON.stringify(session)); return;
    }
    const onlineMatch = /^\/online-games\/([^/]+)(\/actions)?$/.exec(path);
    if (onlineMatch) {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (request.method === 'GET' && !onlineMatch[2]) {
        const view = online.get(onlineMatch[1]!, token);
        response.writeHead(200); response.end(JSON.stringify(view)); return;
      }
      if (request.method === 'POST' && onlineMatch[2]) {
        const body = await readBody(request);
        const view = online.act(onlineMatch[1]!, token, body.revision, body.action);
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
  return createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    void handle(request, response).catch(error => {
      const status = error instanceof LocalGameError ? error.status : error instanceof RuleError ? 422 : 500;
      response.writeHead(status);
      response.end(JSON.stringify({ error: status === 500 ? 'Unexpected server error' : error.message }));
    });
  });
}
