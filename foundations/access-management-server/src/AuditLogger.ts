//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Generic SQL writer for the two audit tables:
//   - admin_audit_log   (cross-workspace; used by Instance Admin #10883)
//   - workspace_audit_log (workspace-scoped; introduced in Phase 2b V31)
//
// Wrapped by `withImpersonationAudit` for the dual-write case.
//

export interface SqlExecutor {
  exec: (sql: string, params: unknown[]) => Promise<void>
}

export interface WorkspaceAuditEntry {
  workspace: string
  action: string
  actor?: string
  actor_role: string
  target_account?: string
  target_space?: string
  target_space_class?: string
  old_value?: unknown
  new_value?: unknown
  metadata?: Record<string, unknown>
}

export interface AdminAuditEntry {
  action: string
  actor: string
  target_workspace?: string
  target_account?: string
  metadata?: Record<string, unknown>
}

export class AuditLogger {
  constructor (private readonly db: SqlExecutor) {}

  async writeWorkspace (e: WorkspaceAuditEntry): Promise<void> {
    await this.db.exec(
      `INSERT INTO workspace_audit_log
       (workspace, action, actor, actor_role, target_account, target_space, target_space_class, old_value, new_value, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        e.workspace,
        e.action,
        e.actor ?? null,
        e.actor_role,
        e.target_account ?? null,
        e.target_space ?? null,
        e.target_space_class ?? null,
        e.old_value ?? null,
        e.new_value ?? null,
        e.metadata ?? {}
      ]
    )
  }

  async writeAdmin (e: AdminAuditEntry): Promise<void> {
    await this.db.exec(
      `INSERT INTO admin_audit_log (action, admin_account, target_workspace, target_account, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        e.action,
        e.actor,
        e.target_workspace ?? null,
        e.target_account ?? null,
        e.metadata ?? {}
      ]
    )
  }
}
