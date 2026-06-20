//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 2A — integration tests for the read-route handlers.
//
// Each handler is exercised with a stub pg client + AccountDB. Tests assert
// the exact JSON shape returned to the host (so the frontend contract is
// pinned) and that pg errors bubble up as thrown rejections.

import {
  createWacReadHandlers,
  type WacReadDeps,
  type WacReadHandlers,
  type KoaCtxLike,
  type PgClientLike,
  type AccountDbLike,
  type MeasureCtxLike
} from '../http/readRouter'

interface CapturedResponse {
  status?: number
  headers?: Record<string, string>
  body?: any // parsed JSON, or array of write chunks for CSV
  raw?: any[]
  endCalled: boolean
}

function makeCtx (): { ctx: KoaCtxLike, captured: CapturedResponse } {
  const captured: CapturedResponse = { raw: [], endCalled: false }
  const ctx: KoaCtxLike = {
    res: {
      writeHead (status, headers) {
        captured.status = status
        captured.headers = headers
      },
      write (chunk) {
        captured.raw?.push(chunk)
      },
      end (chunk) {
        if (chunk !== undefined) captured.raw?.push(chunk)
        captured.endCalled = true
        // Attempt to parse a JSON body when there's a single string chunk.
        if (captured.raw?.length === 1 && typeof captured.raw[0] === 'string') {
          try {
            captured.body = JSON.parse(captured.raw[0])
          } catch {
            captured.body = captured.raw[0]
          }
        } else {
          captured.body = captured.raw
        }
      }
    }
  }
  return { ctx, captured }
}

function makePg (responses: Array<any[] | Error>): PgClientLike {
  let call = 0
  return {
    async execute (_query, _params) {
      const r = responses[call++]
      if (r instanceof Error) throw r
      // Allow tests to under-supply: undefined → []
      return r ?? []
    }
  }
}

function makeDeps (overrides: Partial<WacReadDeps> = {}): WacReadDeps {
  const measureCtx: MeasureCtxLike = { warn: () => {}, error: () => {} }
  const accountDb: AccountDbLike = {
    getWorkspaceMembers: async () => []
  }
  return {
    measureCtx,
    accountDb: async () => accountDb,
    pgClient: async () => ({ execute: async () => [] }),
    resolveWorkspaceUuid: async () => 'ws-1',
    ...overrides
  }
}

function buildHandlers (deps?: Partial<WacReadDeps>): WacReadHandlers {
  return createWacReadHandlers(makeDeps(deps))
}

describe('readRouter — handleMembers', () => {
  it('returns members with display name, email, role and activity bucket', async () => {
    const { ctx, captured } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'USER' }
      ]
    }
    // 4 queries per member: person, email, account.last_activity_at, spaces count
    const pg: PgClientLike = makePg([
      [{ first_name: 'Alice', last_name: 'A' }],
      [{ value: 'alice@x.test' }],
      [{ last_activity_at: Date.now() - 1000 }],
      [{ n: 3 }],
      [{ first_name: '', last_name: '' }],
      [{ value: 'bob@x.test' }],
      [{ last_activity_at: Date.now() - 40 * 86400_000 }],
      [{ n: 0 }]
    ])
    const handlers = createWacReadHandlers(
      makeDeps({ accountDb: async () => accountDb, pgClient: async () => pg })
    )

    await handlers.handleMembers(ctx, 'ws-1', 'workspace-url')
    expect(captured.status).toBe(200)
    expect(captured.body._workspace).toBe('workspace-url')
    expect(captured.body.cursor).toBeNull()
    expect(captured.body.items).toHaveLength(2)
    expect(captured.body.items[0]).toEqual({
      uuid: 'p1',
      name: 'Alice A',
      email: 'alice@x.test',
      role: 'OWNER',
      activityBucket: 'today',
      spacesCount: 3
    })
    // Person row with empty names falls back to email as display.
    expect(captured.body.items[1].name).toBe('bob@x.test')
    expect(captured.body.items[1].activityBucket).toBe('90d+')
    expect(captured.body.items[1].role).toBe('USER')
    expect(captured.body.items[1].spacesCount).toBe(0)
  })

  it('falls back to person UUID when neither name nor email is present', async () => {
    const { ctx, captured } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => [{ person: 'p9', role: null }]
    }
    const pg = makePg([[], [], [], [{ n: 1 }]])
    const handlers = createWacReadHandlers(
      makeDeps({ accountDb: async () => accountDb, pgClient: async () => pg })
    )
    await handlers.handleMembers(ctx, 'ws-1', 'ws-1')
    expect(captured.body.items[0].name).toBe('p9')
    expect(captured.body.items[0].email).toBe('')
    expect(captured.body.items[0].role).toBe('USER') // default
    expect(captured.body.items[0].activityBucket).toBe('90d+')
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => [{ person: 'p1', role: 'OWNER' }]
    }
    const pg = makePg([new Error('pg-down')])
    const handlers = createWacReadHandlers(
      makeDeps({ accountDb: async () => accountDb, pgClient: async () => pg })
    )
    await expect(handlers.handleMembers(ctx, 'ws-1', 'ws-1')).rejects.toThrow(/pg-down/)
  })
})

