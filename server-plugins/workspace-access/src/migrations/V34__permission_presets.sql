-- V34 — Workspace-local permission presets (role + space templates).
--
-- Each row defines a reusable "Role + addToSpaces[]" shape that an Owner
-- (or impersonating instance-admin) can apply to one or more workspace
-- members in a single click. Snapshot-at-Apply semantics: the shape is
-- copied into the audit row at apply-time, so later edits to the preset
-- do NOT change which members were already configured.
--
-- Tier-1 scope (per spec):
--   - Workspace-local (no system-wide sharing)
--   - shape JSONB carries only `role` + `addToSpaces` for v1
--     (doc-permissions / custom-attributes are deferred to v2)
--   - UNIQUE (workspace, name) so the Owner picks a stable label
--
-- IF NOT EXISTS guards keep the migration forward-only and idempotent,
-- matching the V31/V32 contract enforced by migrations.test.ts.

CREATE TABLE IF NOT EXISTS workspace_access_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  shape       JSONB NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace, name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_access_presets_ws
  ON workspace_access_presets (workspace);
