//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wave 5 D — Resources bulk-bar client API.
//
// Mirrors the BulkRoleResult contract from peopleApi: each POST returns
// 200 with `{ batch_id, applied, results: [{ spaceId, status, detail? }] }`
// so the UI can surface per-row outcomes (some spaces ok, some
// not_found, etc.) instead of a flat success/fail.
//
// Server: server-plugins/workspace-access/src/http/writeRouter.ts —
// handleBulkSpaceArchive / handleBulkSpacePrivacy / handleBulkSpaceAddOwner.
//

import { getDefaultWacClient } from './wacClient'

export type ResourceBulkStatus = 'ok' | 'forbidden' | 'not_found' | 'internal'

export interface ResourceBulkEntry {
  spaceId: string
  status: ResourceBulkStatus
  detail?: string
}

export interface ResourceBulkResult {
  batch_id: string
  applied: number
  results: ResourceBulkEntry[]
}

export interface ResourceBulkSummary {
  total: number
  applied: number
  failed: number
  byStatus: Record<ResourceBulkStatus, number>
  failures: ResourceBulkEntry[]
}

const ALL_STATUSES: ResourceBulkStatus[] = ['ok', 'forbidden', 'not_found', 'internal']

/**
 * Pure summarizer — same shape as `summarizeBulkRoleResult` in peopleApi.
 * Kept testable as a plain function so the .svelte consumer stays free
 * of counting logic.
 */
export function summarizeResourceBulkResult (result: ResourceBulkResult): ResourceBulkSummary {
  const byStatus: Record<ResourceBulkStatus, number> = {
    ok: 0,
    forbidden: 0,
    not_found: 0,
    internal: 0
  }
  const failures: ResourceBulkEntry[] = []
  for (const r of result.results) {
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

export const resourcesBulkApi = {
  async bulkArchive (workspace: string, spaceIds: string[]): Promise<ResourceBulkResult> {
    return await getDefaultWacClient().post(`/${workspace}/spaces/bulk-archive`, { spaceIds })
  },

  async bulkSetPrivate (
    workspace: string,
    spaceIds: string[],
    isPrivate: boolean
  ): Promise<ResourceBulkResult> {
    return await getDefaultWacClient().post(
      `/${workspace}/spaces/bulk-set-private`,
      { spaceIds, private: isPrivate }
    )
  },

  async bulkAddOwner (
    workspace: string,
    spaceIds: string[],
    ownerUuid: string
  ): Promise<ResourceBulkResult> {
    return await getDefaultWacClient().post(
      `/${workspace}/spaces/bulk-add-owner`,
      { spaceIds, ownerUuid }
    )
  }
}
