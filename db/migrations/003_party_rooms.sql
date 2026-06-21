BEGIN;

CREATE TABLE IF NOT EXISTS party_rooms (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{6}$'),
  host_user_id text NOT NULL REFERENCES users(spotify_user_id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'lobby' CHECK (phase IN ('lobby','picking','reveal','playing','results','ended')),
  max_bracket_size integer NOT NULL DEFAULT 16 CHECK (max_bracket_size IN (16,32)),
  bracket_size integer,
  random_count integer,
  current_matchup_id uuid,
  version bigint NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS party_rooms_host_active_idx
  ON party_rooms(host_user_id, expires_at) WHERE phase <> 'ended';

CREATE TABLE IF NOT EXISTS party_players (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30),
  token_hash text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS party_players_room_name_idx
  ON party_players(room_id, lower(display_name));

CREATE TABLE IF NOT EXISTS party_songs (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES tracks(spotify_id),
  owner_player_id uuid REFERENCES party_players(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('pick','missing_fill','surprise','replacement')),
  seed integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, track_id),
  UNIQUE (room_id, seed)
);

CREATE TABLE IF NOT EXISTS party_matchups (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  round integer NOT NULL,
  position integer NOT NULL,
  song_a_id uuid REFERENCES party_songs(id),
  song_b_id uuid REFERENCES party_songs(id),
  winner_song_id uuid REFERENCES party_songs(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','listening','voting','revote','host_tiebreak','complete')),
  vote_attempt integer NOT NULL DEFAULT 1 CHECK (vote_attempt IN (1,2)),
  played_a boolean NOT NULL DEFAULT false,
  played_b boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, round, position),
  CHECK (song_a_id IS NULL OR song_b_id IS NULL OR song_a_id <> song_b_id)
);

CREATE TABLE IF NOT EXISTS party_votes (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  matchup_id uuid NOT NULL REFERENCES party_matchups(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt IN (1,2)),
  player_id uuid NOT NULL REFERENCES party_players(id) ON DELETE CASCADE,
  song_id uuid NOT NULL REFERENCES party_songs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matchup_id, attempt, player_id)
);

CREATE TABLE IF NOT EXISTS party_rate_limits (
  key text PRIMARY KEY,
  window_started timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS party_rooms_code_idx ON party_rooms(code);
CREATE INDEX IF NOT EXISTS party_players_room_idx ON party_players(room_id);
CREATE INDEX IF NOT EXISTS party_songs_room_idx ON party_songs(room_id);
CREATE INDEX IF NOT EXISTS party_matchups_room_round_idx ON party_matchups(room_id, round, position);
CREATE INDEX IF NOT EXISTS party_votes_matchup_idx ON party_votes(matchup_id, attempt);

COMMIT;
