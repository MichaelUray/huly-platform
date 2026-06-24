//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Inlined V34 SQL. Mirrors V34__permission_presets.sql in this directory;
// the .sql copy is the human-readable source for review and for direct
// execution via psql, the .ts copy is what callers consume.
//
// V34 adds the `workspace_access_presets` table. Workspace-local
// Role+Spaces templates that Owners can apply to selected members
// with snapshot-at-apply semantics.
//

export const V34_SQL = `
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
`
