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
// Atomicity contract: the `exec` callback receives the same `txCtx`
// that the audit writers use. Callers MUST route their domain write
// through that handle (e.g. `txCtx.domain.update(...)`) — passing a
// connection from outside the wrapper would leak the domain write
// outside the transaction even though the audit rows roll back. The
// `domain` field is a generic carrier; runtime wiring picks an
// implementation-specific shape (a SQL transaction, a Huly TxRunner,
// etc.) when constructing the ctx.
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

export interface TxCtx<DomainHandle = unknown> {
  /** Workspace audit writer, scoped to the same transaction as `domain`. */
  ws: (entry: WorkspaceAuditEntry) => Promise<void>
  /** Admin audit writer, same transaction scope. */
  admin: (entry: AdminAuditEntry) => Promise<void>
  /**
   * Domain operation handle. Concrete shape depends on the wiring
   * layer — for the Postgres-backed account-server this is the active
   * pg.PoolClient inside a `BEGIN`; for the Huly transactor it's the
   * TxRunner that scopes the same logical commit. Callers MUST use
   * this handle to perform their domain write so it lands inside the
   * same transaction as the audit entries.
   */
  domain: DomainHandle
}

export interface WACPayload {
  target_account?: string
  target_space?: string
  target_space_class?: string
  old?: unknown
  new?: unknown
}

export async function withImpersonationAudit<T, DomainHandle = unknown> (
  ctx: ImpersonationCtx,
  action: string,
  payload: WACPayload,
  exec: (txCtx: TxCtx<DomainHandle>) => Promise<T>
): Promise<T> {
  return await ctx.tx.begin(async (txCtx) => {
    // Domain write FIRST (so the audit reflects the post-state). All
    // throws bubble and abort the surrounding transaction so neither
    // the domain change nor the audit entries commit.
    const result = await exec(txCtx as TxCtx<DomainHandle>)

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
