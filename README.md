# Song Battle Party

A co-located music party game. One Host signs into Spotify Premium on a laptop or TV, while players join from their phones with a room code, privately submit two songs, and vote through a single-elimination bracket.

## Architecture

- Static Host, player, and landing pages deployed on Vercel
- One consolidated party-game Vercel Function to remain within Hobby limits
- Server-managed Spotify Authorization Code OAuth and encrypted refresh tokens
- Spotify Web Playback SDK on the Host board only
- Anonymous, hashed guest sessions for player phones
- Neon Postgres as the authoritative room, bracket, and vote store
- Two-second version-based polling; no WebSocket dependency

Spotify Premium is required only for the Host. Guest players do not authenticate with Spotify and do not consume Spotify Development Mode user slots.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure it.
3. Register `http://127.0.0.1:3000/api/auth/callback` in Spotify.
4. Apply migrations with `npm run db:migrate`.
5. Run `npm run dev` and open `http://127.0.0.1:3000`.

For production, set `APP_URL` to the final HTTPS origin, register its `/api/auth/callback`, apply migrations to the production Neon database, and redeploy. `/api/health` checks configuration, database access, and the party schema without exposing secrets.

## Game rules

- A 16-song room supports up to 7 active players; a 32-song room supports up to 15.
- Each player gets two owned songs. Missing picks are filled randomly and assigned to that player.
- At least two additional surprise songs are unowned.
- Submitters remain hidden until the final result.
- Everyone may vote for their own song.
- One tied vote triggers a re-vote; a second tie is decided by the Host.
- Curators score one point for each matchup won by an owned song.
- Rooms expire after 24 hours.

Legacy Elo, nomination, playlist, and tournament tables remain in the database for rollback, but their routes and UI are no longer active.

## Tests

Run `npm test`. OAuth, Spotify playback, and Neon transaction flows additionally require configured integration environments.
