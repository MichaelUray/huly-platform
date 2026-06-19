//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Transactional wrapper for WAC writes that may be issued from an
// impersonation session. Always writes the action to
// `workspace_audit_log`; additionally writes to `admin_audit_log` when
// `ctx.isImpersonating === true`. Both writes happen in the same DB
// transaction as the underlying domain operation — the wrapper does
// not commit if any of them throws.
//

import type { WorkspaceAuditEntry, AdminAuditEntry } from './AuditLogger'

export interface ImpersonationCtx {
  tx: {
    begin: <T>(fn: (txCtx: TxCtx) => Promise<T>) => Promise<T>
  }
  workspace: string
  actorUuid: string
  actorRole: string
  isImpersonating: boolean
  impersonationRefId?: string
  instanceAdminUuid?: string
}

export interface TxCtx {
  ws: (entry: WorkspaceAuditEntry) => Promise<void>
  admin: (entry: AdminAuditEntry) => Promise<void>
}

export interface WACPayload {
  target_account?: string
  target_space?: string
  target_space_class?: string
  old?: unknown
  new?: unknown
}

export async function withImpersonationAudit<T> (
  ctx: ImpersonationCtx,
  action: string,
  payload: WACPayload,
  exec: () => Promise<T>
): Promise<T> {
  return await ctx.tx.begin(async (txCtx) => {
    const result = await exec()

    await txCtx.ws({
      workspace: ctx.workspace,
      action,
      actor: ctx.actorUuid,
      actor_role: ctx.actorRole,
      target_account: payload.target_account,
      target_space: payload.target_space,
      target_space_class: payload.target_space_class,
      old_value: payload.old,
      new_value: payload.new,
      metadata: ctx.isImpersonating ? { impersonation_ref: ctx.impersonationRefId } : {}
    })

    if (ctx.isImpersonating && ctx.instanceAdminUuid != null) {
      await txCtx.admin({
        action: `wac_${action}`,
        actor: ctx.instanceAdminUuid,
        target_workspace: ctx.workspace,
        target_account: payload.target_account,
        metadata: {
          impersonation_ref: ctx.impersonationRefId,
          original_action: action,
          original_target_space: payload.target_space
        }
      })
    }

    return result
  })
}
