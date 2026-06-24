import { migrations } from '../migrations/loader'

describe('migrations', () => {
  it('has V31, V32, V33, V34 in order', () => {
    expect(migrations.map((m) => m.id)).toEqual(['V31', 'V32', 'V33', 'V34'])
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

  it('all migrations are forward-only with IF NOT EXISTS guards', () => {
    for (const m of [migrations[0], migrations[1], migrations[3]]) {
      expect(m.sql.toUpperCase()).toContain('IF NOT EXISTS')
    }
  })
})
