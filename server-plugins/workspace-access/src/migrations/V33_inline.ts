export const V33_SQL = `
INSERT INTO wal_backfill_run (workspace, state, started_at)
SELECT w.uuid, 'running', now()
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM wal_backfill_run b WHERE b.workspace = w.uuid
);
`
