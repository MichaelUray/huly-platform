// V33 — seed wal_backfill_run rows per workspace.
//
// DEPENDENCY: assumes a `workspaces` table with a `uuid` column. In the
// upstream Huly account-server (post-#10883) workspace metadata is
// tracked in `workspaces(uuid, url, ...)`; CONFIRM the column name +
// presence against the deployment's actual schema before applying this
// migration. If the dev DB uses a different name (e.g. `workspace`
// singular, or `id` instead of `uuid`), edit this SQL accordingly OR
// skip V33 entirely and let the orchestrator create the rows lazily on
// first backfill request.
//
// Wrap in DO block so the migration is a no-op when the workspaces
// table is absent — avoids breaking the runner on installs that don't
// have it provisioned yet.
export const V33_SQL = `
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
`
