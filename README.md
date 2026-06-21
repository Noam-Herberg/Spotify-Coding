# Song Battle

A private shared Spotify battle app. Friends compare semi-random songs, and every vote updates one group Elo leaderboard transactionally.

## Architecture

- Static browser UI and Vercel Functions
- Spotify Authorization Code OAuth managed by the server
- Spotify Web Playback SDK for full-track playback
- Neon Postgres for users, sessions, memberships, battles, votes, and ratings
- One invite-only group; the first member to join becomes owner

Full-track playback requires Spotify Premium. While the Spotify app is in development mode, add every friend as an approved app user in the Spotify dashboard.

## Local setup

Requirements: Node.js 18+, npm, a Neon database, and a Spotify developer app.

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and configure every value. Generate separate strong random values for `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`.

3. In the Spotify Developer Dashboard, add:

   `http://127.0.0.1:3000/api/auth/callback`

4. Apply the database schema:

   ```powershell
   npm run db:migrate
   ```

5. Start the Vercel-compatible local server:

   ```powershell
   npm run dev
   ```

6. Open `http://127.0.0.1:3000`.

## Vercel deployment

1. Import the repository into Vercel and attach a Neon Postgres database.
2. Add all variables from `.env.example` to the Production environment. Set `APP_URL` to the final HTTPS origin without a trailing slash.
3. Run `npm run db:migrate` once against the production `DATABASE_URL`.
4. Add `https://<production-domain>/api/auth/callback` to the Spotify app.
5. Deploy. Spotify login on preview URLs is intentionally unsupported unless each preview callback is registered separately.

After deployment, open `/api/health`. It reports missing environment-variable names, database connectivity, schema readiness, and the exact Spotify callback URL without exposing any secret values.

Never expose `SPOTIFY_CLIENT_SECRET`, `DATABASE_URL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, or `GROUP_INVITE_CODE` to browser code.

## Shared ranking behavior

- New songs start at 1000 Elo.
- K-factor is 32.
- Genre and decade affect discovery only; every valid vote updates the same global group rating.
- The server issues each battle and accepts one vote for it.
- Vote transactions lock both rating rows before calculating changes.
- Authenticated members are limited to 120 issued battles and 120 votes per hour.
- Standings refresh immediately after a vote and every 30 seconds.
- Only the first group member can reset all standings.

## Tests

```powershell
npm test
```

The local suite checks Elo calculations and discovery filter generation. OAuth, Neon transactions, Spotify playback, and Vercel routing require configured integration environments.
