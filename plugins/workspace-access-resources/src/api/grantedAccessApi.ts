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
  },

  /**
   * Set or clear the auto-expiry of a grant (DSGVO Datensparsamkeit).
   *
   * @param expiresAt ISO-8601 timestamp in the future, or `null` to
   *                  clear (= permanent). Server-side validation
   *                  rejects past timestamps + malformed input with
   *                  HTTP 400.
   *
   * The `grantId` path segment is the recipient-uuid : resource-id
   * pair joined with `/`, matching the existing `revoke` URL shape.
   */
  async setExpiry (
    workspace: string,
    recipientUuid: string,
    resourceId: string,
    expiresAt: string | null
  ): Promise<{ grantId: string; expires_at: string | null; changed: boolean }> {
    return await getDefaultWacClient().post(
      `/${workspace}/grants/${recipientUuid}:${resourceId}/expiry`,
      { expires_at: expiresAt }
    )
  }
}
