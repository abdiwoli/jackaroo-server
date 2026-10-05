# Vercel backend deployment

This repository deploys as a Node HTTP backend, using `src/server.ts`.
`src/index.ts` keeps the existing local `npm run dev` and `npm start` commands working.
`vercel.json` selects the Node framework instead of static website output.

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

Storage remains in memory in this deployment fix. Durable game/session storage
is a separate follow-up.

Reference: https://vercel.com/docs/functions/runtimes/node-js
