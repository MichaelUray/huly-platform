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
  /**
   * Set to `true` once the role has been resolved from the backend
   * (`/api/wac/<workspace>/my-access`). Downstream UI can refuse to
   * render — or render in a safe read-only fallback — while this is
   * `false`, so the page never paints with a privilege we haven't
   * actually proven yet.
   *
   * Pre-Phase-1-Task-3 the page used to seed `OWNER` straight from the
   * route mount; that gave every visitor full edit affordances for the
   * brief window before the real role landed. The `hydrated` flag
   * eliminates that gap.
   */
  hydrated: boolean
}

export const roleStore = writable<RoleModel>({
  workspaceRole: 'GUEST',
  ownedSpaceIds: [],
  hydrated: false
})

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
  // GUEST cannot enter the Access Center at all (backend gates with 403);
  // returning [] here makes the surface render the "no access" hint.
  if (r === 'GUEST') return []
  // OWNER/MAINTAINER + their variants + IMPERSONATING/INSTANCE_ADMIN
  // see the full workspace-wide surface; everyone else only sees their
  // own My-Access tab.
  if (canReadWorkspaceWide(r)) {
    return ['people', 'resources', 'my-access', 'audit']
  }
  return ['my-access']
}
