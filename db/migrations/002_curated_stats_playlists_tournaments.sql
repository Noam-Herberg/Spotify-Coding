BEGIN;

ALTER TABLE battles ADD COLUMN IF NOT EXISTS source_mode text NOT NULL DEFAULT 'random';
ALTER TABLE battles ADD COLUMN IF NOT EXISTS curated_source_type text;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS curated_playlist_id uuid;

CREATE TABLE IF NOT EXISTS nominations (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES tracks(spotify_id) ON DELETE CASCADE,
  nominated_by text NOT NULL REFERENCES users(spotify_user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, track_id)
);

CREATE TABLE IF NOT EXISTS imported_playlists (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  spotify_playlist_id text NOT NULL,
  name text NOT NULL,
  image_url text NOT NULL DEFAULT '',
  spotify_url text NOT NULL DEFAULT '',
  imported_by text NOT NULL REFERENCES users(spotify_user_id),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, spotify_playlist_id)
);

CREATE TABLE IF NOT EXISTS imported_playlist_tracks (
  playlist_id uuid NOT NULL REFERENCES imported_playlists(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES tracks(spotify_id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  size integer NOT NULL CHECK (size IN (8,16)),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled')),
  created_by text NOT NULL REFERENCES users(spotify_user_id),
  champion_track_id text REFERENCES tracks(spotify_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_tournament_per_group
  ON tournaments(group_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES tracks(spotify_id),
  seed integer,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, track_id),
  UNIQUE (tournament_id, seed)
);

CREATE TABLE IF NOT EXISTS tournament_members (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  spotify_user_id text NOT NULL REFERENCES users(spotify_user_id),
  PRIMARY KEY (tournament_id, spotify_user_id)
);

CREATE TABLE IF NOT EXISTS tournament_matchups (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round integer NOT NULL,
  position integer NOT NULL,
  left_track_id text REFERENCES tracks(spotify_id),
  right_track_id text REFERENCES tracks(spotify_id),
  winner_track_id text REFERENCES tracks(spotify_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','open','closed')),
  closed_at timestamptz,
  UNIQUE (tournament_id, round, position)
);

CREATE TABLE IF NOT EXISTS tournament_votes (
  id uuid PRIMARY KEY,
  matchup_id uuid NOT NULL REFERENCES tournament_matchups(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  voter_user_id text NOT NULL REFERENCES users(spotify_user_id),
  winner_track_id text NOT NULL REFERENCES tracks(spotify_id),
  loser_track_id text NOT NULL REFERENCES tracks(spotify_id),
  winner_rating_before integer NOT NULL,
  winner_rating_after integer NOT NULL,
  loser_rating_before integer NOT NULL,
  loser_rating_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matchup_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS nominations_group_created_idx ON nominations(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS imported_playlists_group_idx ON imported_playlists(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tournament_group_created_idx ON tournaments(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tournament_votes_group_created_idx ON tournament_votes(group_id, created_at DESC);

COMMIT;
