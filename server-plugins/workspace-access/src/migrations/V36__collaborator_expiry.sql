--
-- V34 — Time-bounded Grants (DSGVO Art. 5 Abs. 1 lit. e, Datensparsamkeit).
--
-- Adds an optional expiry timestamp to the `collaborator` table.
--   NULL          → grant is permanent (current behaviour, default)
--   TIMESTAMPTZ   → grant auto-expires at the given instant; the
--                   background prune job in account-service removes
--                   rows where `expires_at < now()` and emits a
--                   `grant_expired` audit event.
--
-- The partial index covers only non-NULL rows so that the prune job's
-- `WHERE expires_at < now()` scan stays cheap even on workspaces with
-- millions of permanent grants.
--
-- Wrapped in a presence check so the migration is a no-op on installs
-- that do not yet have a `collaborator` table (test bootstraps, fresh
-- HA-only deployments). Matches the V33 pattern.
--

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'collaborator'
  ) THEN
    ALTER TABLE collaborator
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

    CREATE INDEX IF NOT EXISTS idx_collaborator_expires
      ON collaborator (expires_at)
      WHERE expires_at IS NOT NULL;
  END IF;
END $$;
