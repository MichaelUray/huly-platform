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
  /**
   * Time-bounded grants (DSGVO Art. 5 Abs. 1 lit. e). NULL → grant is
   * permanent; ISO-8601 string → grant auto-expires at that instant.
   * Backed by `collaborator.expires_at` (migration V36). The prune job
   * in account-service removes expired rows and emits a `grant_expired`
   * audit event.
   */
  expiresAt: string | null
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
  /**
   * Resolve the previous `expires_at` value for audit diffing. Returns
   * `undefined` when the grant does not exist; the caller treats that
   * as `grant_not_found`. ISO-8601 string or `null` otherwise.
   */
  resolveExpiresAt?: (workspace: string, recipientUuid: string, resourceId: string) => Promise<string | null | undefined>
  /**
   * Persist the new `expires_at` value inside the wrapper's
   * transaction. Pass `null` to clear the expiry (= permanent grant).
   */
  setExpiresAt?: (
    domain: unknown,
    workspace: string,
    recipientUuid: string,
    resourceId: string,
    expiresAt: string | null
  ) => Promise<void>
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

// ── Time-bounded grants ─────────────────────────────────────────────────
//
// `setGrantExpiry` adjusts (or clears) the `collaborator.expires_at`
// column added by migration V36. Gated to OWNER + IMPERSONATING_ADMIN
// (== WRITE_ALLOWED_ROLES) — the Space-Owner side-channel does NOT
// extend here, in line with the rest of the flag-style edits.
//
// DSGVO note: this is the user-visible half of the Datensparsamkeit
// workstream. Guest grants can carry a hard end-of-life that the prune
// job enforces; this endpoint is what owners use to set it.
//

interface GrantExpiryEdit {
  workspace: string
  recipientUuid: string
  resourceId: string
  /** ISO-8601 timestamp in the future, or `null` to clear (= permanent). */
  expiresAt: string | null
}

// Permissive ISO-8601 with offset: `YYYY-MM-DDTHH:MM[:SS[.fff]]Z|±HH:MM`.
// We do NOT try to validate every edge case here — the regex is a
// shape gate; semantic validation (parse + future-check) happens
// below via `Date.parse`. Matches the philosophy of parseAuditFilter
// in #10883's audit query layer.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

export async function setGrantExpiry (
  ctx: GrantCtx,
  p: GrantExpiryEdit,
  backend: GrantBackend,
  now: () => number = Date.now
): Promise<void> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== p.workspace) throw new Forbidden('workspace mismatch')
  const role = await getEffectiveRole(ctx, p.workspace)
  if (!WRITE_ALLOWED_ROLES.includes(role)) {
    throw new Forbidden(`grant_expiry_not_allowed:${role}`)
  }
  if (backend.setExpiresAt == null || backend.resolveExpiresAt == null) {
    throw new Forbidden('grant_expiry_not_implemented')
  }

  // Validation. `null` is always allowed (clears expiry). String form
  // must match ISO_RE *and* parse to a future instant — we refuse
  // past/now timestamps so the prune job is never asked to handle a
  // race-condition "already-due" row at write time.
  if (p.expiresAt !== null) {
    if (typeof p.expiresAt !== 'string' || !ISO_RE.test(p.expiresAt)) {
      throw new Forbidden('grant_expiry_invalid_format')
    }
    const parsed = Date.parse(p.expiresAt)
    if (Number.isNaN(parsed)) {
      throw new Forbidden('grant_expiry_invalid_format')
    }
    if (parsed <= now()) {
      throw new Forbidden('grant_expiry_in_past')
    }
  }

  // Resolve current expiry BEFORE the audit so we can record the
  // old → new diff. `undefined` means "grant does not exist" — we
  // treat that as 404-equivalent the same way `revokeGrant` does.
  const oldExpiry = await backend.resolveExpiresAt(p.workspace, p.recipientUuid, p.resourceId)
  if (oldExpiry === undefined) throw new Forbidden('grant_not_found')

  // No-op short-circuit: setting the same value (incl. null → null)
  // would emit a misleading audit row. The HTTP layer can map this
  // to a 200 with `{changed: false}` if it cares to distinguish.
  if (oldExpiry === p.expiresAt) return

  const resourceClass = await backend.resolveResourceClass(p.workspace, p.recipientUuid, p.resourceId)
  // `resolveResourceClass` returning null after `resolveExpiresAt`
  // succeeded indicates a TOCTOU race (grant was revoked between the
  // two lookups). Same 404-equivalent treatment.
  if (resourceClass == null) throw new Forbidden('grant_not_found')

  await withImpersonationAudit(
    ctx,
    'grant_expiry_set',
    {
      target_account: p.recipientUuid,
      target_space: p.resourceId,
      target_space_class: resourceClass,
      old: { expiresAt: oldExpiry },
      new: { expiresAt: p.expiresAt }
    },
    async (txCtx) => {
      await backend.setExpiresAt!(txCtx.domain, p.workspace, p.recipientUuid, p.resourceId, p.expiresAt)
    }
  )
}
