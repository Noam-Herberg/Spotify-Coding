BEGIN;

ALTER TABLE party_rooms
  ADD COLUMN IF NOT EXISTS rounds_played integer NOT NULL DEFAULT 0;

ALTER TABLE party_players
  ADD COLUMN IF NOT EXISTS overall_score integer NOT NULL DEFAULT 0;

COMMIT;
