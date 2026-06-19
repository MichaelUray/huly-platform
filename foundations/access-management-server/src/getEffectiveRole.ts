//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Multi-role resolver for the Workspace Access Center.
// "Most-permissive-wins" for write privileges; for read the union always
// covers everything any constituent role would have read.
//

export type EffectiveRole =
  | 'OWNER'
  | 'MAINTAINER'
  | 'MAINTAINER_PLUS_SPACE_OWNER'
  | 'SPACE_OWNER_SCOPED'
  | 'USER_SELF_SCOPED'
  | 'GUEST'
  /** Active impersonation session — read+write, dual-audited. */
  | 'IMPERSONATING_ADMIN'
  /** Instance-Admin drill-down WITHOUT impersonation — read-only. */
  | 'INSTANCE_ADMIN_READONLY'

export interface RoleCtx {
  account: { uuid: string }
  membership: {
    role: 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
    /** Space-Ref values where this account appears in `space.owners`. */
    ownedSpaces: string[]
  }
  isImpersonating: boolean
  /**
   * True when the caller is an Instance-Admin viewing the workspace
   * via the #10883 drill-down WITHOUT having started impersonation.
   * Mutually exclusive with `isImpersonating`.
   */
  isInstanceAdminReadOnly?: boolean
}

export async function getEffectiveRole (ctx: RoleCtx, _workspace: string): Promise<EffectiveRole> {
  if (ctx.isImpersonating) return 'IMPERSONATING_ADMIN'
  if (ctx.isInstanceAdminReadOnly === true) return 'INSTANCE_ADMIN_READONLY'
  const { role, ownedSpaces } = ctx.membership
  if (role === 'OWNER') return 'OWNER'
  if (role === 'MAINTAINER') {
    return ownedSpaces.length > 0 ? 'MAINTAINER_PLUS_SPACE_OWNER' : 'MAINTAINER'
  }
  if (role === 'USER') {
    return ownedSpaces.length > 0 ? 'SPACE_OWNER_SCOPED' : 'USER_SELF_SCOPED'
  }
  return 'GUEST'
}

/** Roles that are allowed to read across the entire workspace surface. */
export const READ_ALLOWED_ROLES: ReadonlyArray<EffectiveRole> = [
  'OWNER',
  'MAINTAINER',
  'MAINTAINER_PLUS_SPACE_OWNER',
  'IMPERSONATING_ADMIN',
  'INSTANCE_ADMIN_READONLY'
]

/**
 * Roles that may issue write operations against `*Workspace*` endpoints.
 * Maintainer never appears here; impersonating admin does, and every
 * write call is dual-audited via `withImpersonationAudit`.
 */
export const WRITE_ALLOWED_ROLES: ReadonlyArray<EffectiveRole> = [
  'OWNER',
  'IMPERSONATING_ADMIN'
]
