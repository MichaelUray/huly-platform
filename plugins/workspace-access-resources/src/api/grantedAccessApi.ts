//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { buildQuery, type ListOpts } from './buildQuery'
import { getDefaultWacClient } from './wacClient'
import type { GrantRow, PageResult } from '../types'

export const grantedAccessApi = {
  async listGrants (workspace: string, opts?: ListOpts): Promise<PageResult<GrantRow>> {
    return await getDefaultWacClient().get(`/${workspace}/grants${buildQuery(opts)}`)
  },

  async countGrants (workspace: string): Promise<number> {
    const result = await getDefaultWacClient().get<{ count: number }>(`/${workspace}/grants/count`)
    return result.count
  },

  async revoke (workspace: string, recipientUuid: string, resourceId: string): Promise<void> {
    await getDefaultWacClient().delete(`/${workspace}/grants/${recipientUuid}/${resourceId}`)
  }
}
