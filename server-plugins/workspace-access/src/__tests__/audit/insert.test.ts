//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// A3 — coverage for `executeWorkspaceAuditInsert`'s impersonation
// attribution. When the caller passes `impersonationActorAdmin`, the
// audit row's `metadata` jsonb must carry it as
// `impersonation_actor_admin` so the admin-side timeline reflects
// "X (admin) did Y while impersonating workspace Z".
//

import {
  WORKSPACE_AUDIT_INSERT_SQL,
  executeWorkspaceAuditInsert,
  type AuditInsertPgClient,
  type WorkspaceAuditPayload
} from '../../audit/insert'

interface CapturedQuery { query: string, parameters?: any[] }

function makePg (): { pg: AuditInsertPgClient, calls: CapturedQuery[] } {
  const calls: CapturedQuery[] = []
  const pg: AuditInsertPgClient = {
    execute: async (query: string, parameters?: any[]) => {
      calls.push({ query, parameters })
      return []
    }
  }
  return { pg, calls }
}

function basePayload (): WorkspaceAuditPayload {
  return {
    workspace: 'ws-1',
    action: 'role_changed',
    actor: 'caller-1',
    actorRole: 'workspace_owner'
  }
}

describe('executeWorkspaceAuditInsert — A3 impersonation attribution', () => {
  it('omits impersonation_actor_admin when not provided (regression guard)', async () => {
    const { pg, calls } = makePg()
    await executeWorkspaceAuditInsert(pg, basePayload())
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toBe(WORKSPACE_AUDIT_INSERT_SQL)
    // metadata is the LAST positional parameter ($10).
    const meta = JSON.parse(calls[0].parameters?.[9] as string)
    expect(meta).toEqual({})
  })

  it('writes metadata.impersonation_actor_admin when impersonationActorAdmin is set', async () => {
    const { pg, calls } = makePg()
    await executeWorkspaceAuditInsert(pg, {
      ...basePayload(),
      impersonationActorAdmin: 'admin-uuid-42'
    })
    const meta = JSON.parse(calls[0].parameters?.[9] as string)
    expect(meta).toEqual({ impersonation_actor_admin: 'admin-uuid-42' })
  })

  it('merges impersonation_actor_admin into existing metadata blob', async () => {
    const { pg, calls } = makePg()
    await executeWorkspaceAuditInsert(pg, {
      ...basePayload(),
      metadata: { source: 'wac-write', batch: 'b-99' },
      impersonationActorAdmin: 'admin-uuid-42'
    })
    const meta = JSON.parse(calls[0].parameters?.[9] as string)
    expect(meta).toEqual({
      source: 'wac-write',
      batch: 'b-99',
      impersonation_actor_admin: 'admin-uuid-42'
    })
  })

  it('skips impersonation_actor_admin when value is empty string', async () => {
    const { pg, calls } = makePg()
    await executeWorkspaceAuditInsert(pg, {
      ...basePayload(),
      impersonationActorAdmin: ''
    })
    const meta = JSON.parse(calls[0].parameters?.[9] as string)
    expect(meta).toEqual({})
  })

  it('skips impersonation_actor_admin when value is null', async () => {
    const { pg, calls } = makePg()
    await executeWorkspaceAuditInsert(pg, {
      ...basePayload(),
      impersonationActorAdmin: null
    })
    const meta = JSON.parse(calls[0].parameters?.[9] as string)
    expect(meta).toEqual({})
  })

  it('caller-supplied metadata.impersonation_actor_admin is overridden by the structured field', async () => {
    // Defensive: if a caller manually stuffed the key into `metadata`
    // AND passed the structured field, the structured field wins so
    // the audit pipeline has a single source of truth.
    const { pg, calls } = makePg()
    await executeWorkspaceAuditInsert(pg, {
      ...basePayload(),
      metadata: { impersonation_actor_admin: 'wrong-uuid' },
      impersonationActorAdmin: 'right-uuid'
    })
    const meta = JSON.parse(calls[0].parameters?.[9] as string)
    expect(meta).toEqual({ impersonation_actor_admin: 'right-uuid' })
  })
})
