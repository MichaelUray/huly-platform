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
    if (imp.state === 'active') return 'IMPERSONATING_ADMIN'
    if (imp.state === 'drill-down') return 'IMPERSONATING_ADMIN' // read-only via banner gating
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

export function canEdit (r: EffectiveRole): boolean {
  return r === 'OWNER' || r === 'IMPERSONATING_ADMIN'
}

export function canReadWorkspaceWide (r: EffectiveRole): boolean {
  return (
    r === 'OWNER' ||
    r === 'MAINTAINER' ||
    r === 'MAINTAINER_PLUS_SPACE_OWNER' ||
    r === 'IMPERSONATING_ADMIN'
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
