//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { buildQuery, type ListOpts } from './buildQuery'
import { getDefaultWacClient } from './wacClient'
import type { PageResult, SpaceRow } from '../types'

export const resourcesApi = {
  async listSpaces (workspace: string, opts?: ListOpts): Promise<PageResult<SpaceRow>> {
    return await getDefaultWacClient().get(`/${workspace}/spaces${buildQuery(opts)}`)
  },

  async getSpace (workspace: string, spaceId: string): Promise<SpaceRow> {
    return await getDefaultWacClient().get(`/${workspace}/spaces/${spaceId}`)
  },

  async setSpaceMembers (workspace: string, spaceId: string, members: string[]): Promise<void> {
    await getDefaultWacClient().put(`/${workspace}/spaces/${spaceId}/members`, { members })
  },

  async setSpaceOwners (workspace: string, spaceId: string, owners: string[]): Promise<void> {
    await getDefaultWacClient().put(`/${workspace}/spaces/${spaceId}/owners`, { owners })
  },

  async setSpacePrivacy (workspace: string, spaceId: string, isPrivate: boolean): Promise<void> {
    await getDefaultWacClient().put(`/${workspace}/spaces/${spaceId}/privacy`, { private: isPrivate })
  },

  async setSpaceAutoJoin (workspace: string, spaceId: string, autoJoin: boolean): Promise<void> {
    await getDefaultWacClient().put(`/${workspace}/spaces/${spaceId}/auto-join`, { autoJoin })
  },

  async setSpaceArchived (workspace: string, spaceId: string, archived: boolean): Promise<void> {
    await getDefaultWacClient().put(`/${workspace}/spaces/${spaceId}/archived`, { archived })
  }
}
