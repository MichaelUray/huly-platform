//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

//
// Wave 7 Task B4 — pure-logic helpers for the role-refresh + demoted-
// banner pipeline driven by `AccessCenterPage.svelte`.
//
// Kept Svelte-free so the jest harness in this package (no Svelte
// transformer wired) can test the throttle + role-hierarchy + banner
// detection without mounting a component.
//

import type { WorkspaceRole } from '../types'

/**
 * Workspace-role ordinals used by demoted-banner detection. Higher
 * number = more privilege. All three Guest variants collapse to the
 * same tier (1) because v1 treats them identically (no read/edit).
 *
 * Unknown roles map to 0 so a malformed snapshot can't accidentally
 * be treated as "no demotion".
 */
export function roleHierarchy (role: WorkspaceRole | undefined): number {
  switch (role) {
    case 'OWNER':
      return 4
    case 'MAINTAINER':
      return 3
    case 'USER':
      return 2
    case 'GUEST':
    case 'READONLY_GUEST':
    case 'DOC_GUEST':
      return 1
    default:
      return 0
  }
}

/**
 * Strict demote check: returns `true` IFF `next` is a LOWER tier than
 * `prev` (Maintainer→User is a demote; Owner→Owner is NOT; Guest→User
 * is a promote, not a demote).
 *
 * Used by the banner: a demote means the user's current page may be
 * rendering edit affordances they no longer have, and the safe
 * recovery is a hard reload.
 */
export function isDemote (prev: WorkspaceRole | undefined, next: WorkspaceRole | undefined): boolean {
  if (prev === undefined || next === undefined) return false
  return roleHierarchy(next) < roleHierarchy(prev)
}

/**
 * Token returned by `makeThrottle` so callers can ask "may I run now?"
 * without coupling to a clock. `mark()` records the current run; the
 * next `canRun()` will return false until `intervalMs` has elapsed.
 */
export interface ThrottleGate {
  canRun: () => boolean
  mark: () => void
  /** Reset for tests / for an explicit user-driven refresh. */
  reset: () => void
}

/**
 * Build a simple "no more than once per intervalMs" gate. The `now`
 * function is a test seam — production passes `Date.now`.
 *
 * Semantics (intentional): the FIRST call always runs (canRun=true
 * before mark). After mark, subsequent calls inside the window return
 * false. The gate does NOT queue dropped requests; the caller is
 * expected to be idempotent (we always refetch the full /my-access
 * snapshot, so dropping a redundant request is safe).
 */
export function makeThrottle (intervalMs: number, now: () => number = Date.now): ThrottleGate {
  let last = -Infinity
  return {
    canRun (): boolean {
      return now() - last >= intervalMs
    },
    mark (): void {
      last = now()
    },
    reset (): void {
      last = -Infinity
    }
  }
}

/**
 * Default throttle interval for the AccessCenterPage refetch driver.
 * 2 seconds is enough to coalesce the bursty TxUpdateDoc broadcasts
 * that follow a bulk-role-change (account-service writes one
 * `wacInvalidationTick` per affected account) without making the UI
 * feel laggy on a real human-driven role change.
 */
export const ACCESS_REFETCH_INTERVAL_MS = 2000