describe('readRouter — handleSpaces', () => {
  it('returns spaces with owners parsed and dotted class', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        {
          _id: 's1',
          _class: 'tracker:class:Project',
          name: 'Alpha',
          private_flag: true,
          auto_join: false,
          archived: false,
          owners: '["u1","u2"]',
          members_count: 4
        },
        {
          _id: 's2',
          _class: 'drive:class:Drive',
          name: null,
          private_flag: false,
          auto_join: true,
          archived: true,
          owners: ['u3'],
          members_count: '0'
        }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleSpaces(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(captured.body.items).toHaveLength(2)
    expect(captured.body.items[0]).toEqual({
      _id: 's1',
      _class: 'tracker.class.Project',
      name: 'Alpha',
      ownerIds: ['u1', 'u2'],
      membersCount: 4,
      private: true,
      autoJoin: false,
      archived: false
    })
    expect(captured.body.items[1].name).toBe('—')
    expect(captured.body.items[1].ownerIds).toEqual(['u3'])
    expect(captured.body.items[1].membersCount).toBe(0)
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('boom')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleSpaces(ctx, 'ws-1')).rejects.toThrow(/boom/)
  })
})

describe('readRouter — handleSpaceDetail', () => {
  it('returns 404 when the space row is missing', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([[]])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleSpaceDetail(ctx, 'ws-1', 'ws-1', 's-missing')
    expect(captured.status).toBe(404)
    expect(captured.body).toEqual({
      error: 'space_not_found',
      workspace: 'ws-1',
      space: 's-missing'
    })
  })

  it('returns full detail with parsed members/owners and membersCount', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        {
          _id: 's1',
          _class: 'tracker:class:Project',
          name: 'Alpha',
          private_flag: false,
          auto_join: false,
          archived: false,
          members: '["m1","m2","m3"]',
          owners: '["o1"]'
        }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleSpaceDetail(ctx, 'ws-1', 'ws-1', 's1')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({
      _id: 's1',
      _class: 'tracker.class.Project',
      name: 'Alpha',
      ownerIds: ['o1'],
      members: ['m1', 'm2', 'm3'],
      membersCount: 3,
      private: false,
      autoJoin: false,
      archived: false
    })
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('detail-boom')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleSpaceDetail(ctx, 'ws-1', 'ws-1', 's1')).rejects.toThrow(/detail-boom/)
  })
})

