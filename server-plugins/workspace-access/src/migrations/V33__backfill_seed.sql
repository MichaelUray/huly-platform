-- V33 — Seed one `wal_backfill_run` row per existing workspace so the
-- background orchestrator can pick them up and replay current
-- workspace state into the audit log. Idempotent: existing rows are
-- preserved (no overwrite of `state` or `last_cursor`).

INSERT INTO wal_backfill_run (workspace, state, started_at)
SELECT w.uuid, 'running', now()
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM wal_backfill_run b WHERE b.workspace = w.uuid
);
