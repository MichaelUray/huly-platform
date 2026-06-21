//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { buildQuery, type ListOpts } from './buildQuery'
import { getDefaultWacClient } from './wacClient'
import type { MemberRow, PageResult, PendingInvite, WorkspaceRole } from '../types'

// Wave 5 Task C1 — bulk-role API surface alignment.
//
// Server (`server-plugins/workspace-access/src/http/writeRouter.ts`,
// handleBulkMemberRole) returns a per-target outcome contract:
//   { batch_id, appliedCount, results: Array<{ memberUuid, status, detail? }> }
// where status ∈ 'ok' | 'last_owner_refused' | 'forbidden' | 'not_found'
// | 'internal'. Before this commit the client typed the response as
// `{ batch_id, affected }`, so partial failures (one demote refused as
// last-owner, one target not in the workspace, etc.) were invisible to
// the UI — the call resolved successfully and the operator never saw
// which targets actually flipped.
export type BulkRoleStatus =
  | 'ok'
  | 'last_owner_refused'
  | 'forbidden'
  | 'not_found'
  | 'internal'

export interface BulkRoleEntry {
  memberUuid: string
  status: BulkRoleStatus
  detail?: string
}

export interface BulkRoleResult {
  batch_id: string
  appliedCount: number
  results: BulkRoleEntry[]
}

// Pure summarizer extracted so the UI consumer + the unit test share
// one canonical reduce. Keeping it pure keeps the .svelte file free of
// counting logic that would otherwise be untestable under the current
// jest-jsdom setup (no @testing-library/svelte in this package).
export interface BulkRoleSummary {
  total: number
  applied: number
  failed: number
  byStatus: Record<BulkRoleStatus, number>
  failures: BulkRoleEntry[]
}

const ALL_STATUSES: BulkRoleStatus[] = [
  'ok',
  'last_owner_refused',
  'forbidden',
  'not_found',
  'internal'
]

export function summarizeBulkRoleResult (result: BulkRoleResult): BulkRoleSummary {
  const byStatus: Record<BulkRoleStatus, number> = {
    ok: 0,
    last_owner_refused: 0,
    forbidden: 0,
    not_found: 0,
    internal: 0
  }
  const failures: BulkRoleEntry[] = []
  for (const r of result.results) {
    // Defend against forward-compat surprises: if the server ever adds
    // a new status, treat it as a failure rather than silently dropping.
    if (ALL_STATUSES.includes(r.status)) {
      byStatus[r.status]++
    } else {
      byStatus.internal++
    }
    if (r.status !== 'ok') failures.push(r)
  }
  return {
    total: result.results.length,
    applied: byStatus.ok,
    failed: result.results.length - byStatus.ok,
    byStatus,
    failures
  }
}

export const peopleApi = {
  async listMembers (workspace: string, opts?: ListOpts): Promise<PageResult<MemberRow>> {
    return await getDefaultWacClient().get(`/${workspace}/members${buildQuery(opts)}`)
  },

  async listPendingInvites (workspace: string, opts?: ListOpts): Promise<PageResult<PendingInvite>> {
    return await getDefaultWacClient().get(`/${workspace}/invites${buildQuery(opts)}`)
  },

  async getLastAdminInfo (workspace: string): Promise<{ remaining: number }> {
    return await getDefaultWacClient().get(`/${workspace}/admins/count`)
  },

  async setMemberRole (
    workspace: string,
    targetUuid: string,
    newRole: WorkspaceRole,
    reason?: string
  ): Promise<void> {
    await getDefaultWacClient().post(`/${workspace}/members/${targetUuid}/role`, {
      role: newRole,
      reason
    })
  },

  async bulkAddToSpace (
    workspace: string,
    members: string[],
    space: string
  ): Promise<{ batch_id: string; affected: number }> {
    return await getDefaultWacClient().post(`/${workspace}/members/bulk/add-to-space`, { members, space })
  },

  async bulkRemoveFromSpace (
    workspace: string,
    members: string[],
    space: string
  ): Promise<{ batch_id: string; affected: number }> {
    return await getDefaultWacClient().post(`/${workspace}/members/bulk/remove-from-space`, { members, space })
  },

  async bulkChangeRole (
    workspace: string,
    members: string[],
    newRole: WorkspaceRole
  ): Promise<BulkRoleResult> {
    return await getDefaultWacClient().post(`/${workspace}/members/bulk/role`, { members, role: newRole })
  }
}
