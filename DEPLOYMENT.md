# Vercel backend deployment

This repository deploys as a Vercel Node function, using `src/vercel.ts`.
`src/index.ts` keeps the existing local `npm run dev` and `npm start` commands working.
`vercel.json` explicitly builds that handler with `@vercel/node` and routes all
requests to it, preserving paths such as `/health`. The function exports an async
request handler and does not start a listening socket. Local startup continues to
use `src/server.ts`. Both entry points share the same application handler.

For the standalone `jackaroo-server` GitHub repository:

1. Keep Vercel's Root Directory at the repository root.
2. Disable any Output Directory override in Settings > Build and Deployment.
   Do not set it to `public` or `dist`; Vercel packages the server as a function.
3. Commit and push these changes, then deploy the new commit.
4. Open `https://YOUR_DEPLOYMENT/health`. Expect
   `{"status":"ok","service":"jackaroo-server"}`.
5. Set the mobile app's Backend URL to `https://YOUR_DEPLOYMENT`.

If deploying from a parent repository containing both projects, set Root Directory
to `jackaroo-server` instead.

Room storage defaults to memory until PostgreSQL is configured. See
[PostgreSQL activation](POSTGRES-ROOMS.md) for migrations, environment variables,
and database verification.

Reference: https://vercel.com/docs/functions/runtimes/node-js