describe('readRouter — handleAudit', () => {
  it('returns audit rows with pseudonym=null and metadata default', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        {
          id: 1,
          ts: '2026-06-19T00:00:00Z',
          action: 'role_changed',
          actor: 'u1',
          actor_role: 'workspace_owner',
          target_account: 'u2',
          target_space: null,
          metadata: { batch_id: 'b1' }
        },
        {
          id: 2,
          ts: '2026-06-18T00:00:00Z',
          action: 'space_archived',
          actor: null,
          actor_role: 'system',
          target_account: null,
          target_space: 's1',
          metadata: null
        }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAudit(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(captured.body.items[0].actor_pseudonym).toBeNull()
    expect(captured.body.items[0].metadata).toEqual({ batch_id: 'b1' })
    expect(captured.body.items[1].metadata).toEqual({})
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('audit-down')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleAudit(ctx, 'ws-1')).rejects.toThrow(/audit-down/)
  })
})

describe('readRouter — handleMyAccess', () => {
  it('splits spacesOwned vs spacesMemberOf and echoes the caller role', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        {
          _id: 's-own',
          _class: 'tracker:class:Project',
          name: 'Mine',
          members: '["caller","alice"]',
          owners: '["caller"]',
          private_flag: true,
          archived: false
        },
        {
          _id: 's-mem',
          _class: 'document:class:Teamspace',
          name: 'Joined',
          members: '["caller","bob"]',
          owners: '["bob"]',
          private_flag: false,
          archived: false
        }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleMyAccess(ctx, 'ws-1', 'caller', 'OWNER')
    expect(captured.status).toBe(200)
    expect(captured.body.role).toBe('OWNER')
    expect(captured.body.grantsReceived).toEqual([])
    expect(captured.body.grantsGiven).toEqual([])
    expect(captured.body.spacesOwned.map((s: any) => s._id)).toEqual(['s-own'])
    expect(captured.body.spacesMemberOf.map((s: any) => s._id)).toEqual(['s-mem'])
    expect(captured.body.spacesOwned[0].autoJoin).toBe(false)
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('access-boom')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleMyAccess(ctx, 'ws-1', 'caller', 'USER')).rejects.toThrow(/access-boom/)
  })
})

describe('readRouter — handleAdminsCount', () => {
  it('returns the count of OWNER+MAINTAINER as `remaining`', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([[{ c: '3' }]])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAdminsCount(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ remaining: 3 })
  })

  it('defaults to 0 when the row is absent', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([[]])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAdminsCount(ctx, 'ws-1')
    expect(captured.body).toEqual({ remaining: 0 })
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('count-down')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleAdminsCount(ctx, 'ws-1')).rejects.toThrow(/count-down/)
  })
})

describe('readRouter — handleInvites', () => {
  it('returns invites with default invitedBy=system', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        { id: 'i1', email: 'a@x.test', expires_on: '2026-07-01', created_on: '2026-06-01' },
        { id: 'i2', email: null, expires_on: null, created_on: '2026-06-02' }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleInvites(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(captured.body.items[0]).toEqual({
      id: 'i1',
      email: 'a@x.test',
      invitedBy: 'system',
      invitedAt: '2026-06-01',
      expiresAt: '2026-07-01'
    })
    expect(captured.body.items[1].email).toBe('unknown')
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('inv-down')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleInvites(ctx, 'ws-1')).rejects.toThrow(/inv-down/)
  })
})

