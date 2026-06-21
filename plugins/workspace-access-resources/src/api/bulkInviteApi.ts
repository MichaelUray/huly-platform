//
// Copyright © 2026 Hardcore Engineering Inc.
//
// CSV Bulk-Invite client. Hits POST /api/wac/<ws>/invites/bulk-csv
// (defined in account-service) with the CSV payload as JSON so the
// existing koa-bodyparser handles it; the server enforces the 1 MiB
// limit + DSGVO-cleansed audit logging regardless of how the body
// arrives.
//

import { getDefaultWacClient } from './wacClient'

export type BulkRowStatus = 'ok' | 'invalid_email' | 'invalid_role' | 'space_not_found' | 'invalid_csv'

export interface BulkInvitePreviewRow {
  line: number
  email: string
  role: string
  addToSpaces: string[]
  status: BulkRowStatus
  detail?: string
}

export interface BulkInvitePreviewSummary {
  total: number
  valid: number
  invalid: number
  byStatus: Record<string, number>
}

export interface BulkInviteResponse {
  dry_run: boolean
  dispatched?: number
  rows: BulkInvitePreviewRow[]
  summary: BulkInvitePreviewSummary
  audit_metadata: {
    count: number
    valid: number
    invalid: number
    byStatus: Record<string, number>
  }
}

export async function bulkInviteCsv (workspace: string, csv: string, dryRun: boolean): Promise<BulkInviteResponse> {
  const c = getDefaultWacClient()
  return await c.post<BulkInviteResponse>(`/${workspace}/invites/bulk-csv`, {
    csv,
    dry_run: dryRun
  })
}
