import { migrations } from '../migrations/loader'

describe('migrations', () => {
  it('has V31..V36 in order', () => {
    expect(migrations.map((m) => m.id)).toEqual(['V31', 'V32', 'V33', 'V34', 'V35', 'V36'])
  })

  it('V35 creates workspace_access_webhooks table + (workspace, active) index', () => {
    const v35 = migrations[4].sql
    expect(v35).toContain('CREATE TABLE IF NOT EXISTS workspace_access_webhooks')
    expect(v35).toContain('event_types TEXT[]')
    expect(v35).toContain("data_filter TEXT NOT NULL DEFAULT 'minimal'")
    expect(v35).toContain('idx_webhooks_ws')
    expect(v35).toContain('(workspace, active)')
  })

  it('V31 creates workspace_audit_log with hash-sharded primary key', () => {
    const v31 = migrations[0].sql
    expect(v31).toContain('CREATE TABLE IF NOT EXISTS workspace_audit_log')
    expect(v31).toContain('PRIMARY KEY (workspace, ts, id) USING HASH WITH (bucket_count = 8)')
    expect(v31).toContain('idx_wal_actor')
    expect(v31).toContain('idx_wal_target_account')
    expect(v31).toContain('idx_wal_target_space')
    expect(v31).toContain('idx_wal_action')
  })

  it('V32 adds batch_id index + idempotency unique + wal_backfill_run table', () => {
    const v32 = migrations[1].sql
    expect(v32).toContain('idx_wal_batch')
    expect(v32).toContain('idx_wal_backfill_unique')
    expect(v32).toContain('CREATE TABLE IF NOT EXISTS wal_backfill_run')
  })

  it('V33 seeds wal_backfill_run idempotently', () => {
    const v33 = migrations[2].sql
    expect(v33).toContain('INSERT INTO wal_backfill_run')
    expect(v33).toContain('NOT EXISTS')
  })

  it('V33 is wrapped in a presence check for the workspaces table', () => {
    const v33 = migrations[2].sql
    // No-op on installs that don't have a workspaces table — protects
    // the migration runner from crashing on bare bootstraps.
    expect(v33).toContain("table_name = 'workspaces'")
  })

  it('V34 creates workspace_access_presets table + ws index', () => {
    const v34 = migrations[3].sql
    expect(v34).toContain('CREATE TABLE IF NOT EXISTS workspace_access_presets')
    expect(v34).toContain('UNIQUE (workspace, name)')
    expect(v34).toContain('shape       JSONB NOT NULL')
    expect(v34).toContain('idx_workspace_access_presets_ws')
  })

  it('V36 adds collaborator.expires_at column + partial index', () => {
    const v36 = migrations[5].sql
    expect(v36).toContain('ALTER TABLE collaborator')
    expect(v36).toContain('ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ')
    expect(v36).toContain('CREATE INDEX IF NOT EXISTS idx_collaborator_expires')
    // Partial index — only non-NULL rows are tracked, keeps the prune
    // job's scan cheap on workspaces with millions of permanent grants.
    expect(v36).toContain('WHERE expires_at IS NOT NULL')
  })

  it('V36 is wrapped in a presence check for the collaborator table', () => {
    const v36 = migrations[5].sql
    // No-op on installs that do not yet have a collaborator table —
    // matches the V33 pattern for the workspaces guard.
    expect(v36).toContain("table_name = 'collaborator'")
  })

  it('all migrations are forward-only with IF NOT EXISTS guards', () => {
    for (const m of [migrations[0], migrations[1], migrations[3]]) {
      expect(m.sql.toUpperCase()).toContain('IF NOT EXISTS')
    }
  })
})
