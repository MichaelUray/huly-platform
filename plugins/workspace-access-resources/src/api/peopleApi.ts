//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { buildQuery, type ListOpts } from './buildQuery'
import { getDefaultWacClient } from './wacClient'
import type { MemberRow, PageResult, PendingInvite, WorkspaceRole } from '../types'

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
  ): Promise<{ batch_id: string; affected: number }> {
    return await getDefaultWacClient().post(`/${workspace}/members/bulk/role`, { members, role: newRole })
  }
}
