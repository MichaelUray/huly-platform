//
// Copyright © 2026 Hardcore Engineering Inc.
//

import type { AuditMapper } from '@hcengineering/access-management-ui/src/types/AuditEntry'
import type { AuditRow } from '../../types'

export const workspaceAuditMapper: AuditMapper<AuditRow> = (e) => ({
  actor: e.actor_pseudonym ?? e.actor ?? 'system',
  when: e.ts,
  what: e.action,
  metadata: {
    batch_id: e.metadata?.batch_id,
    impersonation_ref: e.metadata?.impersonation_ref,
    target_account: e.target_account,
    target_space: e.target_space
  }
})
