//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { writable, derived } from 'svelte/store'
import { impersonationStore } from './impersonationStore'
import type { EffectiveRole, WorkspaceRole } from '../types'

export interface RoleModel {
  workspaceRole: WorkspaceRole
  /** Space IDs where the caller is in `space.owners`. */
  ownedSpaceIds: string[]
}

export const roleStore = writable<RoleModel>({ workspaceRole: 'USER', ownedSpaceIds: [] })

export const effectiveRole = derived(
  [roleStore, impersonationStore],
  ([role, imp]): EffectiveRole => {
    // Active impersonation: full edit privileges, every action dual-audited.
    if (imp.state === 'active') return 'IMPERSONATING_ADMIN'
    // Drill-down: Instance-Admin viewing the workspace from #10883 without
    // having started impersonation. Read-only; surfaces the blue banner
    // with "Assume Owner role" affordance but no edit buttons render.
    if (imp.state === 'drill-down') return 'INSTANCE_ADMIN_READONLY'
    const { workspaceRole, ownedSpaceIds } = role
    if (workspaceRole === 'OWNER') return 'OWNER'
    if (workspaceRole === 'MAINTAINER') {
      return ownedSpaceIds.length > 0 ? 'MAINTAINER_PLUS_SPACE_OWNER' : 'MAINTAINER'
    }
    if (workspaceRole === 'USER') {
      return ownedSpaceIds.length > 0 ? 'SPACE_OWNER_SCOPED' : 'USER_SELF_SCOPED'
    }
    return 'GUEST'
  }
)

/**
 * Write privilege check. INSTANCE_ADMIN_READONLY is explicitly NOT
 * editable — the blue drill-down banner requires the user to start
 * an impersonation session (and accept the DSGVO modal) before any
 * edit becomes possible.
 */
export function canEdit (r: EffectiveRole): boolean {
  return r === 'OWNER' || r === 'IMPERSONATING_ADMIN'
}

export function canReadWorkspaceWide (r: EffectiveRole): boolean {
  return (
    r === 'OWNER' ||
    r === 'MAINTAINER' ||
    r === 'MAINTAINER_PLUS_SPACE_OWNER' ||
    r === 'IMPERSONATING_ADMIN' ||
    r === 'INSTANCE_ADMIN_READONLY'
  )
}

export function tabsForRole (r: EffectiveRole): string[] {
  // My-Access is always available; People/Resources/Audit are workspace-wide reads.
  const tabs: string[] = []
  if (canReadWorkspaceWide(r)) {
    tabs.push('people', 'resources')
  }
  tabs.push('my-access')
  if (canReadWorkspaceWide(r)) {
    tabs.push('audit')
  }
  return tabs
}
