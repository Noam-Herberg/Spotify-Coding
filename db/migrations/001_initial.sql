BEGIN;

CREATE TABLE IF NOT EXISTS users (
  spotify_user_id text PRIMARY KEY,
  display_name text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spotify_accounts (
  spotify_user_id text PRIMARY KEY REFERENCES users(spotify_user_id) ON DELETE CASCADE,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  spotify_user_id text NOT NULL REFERENCES users(spotify_user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_user_id text REFERENCES users(spotify_user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  spotify_user_id text NOT NULL REFERENCES users(spotify_user_id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, spotify_user_id)
);

CREATE TABLE IF NOT EXISTS tracks (
  spotify_id text PRIMARY KEY,
  uri text NOT NULL,
  name text NOT NULL,
  artist text NOT NULL,
  album text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  spotify_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_track_ratings (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES tracks(spotify_id) ON DELETE CASCADE,
  rating integer NOT NULL DEFAULT 1000,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, track_id)
);

CREATE TABLE IF NOT EXISTS battles (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  voter_user_id text NOT NULL REFERENCES users(spotify_user_id),
  left_track_id text NOT NULL REFERENCES tracks(spotify_id),
  right_track_id text NOT NULL REFERENCES tracks(spotify_id),
  genre text NOT NULL,
  decade text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'voted')),
  winner_track_id text REFERENCES tracks(spotify_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voted_at timestamptz,
  CHECK (left_track_id <> right_track_id)
);

CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY,
  battle_id uuid NOT NULL UNIQUE REFERENCES battles(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  voter_user_id text NOT NULL REFERENCES users(spotify_user_id),
  winner_track_id text NOT NULL REFERENCES tracks(spotify_id),
  loser_track_id text NOT NULL REFERENCES tracks(spotify_id),
  winner_rating_before integer NOT NULL,
  winner_rating_after integer NOT NULL,
  loser_rating_before integer NOT NULL,
  loser_rating_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(spotify_user_id);
CREATE INDEX IF NOT EXISTS battles_user_created_idx ON battles(voter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS votes_group_created_idx ON votes(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ratings_group_rating_idx ON group_track_ratings(group_id, rating DESC);

COMMIT;
