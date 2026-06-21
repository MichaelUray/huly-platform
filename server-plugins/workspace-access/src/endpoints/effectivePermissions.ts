//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Effective Permissions Drilldown (Tier-1, read-only).
//
// Given a workspace + user-uuid + resource-id, returns the WAC decision
// for that user against that single resource AND the reasoning path
// that led to it. Used by the PersonDrawer "Effective Permissions"
// section as a forensics aid for Owners debugging access questions.
//
// Tier-1 scope:
//   - Single space-level resource per call (no bulk audit, no doc-level)
//   - No transitive parent-space inheritance
//   - Read-only; emits one `effective_permissions_viewed` workspace
//     audit entry per call so abuse is traceable
//
// Gating is INTENTIONALLY stricter than the generic read endpoints:
// only OWNER and IMPERSONATING_ADMIN can drill into another user's
// membership graph. MAINTAINER is excluded because the drill-down
// would leak peer-membership data that the role gate normally hides.
//

import {
  assertWorkspaceContext,
  getEffectiveRole,
  Forbidden,
  type RoleCtx
} from '@hcengineering/access-management-server'

export type EffectivePermissionsRole = 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'

export type EffectivePermissionsDecision = 'allow' | 'deny'

export interface EffectivePermissionsUser {
  uuid: string
  name: string
  role: EffectivePermissionsRole
}

export interface EffectivePermissionsResource {
  id: string
  class: string
  name: string
  private: boolean
  archived: boolean
}

export interface EffectivePermissionsResourceFull extends EffectivePermissionsResource {
  members: string[]
  owners: string[]
}

export interface EffectivePermissionsPathStep {
  step:
    | 'workspace-role'
    | 'space-public'
    | 'space-member'
    | 'space-owner'
    | 'archived'
    | 'no-match'
  detail: string
}

export interface EffectivePermissionsResult {
  user: EffectivePermissionsUser
  resource: EffectivePermissionsResource
  decision: EffectivePermissionsDecision
  path: EffectivePermissionsPathStep[]
}

export interface EffectivePermissionsAuditEntry {
  action: 'effective_permissions_viewed'
  actor: string
  actor_role: string
  workspace: string
  target_account: string
  target_space: string
  target_space_class?: string
  metadata: { decision: EffectivePermissionsDecision }
}

export interface EffectivePermissionsBackend {
  loadUser: (workspace: string, userUuid: string) => Promise<EffectivePermissionsUser | null>
  loadResource: (workspace: string, resourceId: string) => Promise<EffectivePermissionsResourceFull | null>
  writeAudit: (entry: EffectivePermissionsAuditEntry) => Promise<void>
}

export interface EffectivePermissionsCtx extends RoleCtx {
  token: { audience?: string; workspace?: string }
  workspace: string
  actorUuid: string
  actorRole: string
}

export interface EffectivePermissionsParams {
  workspace: string
  userUuid: string
  resourceId: string
}

/**
 * Roles permitted to issue an effective-permissions drill-down.
 * Deliberately narrower than `READ_ALLOWED_ROLES`.
 */
const DRILLDOWN_ALLOWED_ROLES = new Set([
  'OWNER',
  'IMPERSONATING_ADMIN'
])

export async function effectivePermissions (
  ctx: EffectivePermissionsCtx,
  params: EffectivePermissionsParams,
  backend: EffectivePermissionsBackend
): Promise<EffectivePermissionsResult> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== params.workspace) {
    throw new Forbidden('workspace mismatch')
  }

  const role = await getEffectiveRole(ctx, params.workspace)
  if (!DRILLDOWN_ALLOWED_ROLES.has(role)) {
    throw new Forbidden(`effective_permissions_forbidden:${role}`)
  }

  if (params.userUuid === '' || params.resourceId === '') {
    throw new Forbidden('effective_permissions_bad_request')
  }

  const user = await backend.loadUser(params.workspace, params.userUuid)
  if (user == null) {
    throw new Forbidden('effective_permissions_user_not_found')
  }

  const resource = await backend.loadResource(params.workspace, params.resourceId)
  if (resource == null) {
    throw new Forbidden('effective_permissions_resource_not_found')
  }

  const { decision, path } = decide(user, resource)

  const resourceMeta: EffectivePermissionsResource = {
    id: resource.id,
    class: resource.class,
    name: resource.name,
    private: resource.private,
    archived: resource.archived
  }

  await backend.writeAudit({
    action: 'effective_permissions_viewed',
    actor: ctx.actorUuid,
    actor_role: ctx.actorRole,
    workspace: params.workspace,
    target_account: params.userUuid,
    target_space: params.resourceId,
    target_space_class: resource.class,
    metadata: { decision }
  })

  return {
    user,
    resource: resourceMeta,
    decision,
    path
  }
}

function decide (
  user: EffectivePermissionsUser,
  resource: EffectivePermissionsResourceFull
): { decision: EffectivePermissionsDecision, path: EffectivePermissionsPathStep[] } {
  // Workspace-level admin roles bypass space gates (mirrors the
  // transactor's actual model — Owners and Maintainers see everything,
  // including archived spaces).
  if (user.role === 'OWNER' || user.role === 'MAINTAINER') {
    return {
      decision: 'allow',
      path: [
        {
          step: 'workspace-role',
          detail: `User has workspace role ${user.role} → allow all`
        }
      ]
    }
  }

  // For non-admins, an archived space is a hard deny regardless of
  // membership. Archived spaces are intentionally invisible to plain
  // users and guests in the standard transactor surface; surface that
  // here too so the drill-down doesn't claim access that the runtime
  // would actually refuse.
  if (resource.archived) {
    return {
      decision: 'deny',
      path: [
        {
          step: 'archived',
          detail: 'Space is archived; non-admin users cannot access archived spaces'
        }
      ]
    }
  }

  // Public, non-archived space → anyone in the workspace can read.
  if (!resource.private) {
    return {
      decision: 'allow',
      path: [
        {
          step: 'space-public',
          detail: 'Space is public (private=false, archived=false)'
        }
      ]
    }
  }

  // Private space → check membership / owners.
  if (resource.owners.includes(user.uuid)) {
    return {
      decision: 'allow',
      path: [
        {
          step: 'space-owner',
          detail: 'User is listed in space.owners'
        }
      ]
    }
  }

  if (resource.members.includes(user.uuid)) {
    return {
      decision: 'allow',
      path: [
        {
          step: 'space-member',
          detail: 'User is listed in space.members'
        }
      ]
    }
  }

  return {
    decision: 'deny',
    path: [
      {
        step: 'no-match',
        detail: 'Space is private and user is neither owner nor member'
      }
    ]
  }
}
