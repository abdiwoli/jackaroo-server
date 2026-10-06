import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { LocalGameError } from './local-games.js';
import type { OnlineGameStore } from './room-storage.js';

export interface VoiceConfiguration { url?: string; apiKey?: string; apiSecret?: string }
export async function createVoiceSession(online: OnlineGameStore, id: string, token: string,
  configuration: VoiceConfiguration = {
    url: process.env.LIVEKIT_URL, apiKey: process.env.LIVEKIT_API_KEY, apiSecret: process.env.LIVEKIT_API_SECRET,
  }) {
  // Existing room authentication supplies the identity, never the request body.
  const game = await online.get(id, token);
  const url = configuration.url?.trim();
  const key = configuration.apiKey?.trim();
  const secret = configuration.apiSecret?.trim();
  if (!url || !key || !secret)
    throw new LocalGameError(503, 'Voice chat is not available yet. Try again later.');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' || parsed.username || parsed.password) throw new Error();
  } catch { throw new LocalGameError(503, 'Voice chat is not available yet. Try again later.'); }
  const access = new AccessToken(key, secret, {
    identity: game.viewerPlayerId,
    name: game.players.find(player => player.id === game.viewerPlayerId)?.name,
    ttl: '10m',
  });
  access.addGrant({
    roomJoin: true, room: `jackaroo-${game.id}`,
    canPublish: true, canSubscribe: true, canPublishData: false,
    canPublishSources: [TrackSource.MICROPHONE],
    canUpdateOwnMetadata: false,
  });
  return { serverUrl: url, participantToken: await access.toJwt() };
}
