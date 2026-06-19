//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Migration registry. SQL is inlined so the package has no fs / path
// dependencies; the wiring layer (in a follow-up PR) only needs to
// import { migrations } and apply them in order.
//

import { V31_SQL } from './V31_inline'
import { V32_SQL } from './V32_inline'
import { V33_SQL } from './V33_inline'

export interface Migration {
  id: 'V31' | 'V32' | 'V33'
  description: string
  sql: string
}

export const migrations: ReadonlyArray<Migration> = Object.freeze([
  { id: 'V31', description: 'workspace_audit_log table + four base indexes', sql: V31_SQL },
  { id: 'V32', description: 'batch_id index + wal_backfill_run + idempotency unique', sql: V32_SQL },
  { id: 'V33', description: 'Backfill seed — one wal_backfill_run row per existing workspace', sql: V33_SQL }
])
