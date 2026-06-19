//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { getDefaultWacClient } from './wacClient'
import type { SpaceRow, GrantRow, WorkspaceRole } from '../types'

export interface MyAccessSummary {
  role: WorkspaceRole
  spacesMemberOf: SpaceRow[]
  spacesOwned: SpaceRow[]
  grantsReceived: GrantRow[]
  grantsGiven: GrantRow[]
}

export const myAccessApi = {
  async getSummary (workspace: string): Promise<MyAccessSummary> {
    return await getDefaultWacClient().get(`/${workspace}/my-access`)
  },

  async leaveSpace (workspace: string, spaceId: string): Promise<void> {
    await getDefaultWacClient().post(`/${workspace}/my-access/leave/${spaceId}`, {})
  },

  async declineGrant (workspace: string, resourceId: string): Promise<void> {
    await getDefaultWacClient().post(`/${workspace}/my-access/decline-grant/${resourceId}`, {})
  }
}
