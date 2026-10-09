CREATE TYPE "RoomRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "MicPermission" AS ENUM ('AUDIENCE', 'REQUESTED', 'SPEAKER');
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'APPLE');
CREATE TYPE "EmailAction" AS ENUM ('VERIFY', 'RESET_PASSWORD');
CREATE TYPE "RoomGameMode" AS ENUM ('PLAYER_1V1', 'PLAYER_3', 'PLAYER_4', 'TEAM_2V2');
CREATE TYPE "GameInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254),
    "displayName" VARCHAR(40) NOT NULL,
    "passwordHash" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "AuthIdentity" (
    "provider" "IdentityProvider" NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("provider", "subject"),
    CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

CREATE TABLE "EmailActionToken" (
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "action" "EmailAction" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EmailActionToken_pkey" PRIMARY KEY ("tokenHash"),
    CONSTRAINT "EmailActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EmailActionToken_userId_action_idx" ON "EmailActionToken"("userId", "action");
CREATE INDEX "EmailActionToken_expiresAt_idx" ON "EmailActionToken"("expiresAt");

CREATE TABLE "AccountSession" (
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AccountSession_pkey" PRIMARY KEY ("tokenHash"),
    CONSTRAINT "AccountSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AccountSession_userId_idx" ON "AccountSession"("userId");
CREATE INDEX "AccountSession_expiresAt_idx" ON "AccountSession"("expiresAt");

CREATE TABLE "CommunityRoom" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CommunityRoom_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommunityRoom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CommunityRoom_isPublic_updatedAt_idx" ON "CommunityRoom"("isPublic", "updatedAt");
CREATE INDEX "CommunityRoom_ownerId_idx" ON "CommunityRoom"("ownerId");

CREATE TABLE "RoomMember" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "RoomRole" NOT NULL DEFAULT 'MEMBER',
    "micPermission" "MicPermission" NOT NULL DEFAULT 'AUDIENCE',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("roomId", "userId"),
    CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RoomMember_userId_joinedAt_idx" ON "RoomMember"("userId", "joinedAt");
CREATE INDEX "RoomMember_roomId_micPermission_idx" ON "RoomMember"("roomId", "micPermission");

CREATE TABLE "RoomComment" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomComment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RoomComment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RoomComment_roomId_createdAt_idx" ON "RoomComment"("roomId", "createdAt");

CREATE TABLE "RoomGame" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "mode" "RoomGameMode" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomGame_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RoomGame_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RoomGame_roomId_createdAt_idx" ON "RoomGame"("roomId", "createdAt");

CREATE TABLE "RoomGameInvite" (
    "gameId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "status" "GameInviteStatus" NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "RoomGameInvite_pkey" PRIMARY KEY ("gameId", "userId"),
    CONSTRAINT "RoomGameInvite_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "RoomGame"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomGameInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RoomGameInvite_gameId_seat_key" ON "RoomGameInvite"("gameId", "seat");
CREATE INDEX "RoomGameInvite_userId_status_idx" ON "RoomGameInvite"("userId", "status");
