-- V31 — workspace_audit_log table for the Workspace Access Center.
-- Hash-sharded primary key spreads hot inserts across 8 ranges. The
-- four secondary indexes cover the documented query patterns in
-- docs/superpowers/specs/2026-06-18-huly-workspace-access-center-design.md
-- (§Audit Log → Query patterns and index coverage).

CREATE TABLE IF NOT EXISTS workspace_audit_log (
  id                       UUID NOT NULL DEFAULT gen_random_uuid(),
  workspace                UUID NOT NULL,
  ts                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  action                   TEXT NOT NULL,
  actor                    UUID,
  actor_pseudonym          TEXT,
  actor_role               TEXT NOT NULL,
  target_account           UUID,
  target_account_pseudonym TEXT,
  target_space             TEXT,
  target_space_class       TEXT,
  old_value                JSONB,
  new_value                JSONB,
  metadata                 JSONB,
  PRIMARY KEY (workspace, ts, id) USING HASH WITH (bucket_count = 8)
);

CREATE INDEX IF NOT EXISTS idx_wal_actor
  ON workspace_audit_log (workspace, actor, ts DESC)
  WHERE actor IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wal_target_account
  ON workspace_audit_log (workspace, target_account, ts DESC)
  WHERE target_account IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wal_target_space
  ON workspace_audit_log (workspace, target_space, ts DESC)
  WHERE target_space IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wal_action
  ON workspace_audit_log (workspace, action, ts DESC);
