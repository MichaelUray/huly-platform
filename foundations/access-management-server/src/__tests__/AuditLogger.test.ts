import { AuditLogger, type SqlExecutor } from '../AuditLogger'

function mockExecutor (): { db: SqlExecutor; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  return {
    db: {
      exec: async (sql, params) => {
        calls.push({ sql, params })
      }
    },
    calls
  }
}

describe('AuditLogger', () => {
  it('writes to workspace_audit_log with full payload', async () => {
    const { db, calls } = mockExecutor()
    const logger = new AuditLogger(db)
    await logger.writeWorkspace({
      workspace: 'ws1',
      action: 'member_added',
      actor: 'u1',
      actor_role: 'workspace_owner',
      target_account: 'u2',
      target_space: 'sp1',
      target_space_class: 'tracker.class.Project',
      old_value: ['u1'],
      new_value: ['u1', 'u2'],
      metadata: { batch_id: 'b1' }
    })
    expect(calls.length).toBe(1)
    expect(calls[0].sql).toContain('INSERT INTO workspace_audit_log')
    expect(calls[0].params[0]).toBe('ws1')
    expect(calls[0].params[1]).toBe('member_added')
  })

  it('handles missing optional fields with NULLs', async () => {
    const { db, calls } = mockExecutor()
    const logger = new AuditLogger(db)
    await logger.writeWorkspace({
      workspace: 'ws1',
      action: 'space_archived',
      actor_role: 'system'
    })
    expect(calls[0].params[2]).toBeNull() // actor
    expect(calls[0].params[4]).toBeNull() // target_account
  })

  it('writes to admin_audit_log with the existing schema columns', async () => {
    const { db, calls } = mockExecutor()
    const logger = new AuditLogger(db)
    await logger.writeAdmin({
      action: 'impersonation_started',
      actor: 'admin1',
      target_workspace: 'ws1',
      metadata: { impersonation_ref: 'r1' }
    })
    expect(calls[0].sql).toContain('INSERT INTO admin_audit_log')
    expect(calls[0].sql).toContain('admin_account')
    expect(calls[0].params).toContain('impersonation_started')
    expect(calls[0].params).toContain('admin1')
  })
})
