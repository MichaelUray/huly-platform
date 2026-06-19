-- V32 — Backfill run tracking + batch_id index + idempotency unique.

CREATE INDEX IF NOT EXISTS idx_wal_batch
  ON workspace_audit_log (workspace, (metadata->>'batch_id'))
  WHERE (metadata->>'batch_id') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wal_backfill_unique
  ON workspace_audit_log (workspace, action, target_account, target_space, (metadata->>'backfill_run'))
  WHERE (metadata->>'backfill_run') IS NOT NULL;

CREATE TABLE IF NOT EXISTS wal_backfill_run (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace       UUID NOT NULL,
  state           TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  last_cursor     TEXT,
  batch_id        UUID,
  retry_count     INT NOT NULL DEFAULT 0,
  failure_reason  TEXT
);