describe('readRouter — handleGrants', () => {
  it('joins person+social_id to derive display names', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        {
          resource_id: 'r1',
          recipient: 'rcp1',
          resource: 'doc-1',
          attached_class: 'document:class:Document',
          granter: 'gnt1',
          granted_at: '2026-06-10',
          recipient_first: 'Recipient',
          recipient_last: 'One',
          recipient_email: 'r1@x.test',
          granter_first: 'Granter',
          granter_last: 'Person'
        },
        {
          resource_id: 'r2',
          recipient: 'rcp2',
          resource: null,
          attached_class: null,
          granter: null,
          granted_at: '2026-06-11',
          recipient_first: '',
          recipient_last: '',
          recipient_email: 'r2@x.test',
          granter_first: null,
          granter_last: null
        }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleGrants(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(captured.body.items[0]).toEqual({
      recipientUuid: 'rcp1',
      recipientName: 'Recipient One',
      granterUuid: 'gnt1',
      granterName: 'Granter Person',
      resourceId: 'doc-1',
      resourceClass: 'document.class.Document',
      resourceTitle: 'Document',
      grantedAt: '2026-06-10'
    })
    // Falls back through email when names are blank, and to 'system' for absent granter.
    expect(captured.body.items[1].recipientName).toBe('r2@x.test')
    expect(captured.body.items[1].granterUuid).toBe('system')
    expect(captured.body.items[1].granterName).toBe('system')
    expect(captured.body.items[1].resourceId).toBe('r2') // resource null → resource_id fallback
    expect(captured.body.items[1].resourceTitle).toBe('Resource')
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('grants-down')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleGrants(ctx, 'ws-1')).rejects.toThrow(/grants-down/)
  })
})

describe('readRouter — handleGrantsCount', () => {
  it('returns the collaborator count', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([[{ c: '17' }]])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleGrantsCount(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ count: 17 })
  })

  it('defaults to 0 when the row is absent', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([[]])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleGrantsCount(ctx, 'ws-1')
    expect(captured.body).toEqual({ count: 0 })
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('gc-down')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleGrantsCount(ctx, 'ws-1')).rejects.toThrow(/gc-down/)
  })
})

describe('readRouter — handleAuditCsvExport', () => {
  it('writes the BOM, header row and CSV body terminated by CRLF', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        {
          id: 1,
          ts: '2026-06-19T00:00:00Z',
          action: 'role_changed',
          actor: 'u1',
          actor_role: 'workspace_owner',
          target_account: 'u2',
          target_space: 'sp1',
          target_space_class: 'tracker:class:Project'
        },
        {
          id: 2,
          ts: '2026-06-18T00:00:00Z',
          action: 'space_archived,extra',
          actor: null,
          actor_role: 'system',
          target_account: null,
          target_space: null,
          target_space_class: null
        }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAuditCsvExport(ctx, 'ws-1')

    expect(captured.status).toBe(200)
    expect(captured.headers?.['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(captured.headers?.['Cache-Control']).toBe('no-store')
    expect(captured.headers?.['Content-Disposition']).toMatch(/^attachment; filename="wac-audit-\d+\.csv"$/)

    // BOM first, header row second.
    const raw = captured.raw as any[]
    expect(Buffer.isBuffer(raw[0])).toBe(true)
    expect((raw[0] as Buffer).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true)
    expect(raw[1]).toBe('id,ts,action,actor,actor_role,target_account,target_space,target_space_class\r\n')
    expect(raw[2]).toBe('1,2026-06-19T00:00:00Z,role_changed,u1,workspace_owner,u2,sp1,tracker:class:Project\r\n')
    // Comma in `action` triggers RFC-4180 quoting.
    expect(raw[3]).toBe('2,2026-06-18T00:00:00Z,"space_archived,extra",,system,,,\r\n')
  })

  it('still writes BOM + header when there are no audit rows', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([[]])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAuditCsvExport(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    const raw = captured.raw as any[]
    expect(raw.length).toBe(2) // BOM + header only
    expect(raw[1]).toMatch(/^id,ts,/)
    expect(captured.endCalled).toBe(true)
  })

  it('throws on pg failure (host wraps as 500)', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('csv-down')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleAuditCsvExport(ctx, 'ws-1')).rejects.toThrow(/csv-down/)
  })
})

describe('readRouter — factory surface', () => {
  it('exposes 10 handlers', () => {
    const handlers = buildHandlers()
    const keys = Object.keys(handlers)
    expect(keys).toEqual([
      'handleMembers',
      'handleSpaces',
      'handleSpaceDetail',
      'handleAudit',
      'handleMyAccess',
      'handleAdminsCount',
      'handleInvites',
      'handleGrants',
      'handleGrantsCount',
      'handleAuditCsvExport'
    ])
  })
})
