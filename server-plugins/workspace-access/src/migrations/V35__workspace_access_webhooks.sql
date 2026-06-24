--
-- V35 — workspace_access_webhooks table.
--
-- Stores outbound webhook subscriptions for WAC audit events
-- (role_changed, grant_created, member_removed, grant_expired, etc.).
--
-- data_filter
--   'minimal' (DEFAULT, DSGVO-friendly): payload carries only UUIDs +
--                action + timestamp. NO email/name leaves the system.
--   'full'   : payload additionally carries email + display name.
--              Workspace owner must explicit-opt-in when creating the
--              subscription; the UI surfaces a warning about the
--              DSGVO-implications of pushing PII to external systems.
--
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
