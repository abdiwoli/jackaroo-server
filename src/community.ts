import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Prisma, PrismaClient, type EmailAction, type GameInviteStatus, type IdentityProvider, type MicPermission, type RoomGameMode } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { applyAction, createGame, getLegalActions, startGame } from './jackaroo/engine.js';
import type { GameAction, GameMode, GameState } from './jackaroo/types.js';
import { LocalGameError } from './local-games.js';

const sessionDays = 30;
const speakerLimit = 8;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
let client: PrismaClient | undefined;
function database() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new LocalGameError(503, 'Accounts and community rooms require PostgreSQL.');
  return client ??= new PrismaClient({ datasources: { db: { url } } });
}
function fail(status: number, message: string): never { throw new LocalGameError(status, message); }
function validId(value: string) { return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function safePasswordHash(password: string, salt: Buffer) {
  return scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function passwordDigest(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${safePasswordHash(password, salt).toString('hex')}`;
}
function verifyPassword(password: string, stored: string) {
  const [saltHex, digestHex] = stored.split(':');
  if (!saltHex || !digestHex || !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(digestHex)) return false;
  const expected = Buffer.from(digestHex, 'hex');
  const actual = safePasswordHash(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(actual, expected);
}
function cleanEmail(value: unknown) {
  if (typeof value !== 'string') fail(400, 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  return email;
}
function cleanDisplayName(value: unknown, fallback: string) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string') fail(400, 'Enter a display name.');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 40 || /[\p{Cc}\p{Cf}]/u.test(name)) fail(400, 'Use a display name of 1 to 40 characters.');
  return name;
}
function cleanPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail(400, 'Password must contain 10 to 128 characters.');
  return value;
}
function providerAudience(provider: 'google' | 'apple') {
  const configured = (provider === 'google' ? process.env.GOOGLE_OAUTH_AUDIENCES : process.env.APPLE_OAUTH_AUDIENCES) ?? '';
  const values = configured.split(',').map(value => value.trim()).filter(Boolean);
  if (!values.length) fail(503, `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured.`);
  return values;
}
async function deliverEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) {
    if (process.env.NODE_ENV === 'production') fail(503, 'Email delivery is not configured.');
    console.info(`[Jackaroo email preview] To: ${to}; ${subject}; ${html}`);
    return;
  }
  const result = await fetch('https://api.resend.com/emails', { method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }) });
  if (!result.ok) fail(503, 'Email delivery failed. Try again later.');
}
function modeToDb(mode: GameMode): RoomGameMode {
  return ({ '1v1': 'PLAYER_1V1', '3p': 'PLAYER_3', '4p': 'PLAYER_4', '2v2': 'TEAM_2V2' } as const)[mode];
}
function modeFromDb(mode: RoomGameMode): GameMode {
  return ({ PLAYER_1V1: '1v1', PLAYER_3: '3p', PLAYER_4: '4p', TEAM_2V2: '2v2' } as const)[mode];
}
function playerCount(mode: GameMode) { return mode === '1v1' ? 2 : mode === '3p' ? 3 : 4; }
const providerKeys = {
  google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
  apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
};
async function verifyProviderToken(provider: 'google' | 'apple', idToken: unknown) {
  if (typeof idToken !== 'string' || idToken.length > 16384) fail(400, 'The sign-in credential is invalid.');
  const audience = providerAudience(provider);
  const issuer = provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : 'https://appleid.apple.com';
  try {
    const verified = await jwtVerify(idToken, providerKeys[provider], { issuer, audience });
    if (typeof verified.payload.sub !== 'string' || !verified.payload.sub) throw new Error('Missing identity');
    const emailVerified = verified.payload.email_verified === true || verified.payload.email_verified === 'true';
    return { subject: verified.payload.sub, email: emailVerified && typeof verified.payload.email === 'string' ? verified.payload.email.toLowerCase() : null,
      displayName: typeof verified.payload.name === 'string' ? verified.payload.name : undefined };
  } catch { fail(401, 'The provider sign-in could not be verified. Try again.'); }
}

export function createCommunityStore() {
  async function userForToken(token: string) {
    if (!token) fail(401, 'Sign in to continue.');
    const db = database();
    const session = await db.accountSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!session || session.expiresAt <= new Date()) fail(401, 'Your session expired. Sign in again.');
    return session.user;
  }
  async function newSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionDays * 86400000);
    await database().accountSession.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
    return { token, expiresAt: expiresAt.toISOString() };
  }
  async function issueEmailAction(userId: string, email: string, action: EmailAction) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (action === 'VERIFY' ? 24 : 1) * 3600000);
    await database().emailActionToken.create({ data: { tokenHash: hashToken(token), userId, action, expiresAt } });
    const appUrl = (process.env.PUBLIC_APP_URL?.trim() || 'http://localhost:8081').replace(/\/$/, '');
    const route = action === 'VERIFY' ? 'verify-email' : 'reset-password';
    const link = `${appUrl}/${route}?token=${encodeURIComponent(token)}`;
    await deliverEmail(email, action === 'VERIFY' ? 'Verify your Jackaroo account' : 'Reset your Jackaroo password',
      `<p>Continue to Jackaroo:</p><p><a href="${link}">${action === 'VERIFY' ? 'Verify email' : 'Reset password'}</a></p><p>This link expires in ${action === 'VERIFY' ? '24 hours' : '1 hour'}.</p>`);
    return process.env.NODE_ENV === 'production' ? undefined : link;
  }
  async function membership(roomId: string, userId: string) {
    if (!validId(roomId)) fail(404, 'Room not found.');
    const member = await database().roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!member) fail(403, 'Join this room to continue.');
    return member;
  }
  async function requireAdmin(roomId: string, userId: string) {
    const member = await membership(roomId, userId);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') fail(403, 'Only a room admin can do that.');
    return member;
  }
  async function roomExists(roomId: string) {
    if (!validId(roomId)) fail(404, 'Room not found.');
    const room = await database().communityRoom.findUnique({ where: { id: roomId } });
    if (!room) fail(404, 'Room not found.');
    return room;
  }
  async function roomListItem(room: { id: string; name: string; description: string; isPublic: boolean; updatedAt: Date; ownerId: string }, viewerId: string) {
    const db = database();
    const [owner, memberCount, membershipRow, latestGame] = await Promise.all([
      db.user.findUnique({ where: { id: room.ownerId }, select: { displayName: true } }),
      db.roomMember.count({ where: { roomId: room.id } }),
      db.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: viewerId } }, select: { role: true } }),
      db.roomGame.findFirst({ where: { roomId: room.id }, orderBy: { createdAt: 'desc' }, select: { id: true, mode: true, state: true, createdAt: true } }),
    ]);
    const state = latestGame?.state as unknown as GameState | undefined;
    return { id: room.id, name: room.name, description: room.description, isPublic: room.isPublic,
      ownerName: owner?.displayName ?? 'Room owner', memberCount, isMember: !!membershipRow,
      role: membershipRow?.role ?? null, updatedAt: room.updatedAt.toISOString(),
      game: latestGame ? { id: latestGame.id, mode: modeFromDb(latestGame.mode), status: state?.status ?? 'created' } : null };
  }
  async function roomDetail(roomId: string, viewerId: string) {
    const room = await roomExists(roomId);
    const viewerMembership = await database().roomMember.findUnique({ where: { roomId_userId: { roomId, userId: viewerId } } });
    if (!room.isPublic && !viewerMembership) fail(404, 'Room not found.');
    const db = database();
    const [owner, memberships, comments, game] = await Promise.all([
      db.user.findUnique({ where: { id: room.ownerId }, select: { displayName: true } }),
      db.roomMember.findMany({ where: { roomId }, include: { user: { select: { id: true, displayName: true } } }, orderBy: { joinedAt: 'asc' } }),
      db.roomComment.findMany({ where: { roomId }, include: { user: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      db.roomGame.findFirst({ where: { roomId }, include: { invites: { include: { user: { select: { id: true, displayName: true } } } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const gameState = game?.state as unknown as GameState | undefined;
    return {
      id: room.id, name: room.name, description: room.description, isPublic: room.isPublic,
      ownerId: room.ownerId, ownerName: owner?.displayName ?? 'Room owner',
      viewerRole: viewerMembership?.role ?? null, viewerMicPermission: viewerMembership?.micPermission ?? null,
      members: memberships.map(item => ({ id: item.user.id, displayName: item.user.displayName,
        role: item.role, micPermission: item.micPermission, joinedAt: item.joinedAt.toISOString() })),
      comments: comments.reverse().map(item => ({ id: item.id, userId: item.userId, displayName: item.user.displayName, body: item.body, createdAt: item.createdAt.toISOString() })),
      game: game && gameState ? {
        id: game.id, mode: modeFromDb(game.mode), revision: game.revision, status: gameState.status,
        currentPlayerId: gameState.currentPlayerId, winnerId: gameState.winnerId,
        players: gameState.players.map(player => ({ id: player.id, start: player.start,
          displayName: game.invites.find(invite => invite.userId === player.id)?.user.displayName ?? 'Player',
          teamId: player.teamId, marbles: player.marbles.map(marble => ({ ...marble, location: { ...marble.location } })) })),
        invites: game.invites.map(invite => ({ userId: invite.userId,
          displayName: invite.user.displayName, seat: invite.seat, status: invite.status })),
        accepted: game.invites.find(invite => invite.userId === viewerId)?.status === 'ACCEPTED',
      } : null,
    };
  }
  async function gameForMember(roomId: string, gameId: string, userId: string) {
    await membership(roomId, userId);
    if (!validId(gameId)) fail(404, 'Game not found.');
    const game = await database().roomGame.findFirst({ where: { id: gameId, roomId }, include: { invites: true } });
    if (!game) fail(404, 'Game not found.');
    return game;
  }
  function privateGameView(game: { id: string; mode: RoomGameMode; revision: number; state: Prisma.JsonValue; invites: { userId: string; status: GameInviteStatus; seat: number }[] }, userId: string) {
    const state = game.state as unknown as GameState;
    const invite = game.invites.find(item => item.userId === userId);
    const canPlay = invite?.status === 'ACCEPTED' && state.status === 'playing' && state.currentPlayerId === userId;
    return { id: game.id, mode: modeFromDb(game.mode), revision: game.revision, status: state.status,
      viewerPlayerId: userId, joinedPlayers: game.invites.length, currentPlayerId: state.currentPlayerId,
      winnerId: state.winnerId, handNumber: state.handNumber, board: state.board,
      players: state.players.map(player => ({ id: player.id, start: player.start, teamId: player.teamId,
        marbles: player.marbles, cardCount: player.hand.length })),
      hand: canPlay ? state.players.find(player => player.id === userId)?.hand ?? [] : [],
      legalActions: canPlay ? getLegalActions(state) : [],
      discardCards: state.discard.slice(-5), discardCount: state.discard.length, lastAction: null,
      invitation: invite ? { seat: invite.seat, status: invite.status } : null,
      lastPlayed: state.discard.length ? state.discard[state.discard.length - 1] : null };
  }

  return {
    async createGuestSession(value: unknown) {
      const displayName = cleanDisplayName(value, 'Guest');
      const db = database();
      const user = await db.user.create({ data: { displayName, isGuest: true } });
      return { ...await newSession(user.id), user: { id: user.id, email: null, displayName: user.displayName, isGuest: true } };
    },
    async register(input: { email?: unknown; displayName?: unknown; password?: unknown }) {
      const email = cleanEmail(input.email);
      const displayName = cleanDisplayName(input.displayName, email.split('@')[0]!.slice(0, 40));
      const password = cleanPassword(input.password);
      const db = database();
      try {
        const user = await db.user.create({ data: { email, displayName, passwordHash: passwordDigest(password) } });
        const verificationLink = await issueEmailAction(user.id, email, 'VERIFY');
        return { verificationRequired: true, ...(verificationLink ? { verificationLink } : {}), user: { id: user.id, email, displayName, isGuest: false } };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, 'An account already uses that email.');
        throw error;
      }
    },
    async login(input: { email?: unknown; password?: unknown }) {
      const email = cleanEmail(input.email);
      const password = cleanPassword(input.password);
      const user = await database().user.findUnique({ where: { email } });
      if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) fail(401, 'Email or password is incorrect.');
      if (!user.emailVerifiedAt) fail(403, 'Verify your email before signing in.');
      return { ...await newSession(user.id), user: { id: user.id, email: user.email, displayName: user.displayName, isGuest: false } };
    },
    async signInProvider(providerValue: unknown, input: { idToken?: unknown; displayName?: unknown }) {
      if (providerValue !== 'google' && providerValue !== 'apple') fail(400, 'Choose Google or Apple sign-in.');
      const provider = providerValue as 'google' | 'apple';
      const claims = await verifyProviderToken(provider, input.idToken);
      const db = database();
      const identityProvider: IdentityProvider = provider === 'google' ? 'GOOGLE' : 'APPLE';
      let identity = await db.authIdentity.findUnique({ where: { provider_subject: { provider: identityProvider, subject: claims.subject } }, include: { user: true } });
      if (!identity) {
        const emailUser = claims.email ? await db.user.findUnique({ where: { email: claims.email } }) : null;
        const displayName = cleanDisplayName(claims.displayName ?? input.displayName, claims.email?.split('@')[0]?.slice(0, 40) || `${provider} player`);
        try {
          const user = await db.$transaction(async tx => {
            const linked = emailUser
              ? await tx.user.update({ where: { id: emailUser.id }, data: { emailVerifiedAt: emailUser.emailVerifiedAt ?? new Date() } })
              : await tx.user.create({ data: { email: claims.email, displayName, emailVerifiedAt: claims.email ? new Date() : null } });
            await tx.authIdentity.create({ data: { provider: identityProvider, subject: claims.subject, userId: linked.id } });
            return linked;
          });
          identity = { provider: identityProvider, subject: claims.subject, userId: user.id, createdAt: user.createdAt, user };
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            identity = await db.authIdentity.findUnique({ where: { provider_subject: { provider: identityProvider, subject: claims.subject } }, include: { user: true } });
          } else throw error;
        }
      }
      if (!identity) fail(401, 'Could not create your account. Try signing in again.');
      return { ...await newSession(identity.user.id), user: { id: identity.user.id, email: identity.user.email, displayName: identity.user.displayName, isGuest: false } };
    },
    async verifyEmail(token: unknown) {
      if (typeof token !== 'string' || token.length > 256) fail(400, 'Verification link is invalid or expired.');
      const db = database();
      const action = await db.emailActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!action || action.action !== 'VERIFY' || action.expiresAt <= new Date()) fail(400, 'Verification link is invalid or expired.');
      const user = await db.user.update({ where: { id: action.userId }, data: { emailVerifiedAt: new Date() } });
      await db.emailActionToken.deleteMany({ where: { userId: user.id, action: 'VERIFY' } });
      return { verified: true, email: user.email };
    },
    async resendVerification(value: unknown) {
      const email = cleanEmail(value);
      const user = await database().user.findUnique({ where: { email } });
      if (user && !user.emailVerifiedAt && user.passwordHash) await issueEmailAction(user.id, email, 'VERIFY');
      return { ok: true };
    },
    async requestPasswordReset(value: unknown) {
      const email = cleanEmail(value);
      const user = await database().user.findUnique({ where: { email } });
      if (user?.passwordHash && user.emailVerifiedAt) await issueEmailAction(user.id, email, 'RESET_PASSWORD');
      return { ok: true };
    },
    async resetPassword(token: unknown, passwordValue: unknown) {
      if (typeof token !== 'string' || token.length > 256) fail(400, 'Password reset link is invalid or expired.');
      const password = cleanPassword(passwordValue);
      const db = database();
      const action = await db.emailActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!action || action.action !== 'RESET_PASSWORD' || action.expiresAt <= new Date()) fail(400, 'Password reset link is invalid or expired.');
      await db.$transaction([
        db.user.update({ where: { id: action.userId }, data: { passwordHash: passwordDigest(password) } }),
        db.accountSession.deleteMany({ where: { userId: action.userId } }),
        db.emailActionToken.deleteMany({ where: { userId: action.userId, action: 'RESET_PASSWORD' } }),
      ]);
      return { ok: true };
    },
    async me(token: string) {
      const user = await userForToken(token);
      return { id: user.id, email: user.email, displayName: user.displayName, isGuest: user.isGuest };
    },
    async logout(token: string) {
      if (!token) return { ok: true };
      await database().accountSession.deleteMany({ where: { tokenHash: hashToken(token) } });
      return { ok: true };
    },
    async listRooms(token: string, scope: unknown = 'public') {
      const user = await userForToken(token);
      const db = database();
      const rooms = await db.communityRoom.findMany({
        where: scope === 'mine' ? { members: { some: { userId: user.id } } } : { isPublic: true },
        orderBy: { updatedAt: 'desc' }, take: 100,
      });
      return Promise.all(rooms.map(room => roomListItem(room, user.id)));
    },
    async createRoom(token: string, input: { name?: unknown; description?: unknown; isPublic?: unknown }) {
      const user = await userForToken(token);
      if (user.isGuest) fail(403, 'Sign in with an account to create rooms.');
      const name = cleanDisplayName(input.name, '');
      if (!name || [...name].length > 64) fail(400, 'Room name must contain 1 to 64 characters.');
      if (typeof input.description !== 'undefined' && (typeof input.description !== 'string' || [...input.description].length > 500)) fail(400, 'Room description must be 500 characters or fewer.');
      if (typeof input.isPublic !== 'undefined' && typeof input.isPublic !== 'boolean') fail(400, 'Choose whether the room is public.');
      const db = database();
      const description = typeof input.description === 'string' ? input.description.trim() : '';
      const room = await db.communityRoom.create({ data: { ownerId: user.id, name, description,
        isPublic: input.isPublic !== false, members: { create: { userId: user.id, role: 'OWNER' } } } });
      return roomDetail(room.id, user.id);
    },
    async joinRoom(token: string, roomId: string) {
      const user = await userForToken(token);
      const room = await roomExists(roomId);
      if (!room.isPublic) fail(404, 'Room not found.');
      await database().roomMember.upsert({ where: { roomId_userId: { roomId, userId: user.id } }, create: { roomId, userId: user.id }, update: {} });
      return roomDetail(roomId, user.id);
    },
    async getRoom(token: string, roomId: string) {
      const user = await userForToken(token);
      return roomDetail(roomId, user.id);
    },
    async comment(token: string, roomId: string, body: unknown) {
      const user = await userForToken(token);
      await membership(roomId, user.id);
      if (typeof body !== 'string' || !body.trim() || [...body.trim()].length > 500) fail(400, 'Comment must contain 1 to 500 characters.');
      await database().roomComment.create({ data: { roomId, userId: user.id, body: body.trim() } });
      return roomDetail(roomId, user.id);
    },
    async requestMic(token: string, roomId: string) {
      const user = await userForToken(token);
      const current = await membership(roomId, user.id);
      if (current.role === 'OWNER' || current.role === 'ADMIN') {
        if (current.micPermission !== 'SPEAKER') await database().$transaction(async tx => {
          const count = await tx.roomMember.count({ where: { roomId, micPermission: 'SPEAKER' } });
          if (count >= speakerLimit) fail(409, 'All eight microphone seats are in use.');
          await tx.roomMember.update({ where: { roomId_userId: { roomId, userId: user.id } }, data: { micPermission: 'SPEAKER' } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return roomDetail(roomId, user.id);
      }
      await database().roomMember.update({ where: { roomId_userId: { roomId, userId: user.id } }, data: { micPermission: 'REQUESTED' } });
      return roomDetail(roomId, user.id);
    },
    async setMicPermission(token: string, roomId: string, targetId: string, permission: unknown) {
      const user = await userForToken(token);
      await requireAdmin(roomId, user.id);
      if (!validId(targetId)) fail(404, 'Room member not found.');
      if (!['AUDIENCE', 'SPEAKER'].includes(String(permission))) fail(400, 'Choose speaker or audience permission.');
      const selected = permission as MicPermission;
      if (selected === 'SPEAKER') {
        await database().$transaction(async tx => {
          const target = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId: targetId } } });
          if (!target) fail(404, 'Room member not found.');
          if (target.micPermission !== 'SPEAKER') {
            const count = await tx.roomMember.count({ where: { roomId, micPermission: 'SPEAKER' } });
            if (count >= speakerLimit) fail(409, 'All eight microphone seats are in use.');
          }
          await tx.roomMember.update({ where: { roomId_userId: { roomId, userId: targetId } }, data: { micPermission: selected } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } else {
        await database().roomMember.update({ where: { roomId_userId: { roomId, userId: targetId } }, data: { micPermission: selected } });
      }
      return roomDetail(roomId, user.id);
    },
    async voiceSession(token: string, roomId: string, config: { url?: string; apiKey?: string; apiSecret?: string }) {
      const user = await userForToken(token);
      const member = await membership(roomId, user.id);
      const db = database();
      const [count, profile] = await Promise.all([
        db.roomMember.count({ where: { roomId, micPermission: 'SPEAKER' } }),
        db.user.findUnique({ where: { id: user.id }, select: { displayName: true } }),
      ]);
      if (member.micPermission === 'SPEAKER' && count > speakerLimit) fail(409, 'Microphone access is full.');
      const url = config.url?.trim(), key = config.apiKey?.trim(), secret = config.apiSecret?.trim();
      if (!url || !key || !secret) fail(503, 'Voice chat is not available yet. Try again later.');
      try { const parsed = new URL(url); if (parsed.protocol !== 'wss:' || parsed.username || parsed.password) throw new Error(); }
      catch { fail(503, 'Voice chat is not available yet. Try again later.'); }
      const { AccessToken, TrackSource } = await import('livekit-server-sdk');
      const access = new AccessToken(key, secret, { identity: user.id, name: profile?.displayName, ttl: '10m' });
      access.addGrant({ roomJoin: true, room: `community-${roomId}`, canPublish: member.micPermission === 'SPEAKER', canSubscribe: true,
        canPublishData: false, canPublishSources: member.micPermission === 'SPEAKER' ? [TrackSource.MICROPHONE] : [], canUpdateOwnMetadata: false });
      return { serverUrl: url, participantToken: await access.toJwt(), micPermission: member.micPermission };
    },
    async createGame(token: string, roomId: string, input: { mode?: unknown; playerIds?: unknown }) {
      const user = await userForToken(token);
      await requireAdmin(roomId, user.id);
      const mode = input.mode;
      if (mode !== '1v1' && mode !== '3p' && mode !== '4p' && mode !== '2v2') fail(400, 'Choose a supported game mode.');
      const count = playerCount(mode as GameMode);
      if (!Array.isArray(input.playerIds) || input.playerIds.length !== count || new Set(input.playerIds).size !== count || !input.playerIds.every(id => typeof id === 'string'))
        fail(400, `Invite exactly ${count} room members to play.`);
      const playerIds = input.playerIds as string[];
      if (!playerIds.every(validId)) fail(400, 'Invalid player account.');
      const members = await database().roomMember.findMany({ where: { roomId, userId: { in: playerIds } } });
      if (members.length !== count) fail(400, 'Only room members can be invited to play.');
      const state = createGame(playerIds, { mode: mode as GameMode });
      const game = await database().roomGame.create({ data: { roomId, mode: modeToDb(mode as GameMode), state: state as unknown as Prisma.InputJsonValue,
        invites: { create: playerIds.map((userId, seat) => ({ userId, seat, status: 'PENDING' })) } } });
      return { id: game.id, revision: game.revision, mode, status: state.status, invites: playerIds };
    },
    async acceptGameInvite(token: string, roomId: string, gameId: string) {
      const user = await userForToken(token);
      const game = await gameForMember(roomId, gameId, user.id);
      const invite = game.invites.find(item => item.userId === user.id);
      if (!invite) fail(403, 'You were not invited to play.');
      if (invite.status !== 'ACCEPTED') {
        const next = structuredClone(game.state as unknown as GameState);
        await database().$transaction(async tx => {
          await tx.roomGameInvite.update({ where: { gameId_userId: { gameId, userId: user.id } }, data: { status: 'ACCEPTED' } });
          const otherPending = await tx.roomGameInvite.count({ where: { gameId, status: 'PENDING' } });
          if (otherPending === 0 && next.status === 'created') {
            const started = startGame(next);
            await tx.roomGame.update({ where: { id: gameId }, data: { state: started as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      }
      const updated = await gameForMember(roomId, gameId, user.id);
      return privateGameView(updated, user.id);
    },
    async getGame(token: string, roomId: string, gameId: string) {
      const user = await userForToken(token);
      return privateGameView(await gameForMember(roomId, gameId, user.id), user.id);
    },
    async actGame(token: string, roomId: string, gameId: string, revision: unknown, action: unknown) {
      const user = await userForToken(token);
      const game = await gameForMember(roomId, gameId, user.id);
      if (!Number.isInteger(revision) || revision !== game.revision) fail(409, 'Game changed. Refresh before playing.');
      if (!action || typeof action !== 'object' || Array.isArray(action)) fail(400, 'Invalid game action.');
      const invite = game.invites.find(item => item.userId === user.id);
      if (invite?.status !== 'ACCEPTED') fail(403, 'Accept the game invitation before playing.');
      const state = game.state as unknown as GameState;
      if ((action as GameAction).playerId !== user.id || state.currentPlayerId !== user.id) fail(403, 'Wait for your turn.');
      const next = applyAction(state, action as GameAction);
      const saved = await database().roomGame.updateMany({ where: { id: gameId, revision: game.revision },
        data: { state: next as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
      if (saved.count !== 1) fail(409, 'Game changed. Refresh before playing.');
      return privateGameView({ ...game, state: next as unknown as Prisma.JsonValue, revision: game.revision + 1 }, user.id);
    },
    async countSpeakers(roomId: string, token: string) {
      const user = await userForToken(token);
      await membership(roomId, user.id);
      return database().roomMember.count({ where: { roomId, micPermission: 'SPEAKER' } });
    },
  };
}
