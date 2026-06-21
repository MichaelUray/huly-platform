//
// Inlined V35 SQL. Mirrored from V35__workspace_access_webhooks.sql in
// this directory; the .sql copy is the human-readable source for review
// and direct execution via psql; the .ts copy is what callers consume.
//

export const V35_SQL = `
CREATE TABLE IF NOT EXISTS workspace_access_webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace   TEXT NOT NULL,
  url         TEXT NOT NULL,
  secret      TEXT,
  event_types TEXT[] NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  data_filter TEXT NOT NULL DEFAULT 'minimal',
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_ws
  ON workspace_access_webhooks (workspace, active);
`
