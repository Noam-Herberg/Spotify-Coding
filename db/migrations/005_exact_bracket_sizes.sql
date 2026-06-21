BEGIN;

ALTER TABLE party_rooms
  ADD COLUMN IF NOT EXISTS rounds_played integer NOT NULL DEFAULT 0;

ALTER TABLE party_players
  ADD COLUMN IF NOT EXISTS overall_score integer NOT NULL DEFAULT 0;

ALTER TABLE party_rooms
  DROP CONSTRAINT IF EXISTS party_rooms_max_bracket_size_check;

ALTER TABLE party_rooms
  ADD CONSTRAINT party_rooms_max_bracket_size_check
  CHECK (max_bracket_size IN (8,16,32));

COMMIT;
