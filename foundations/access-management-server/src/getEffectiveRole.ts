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
  | 'IMPERSONATING_ADMIN'

export interface RoleCtx {
  account: { uuid: string }
  membership: {
    role: 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
    /** Space-Ref values where this account appears in `space.owners`. */
    ownedSpaces: string[]
  }
  isImpersonating: boolean
}

export async function getEffectiveRole (ctx: RoleCtx, _workspace: string): Promise<EffectiveRole> {
  if (ctx.isImpersonating) return 'IMPERSONATING_ADMIN'
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
  'IMPERSONATING_ADMIN'
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
