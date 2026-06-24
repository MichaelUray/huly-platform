//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Client wrapper for the Effective Permissions Drilldown read endpoint.
// Mirrors the response shape of `effectivePermissions()` in
// @hcengineering/server-workspace-access (Tier-1, single-space scope).
//

import { getDefaultWacClient } from './wacClient'

export type EffectivePermissionsDecision = 'allow' | 'deny'

export type EffectivePermissionsRole = 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'

export interface EffectivePermissionsUser {
  uuid: string
  name: string
  role: EffectivePermissionsRole
}

export interface EffectivePermissionsResource {
  id: string
  class: string
  name: string
  private: boolean
  archived: boolean
}

export interface EffectivePermissionsPathStep {
  step: string
  detail: string
}

export interface EffectivePermissionsResponse {
  user: EffectivePermissionsUser
  resource: EffectivePermissionsResource
  decision: EffectivePermissionsDecision
  path: EffectivePermissionsPathStep[]
}

export const effectivePermissionsApi = {
  /**
   * Fetch the explained decision for a single (user, resource) pair.
   * Throws a WacError on non-2xx (e.g. 403 effective_permissions_forbidden,
   * 400 effective_permissions_bad_request).
   */
  async query (
    workspace: string,
    userUuid: string,
    resourceId: string
  ): Promise<EffectivePermissionsResponse> {
    const qs = `?user=${encodeURIComponent(userUuid)}&resource=${encodeURIComponent(resourceId)}`
    return await getDefaultWacClient().get(`/${workspace}/effective-permissions${qs}`)
  }
}
