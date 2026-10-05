# PostgreSQL room storage

Neon migration and live database verification completed on 2026-10-05.
Production Vercel room storage is enabled with `ROOM_STORAGE=postgres`.
The frontend's existing create/join/refresh/action calls stay the same:

| Endpoint | Behavior |
| --- | --- |
| `POST /online-games` | Persist a waiting room and return the host's private token |
| `POST /online-games/join` | Atomically claim the second seat using `{code}` |
| `GET /online-games/:id` | Load a private view using the bearer token |
| `POST /online-games/:id/actions` | Validate `{revision, action}` and atomically save the next state |

`GameRoom` stores the full engine state and last animation in JSON, with separate
revision, unique room code, token hashes, and timestamps. Private hands stay in
the server state; responses include only the requesting player's hand. Tokens
are stored as SHA-256 hashes; raw tokens are returned only to their player.

Joins and moves update only a row with the expected revision and an unexpired
timestamp. Competing requests receive HTTP 409. Database failure returns HTTP
503; the app never switches to memory after a PostgreSQL failure.

## Enable when the database is available

1. Set `DATABASE_URL` to your PostgreSQL connection string in the environment used
   to run the migration. Apply the committed schema with:

   ```powershell
   npm.cmd run prisma:migrate:deploy
   ```

   If your provider gives separate pooled and direct URLs, use its direct URL for
   migrations and its Prisma-compatible pooled URL for the deployed application.

2. In Vercel set `DATABASE_URL` and `ROOM_STORAGE=postgres`, then redeploy.
   Prisma Client generation runs during installation and `vercel-build`.
3. Create a new room, join from another device, play, then verify that both seats
   still work after a backend redeploy. Existing in-memory rooms are not migrated.
4. For automated database verification, migrate a disposable test database,
   set `TEST_DATABASE_URL` to its URL, and run `npm.cmd run test:postgres`.
   This test uses three independent Prisma clients and competing joins/moves.

Before step 2, `ROOM_STORAGE=memory` (the default) preserves the existing
prototype behavior and remains temporary on Vercel. `/health` is a process health
check; it does not verify database connectivity or migration status.

Rooms expire 24 hours after their last join or move. Expired rows are cleaned on
room creation. Local/computer games remain in memory. Native session restoration
is separate work: this change preserves server rooms but does not save Android
tokens across an app restart.
