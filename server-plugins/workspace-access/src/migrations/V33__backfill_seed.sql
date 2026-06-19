-- V33 — Seed one `wal_backfill_run` row per existing workspace.
-- DEPENDENCY: assumes a `workspaces` table with a `uuid` column. The
-- DO-block wrapper makes this migration a no-op on installs that don't
-- have that table provisioned (e.g. a bare bootstrap), so the runner
-- doesn't crash. CONFIRM the column name against your deployment
-- before relying on this; rename here if your schema uses `id` or
-- `workspace_uuid` instead.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'workspaces'
  ) THEN
    INSERT INTO wal_backfill_run (workspace, state, started_at)
    SELECT w.uuid, 'running', now()
    FROM workspaces w
    WHERE NOT EXISTS (
      SELECT 1 FROM wal_backfill_run b WHERE b.workspace = w.uuid
    );
  END IF;
END $$;
