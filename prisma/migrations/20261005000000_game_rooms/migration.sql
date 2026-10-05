CREATE TABLE "GameRoom" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "tokenHashes" TEXT[] NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GameRoom_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameRoom_code_key" ON "GameRoom"("code");
CREATE INDEX "GameRoom_expiresAt_idx" ON "GameRoom"("expiresAt");
