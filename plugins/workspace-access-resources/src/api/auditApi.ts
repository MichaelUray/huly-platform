//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { buildQuery, type ListOpts } from './buildQuery'
import { getDefaultWacClient } from './wacClient'
import type { AuditRow, PageResult } from '../types'

export const auditApi = {
  async list (workspace: string, opts?: ListOpts): Promise<PageResult<AuditRow>> {
    return await getDefaultWacClient().get(`/${workspace}/audit${buildQuery(opts)}`)
  },

  /** Returns the absolute endpoint used by `<AuditLogExportButton>`. */
  exportUrl (workspace: string, filter?: Record<string, unknown>): string {
    const q = filter != null && Object.keys(filter).length > 0 ? buildQuery({ filter }) : ''
    return `/api/wac/${workspace}/audit/export.csv${q}`
  }
}
