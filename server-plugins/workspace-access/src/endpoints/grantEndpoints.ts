//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Mention-Grants integration. Surfaces existing Collaborator records
// via WAC's filterable list + revoke flow. The revoke is gated to
// Workspace-Owner (or the grant's own creator via My-Access tab).
//

import {
  assertWorkspaceContext,
  getEffectiveRole,
  WRITE_ALLOWED_ROLES,
  READ_ALLOWED_ROLES,
  Forbidden,
  withImpersonationAudit,
  type RoleCtx,
  type ImpersonationCtx
} from '@hcengineering/access-management-server'

const MAX_PAGE_SIZE = 100

export interface GrantRow {
  recipientUuid: string
  recipientName: string
  granterUuid: string
  granterName: string
  resourceId: string
  resourceClass: string
  resourceTitle: string
  grantedAt: string
}

export interface GrantBackend {
  list: (workspace: string, opts: { cursor?: string; filter?: Record<string, unknown>; limit: number }) => Promise<{ items: GrantRow[]; cursor: string | null }>
  count: (workspace: string) => Promise<number>
  /**
   * Pre-fetch the resource's class for audit annotation. Returns
   * `null` if the grant doesn't exist (caller treats this as a
   * grant_already_revoked condition).
   */
  resolveResourceClass: (workspace: string, recipientUuid: string, resourceId: string) => Promise<string | null>
  /** Apply the revocation inside the wrapper's transaction. */
  revoke: (domain: unknown, workspace: string, recipientUuid: string, resourceId: string) => Promise<{ resourceClass: string }>
}

export interface GrantCtx extends RoleCtx, ImpersonationCtx {
  token: { audience?: string; workspace?: string }
}

interface GrantListParams {
  workspace: string
  cursor?: string
  filter?: Record<string, unknown>
  limit?: number
}

interface GrantRevokeParams {
  workspace: string
  recipientUuid: string
  resourceId: string
}

async function gateRead (ctx: GrantCtx, workspace: string): Promise<void> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== workspace) throw new Forbidden('workspace mismatch')
  const role = await getEffectiveRole(ctx, workspace)
  if (!READ_ALLOWED_ROLES.includes(role)) throw new Forbidden(`read_not_allowed:${role}`)
}

export async function listGrants (ctx: GrantCtx, p: GrantListParams, backend: GrantBackend): Promise<{ items: GrantRow[]; cursor: string | null }> {
  await gateRead(ctx, p.workspace)
  const limit = Math.min(p.limit ?? 50, MAX_PAGE_SIZE)
  return await backend.list(p.workspace, { cursor: p.cursor, filter: p.filter, limit })
}

export async function countGrants (ctx: GrantCtx, workspace: string, backend: GrantBackend): Promise<number> {
  await gateRead(ctx, workspace)
  return await backend.count(workspace)
}

export async function revokeGrant (
  ctx: GrantCtx & { isGrantCreator?: (workspace: string, recipientUuid: string, resourceId: string) => Promise<boolean> },
  p: GrantRevokeParams,
  backend: GrantBackend
): Promise<void> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== p.workspace) throw new Forbidden('workspace mismatch')
  const role = await getEffectiveRole(ctx, p.workspace)
  const isOwner = WRITE_ALLOWED_ROLES.includes(role)
  const isCreator = ctx.isGrantCreator != null && (await ctx.isGrantCreator(p.workspace, p.recipientUuid, p.resourceId))
  if (!isOwner && !isCreator) {
    throw new Forbidden(`grant_revoke_not_allowed:${role}`)
  }
  // Resolve resource class BEFORE the audit so we can record it as
  // `target_space_class`. The previous version discarded the class
  // returned by backend.revoke after the audit row had already been
  // written, leaving forensics without the resource type.
  const resourceClass = await backend.resolveResourceClass(p.workspace, p.recipientUuid, p.resourceId)
  if (resourceClass == null) throw new Forbidden('grant_not_found')

  await withImpersonationAudit(
    ctx,
    'grant_revoked',
    {
      target_account: p.recipientUuid,
      target_space: p.resourceId,
      target_space_class: resourceClass
    },
    async (txCtx) => {
      await backend.revoke(txCtx.domain, p.workspace, p.recipientUuid, p.resourceId)
    }
  )
}
