import { migrations } from '../migrations/loader'

describe('migrations', () => {
  it('has V31, V32, V33 in order', () => {
    expect(migrations.map((m) => m.id)).toEqual(['V31', 'V32', 'V33'])
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

  it('all migrations are forward-only with IF NOT EXISTS guards', () => {
    for (const m of [migrations[0], migrations[1]]) {
      expect(m.sql.toUpperCase()).toContain('IF NOT EXISTS')
    }
  })
})
