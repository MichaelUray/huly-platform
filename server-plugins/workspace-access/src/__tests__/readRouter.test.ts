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
  parseAuditQuery,
  buildAuditWhere,
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

function makeCtx (
  query?: Record<string, string | string[] | undefined>
): { ctx: KoaCtxLike, captured: CapturedResponse } {
  const captured: CapturedResponse = { raw: [], endCalled: false }
  const ctx: KoaCtxLike = {
    query,
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

  // T3 — Guest sub-roles
  //
  // handleMembers maps the raw DB role through `mapWacRole`, preserving
  // GUEST / READONLY_GUEST / DOC_GUEST distinction rather than collapsing
  // all three into a flat GUEST. Tolerant to both wire form and core-enum
  // form so it doesn't matter which upstream produced the row.

  it('preserves the three Guest sub-role variants on the wire', async () => {
    const { ctx, captured } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => [
        { person: 'pg', role: 'GUEST' },
        { person: 'pr', role: 'READONLYGUEST' }, // core enum form
        { person: 'pr2', role: 'READONLY_GUEST' }, // wire form
        { person: 'pd', role: 'DocGuest' }, // core enum form
        { person: 'pd2', role: 'DOC_GUEST' } // wire form
      ]
    }
    // 4 queries per row × 5 rows.
    const pg = makePg(Array(20).fill([{ n: 0 }]))
    const handlers = createWacReadHandlers(
      makeDeps({ accountDb: async () => accountDb, pgClient: async () => pg })
    )
    await handlers.handleMembers(ctx, 'ws-1', 'ws-1')
    const roles = captured.body.items.map((i: any) => i.role)
    expect(roles).toEqual(['GUEST', 'READONLY_GUEST', 'READONLY_GUEST', 'DOC_GUEST', 'DOC_GUEST'])
  })
})

describe('readRouter — handleSpaces', () => {
  it('returns spaces with owners parsed, dotted class and capability matrix', async () => {
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
    await handlers.handleSpaces(ctx, 'ws-1', 'workspace-label')
    expect(captured.status).toBe(200)
    // M7 — backend emits only real rows now. Placeholder synthesis
    // moved to AllSpacesTab.svelte client-side.
    expect(captured.body.items).toHaveLength(2)
    expect(captured.body.items[0]).toEqual({
      _id: 's1',
      _class: 'tracker.class.Project',
      name: 'Alpha',
      ownerIds: ['u1', 'u2'],
      membersCount: 4,
      private: true,
      autoJoin: false,
      archived: false,
      capabilities: {
        editableHere: true,
        openInApp: '/workbench/workspace-label/tracker/s1',
        v2NotYet: false
      }
    })
    expect(captured.body.items[1].name).toBe('—')
    expect(captured.body.items[1].ownerIds).toEqual(['u3'])
    expect(captured.body.items[1].membersCount).toBe(0)
    expect(captured.body.items[1].capabilities).toEqual({
      editableHere: true,
      openInApp: '/workbench/workspace-label/drive/s2',
      v2NotYet: false
    })
  })

  it('M7: backend emits NO v2 placeholders (moved to UI)', async () => {
    const { ctx, captured } = makeCtx()
    // Empty real-row result — pre-M7 the backend would still append 3
    // synthetic placeholders. Post-M7 the response is empty.
    const pg = makePg([[]])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleSpaces(ctx, 'ws-1', 'workspace-label')
    expect(captured.status).toBe(200)
    expect(captured.body.items).toEqual([])
    // No v2NotYet entries in any future shape.
    expect(JSON.stringify(captured.body)).not.toContain('placeholder')
    expect(JSON.stringify(captured.body)).not.toContain('v2NotYet')
  })

  it('maps every whitelisted _class to a deep-link openInApp', async () => {
    const { ctx, captured } = makeCtx()
    const pg = makePg([
      [
        { _id: 's-tp', _class: 'tracker:class:Project', name: 'P', owners: '[]', members_count: 0 },
        { _id: 's-ts', _class: 'document:class:Teamspace', name: 'T', owners: '[]', members_count: 0 },
        { _id: 's-dr', _class: 'drive:class:Drive', name: 'D', owners: '[]', members_count: 0 },
        { _id: 's-cs', _class: 'card:class:CardSpace', name: 'C', owners: '[]', members_count: 0 },
        { _id: 's-ln', _class: 'lead:class:Funnel', name: 'L', owners: '[]', members_count: 0 },
        { _id: 's-vc', _class: 'recruit:class:Vacancy', name: 'V', owners: '[]', members_count: 0 },
        { _id: 's-jf', _class: 'recruit:class:JobFunnel', name: 'J', owners: '[]', members_count: 0 }
      ]
    ])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleSpaces(ctx, 'ws-1', 'wpa')
    const apps = captured.body.items
      .filter((r: any) => r.capabilities.v2NotYet === false)
      .map((r: any) => r.capabilities.openInApp)
    expect(apps).toEqual([
      '/workbench/wpa/tracker/s-tp',
      '/workbench/wpa/document/s-ts',
      '/workbench/wpa/drive/s-dr',
      '/workbench/wpa/card/s-cs',
      '/workbench/wpa/lead/s-ln',
      '/workbench/wpa/recruit/s-vc',
      '/workbench/wpa/recruit/s-jf'
    ])
  })

  it('throws on pg failure', async () => {
    const { ctx } = makeCtx()
    const pg = makePg([new Error('boom')])
    const handlers = buildHandlers({ pgClient: async () => pg })
    await expect(handlers.handleSpaces(ctx, 'ws-1', 'ws-1')).rejects.toThrow(/boom/)
  })

  // Phase 4 T3 — WAC_EXTRA_SPACE_CLASSES wiring.
  //
  // The host parses the env into `extraSpaceClasses` and passes it as a
  // dep. handleSpaces must (a) thread it into the IN-list of the SQL, (b)
  // preserve the 7-entry v1 baseline, (c) drop malformed entries silently.
  describe('extraSpaceClasses (WAC_EXTRA_SPACE_CLASSES)', () => {
    function makeRecordingPg (rows: any[]): {
      pg: PgClientLike
      lastQuery: () => string
      lastParams: () => any[] | undefined
    } {
      let q = ''
      let p: any[] | undefined
      return {
        pg: {
          async execute (query, params) {
            q = query
            p = params
            return rows
          }
        },
        lastQuery: () => q,
        lastParams: () => p
      }
    }

    it('appends extra class to the IN-list and binds it via $-placeholders', async () => {
      const { ctx } = makeCtx()
      const rec = makeRecordingPg([])
      const handlers = createWacReadHandlers(
        makeDeps({ pgClient: async () => rec.pg, extraSpaceClasses: ['myplugin:class:Foo'] })
      )
      await handlers.handleSpaces(ctx, 'ws-1', 'wpa')
      const params = rec.lastParams() ?? []
      // $1 = workspaceUuid, $2..$N = class list. v1 baseline is 7 entries
      // plus the extra → 8 class params + workspace = 9 total.
      expect(params).toHaveLength(1 + 7 + 1)
      expect(params[0]).toBe('ws-1')
      expect(params).toContain('myplugin:class:Foo')
      // Baseline classes still present.
      expect(params).toContain('tracker:class:Project')
      expect(params).toContain('document:class:Teamspace')
      // SQL must use placeholder list, not the old inline string literal.
      const sql = rec.lastQuery()
      expect(sql).not.toContain("'tracker:class:Project'")
      expect(sql).toMatch(/_class"\s+IN\s+\(\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9\)/)
    })

    it('is a no-op when extraSpaceClasses is undefined or empty', async () => {
      const { ctx } = makeCtx()
      for (const extras of [undefined, []]) {
        const rec = makeRecordingPg([])
        const handlers = createWacReadHandlers(
          makeDeps({ pgClient: async () => rec.pg, extraSpaceClasses: extras })
        )
        await handlers.handleSpaces(ctx, 'ws-1', 'wpa')
        const params = rec.lastParams() ?? []
        // 7 baseline class params + workspace
        expect(params).toHaveLength(1 + 7)
      }
    })

    it('silently drops malformed entries (no colon-form, wildcard, empty)', async () => {
      const { ctx } = makeCtx()
      const rec = makeRecordingPg([])
      const handlers = createWacReadHandlers(
        makeDeps({
          pgClient: async () => rec.pg,
          extraSpaceClasses: ['', '   ', '*', 'no_colons', 'bad:format', 'good:class:Bar']
        })
      )
      await handlers.handleSpaces(ctx, 'ws-1', 'wpa')
      const params = rec.lastParams() ?? []
      // Only `good:class:Bar` is valid.
      expect(params).toContain('good:class:Bar')
      expect(params).not.toContain('*')
      expect(params).not.toContain('no_colons')
      expect(params).not.toContain('bad:format')
      expect(params).toHaveLength(1 + 7 + 1)
    })

    it('de-duplicates extras against the baseline and against each other', async () => {
      const { ctx } = makeCtx()
      const rec = makeRecordingPg([])
      const handlers = createWacReadHandlers(
        makeDeps({
          pgClient: async () => rec.pg,
          extraSpaceClasses: [
            'tracker:class:Project', // already in baseline
            'my:class:Foo',
            'my:class:Foo' // dup of previous extra
          ]
        })
      )
      await handlers.handleSpaces(ctx, 'ws-1', 'wpa')
      const params = rec.lastParams() ?? []
      // baseline (7) + 1 unique extra + workspace
      expect(params).toHaveLength(1 + 7 + 1)
      expect(params.filter((p: string) => p === 'tracker:class:Project')).toHaveLength(1)
      expect(params.filter((p: string) => p === 'my:class:Foo')).toHaveLength(1)
    })
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

  // ── A1: filter ?from=&to=&action= ──────────────────────────────────
  it('passes ts >= $2::timestamptz when ?from=… is provided', async () => {
    let lastQuery = ''
    let lastParams: any[] = []
    const pg: PgClientLike = {
      async execute (q, p) {
        lastQuery = q
        lastParams = p ?? []
        return []
      }
    }
    const { ctx } = makeCtx({ from: '2026-06-01T00:00:00Z' })
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAudit(ctx, 'ws-1')
    expect(lastQuery).toMatch(/ts >= \$2::timestamptz/)
    expect(lastParams).toEqual(['ws-1', '2026-06-01T00:00:00Z'])
  })

  it('passes both bounds + action filter as ANDed conditions', async () => {
    let lastQuery = ''
    let lastParams: any[] = []
    const pg: PgClientLike = {
      async execute (q, p) {
        lastQuery = q
        lastParams = p ?? []
        return []
      }
    }
    const { ctx } = makeCtx({
      from: '2026-06-01',
      to: '2026-06-30',
      action: 'role_changed'
    })
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAudit(ctx, 'ws-1')
    expect(lastQuery).toMatch(/ts >= \$2::timestamptz AND ts <= \$3::timestamptz AND action = \$4/)
    expect(lastParams).toEqual(['ws-1', '2026-06-01', '2026-06-30', 'role_changed'])
  })

  it('silently drops malformed filter values (no SQL injection surface)', async () => {
    let lastParams: any[] = []
    const pg: PgClientLike = {
      async execute (_q, p) {
        lastParams = p ?? []
        return []
      }
    }
    const { ctx } = makeCtx({
      from: "2026'; DROP TABLE workspace_audit_log;--",
      action: 'role_changed; DELETE'
    })
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAudit(ctx, 'ws-1')
    // Both values fail the ISO_RE / ACTION_RE guards → dropped → only
    // workspace param remains.
    expect(lastParams).toEqual(['ws-1'])
  })

  it('returns 200 with the unfiltered set when no query is provided', async () => {
    let lastQuery = ''
    const pg: PgClientLike = {
      async execute (q, _p) {
        lastQuery = q
        return []
      }
    }
    const { ctx, captured } = makeCtx()
    const handlers = buildHandlers({ pgClient: async () => pg })
    await handlers.handleAudit(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(lastQuery).toMatch(/WHERE workspace=\$1\s+ORDER BY/)
  })
})

describe('readRouter — parseAuditQuery + buildAuditWhere (A1 pure helpers)', () => {
  it('parseAuditQuery accepts ISO date-only', () => {
    expect(parseAuditQuery({ from: '2026-06-01' })).toEqual({ from: '2026-06-01' })
  })

  it('parseAuditQuery accepts full ISO timestamp with timezone', () => {
    expect(parseAuditQuery({ to: '2026-06-30T23:59:59+02:00' })).toEqual({
      to: '2026-06-30T23:59:59+02:00'
    })
  })

  it('parseAuditQuery rejects invalid ISO, action with special chars, undefined input', () => {
    expect(parseAuditQuery({ from: 'yesterday' })).toEqual({})
    expect(parseAuditQuery({ action: 'role;changed' })).toEqual({})
    expect(parseAuditQuery({ action: 'TOO_LOUD' })).toEqual({})
    expect(parseAuditQuery(undefined)).toEqual({})
  })

  it('parseAuditQuery takes first value when array is given', () => {
    expect(parseAuditQuery({ from: ['2026-06-01', '2026-07-01'] })).toEqual({
      from: '2026-06-01'
    })
  })

  it('buildAuditWhere produces base clause when filter is empty', () => {
    const { sql, params } = buildAuditWhere('ws-1', {})
    expect(sql).toBe('workspace=$1')
    expect(params).toEqual(['ws-1'])
  })

  it('buildAuditWhere appends ANDs in deterministic from/to/action order', () => {
    const { sql, params } = buildAuditWhere('ws-1', {
      action: 'space_archived',
      to: '2026-06-30',
      from: '2026-06-01'
    })
    expect(sql).toBe(
      'workspace=$1 AND ts >= $2::timestamptz AND ts <= $3::timestamptz AND action = $4'
    )
    expect(params).toEqual(['ws-1', '2026-06-01', '2026-06-30', 'space_archived'])
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

describe('readRouter — handleOwnersCount', () => {
  // Wave 5 / Task C2 — hard-rename from /admins/count to /owners/count.
  // The endpoint now counts ONLY AccountRole.Owner ('OWNER') — Maintainers
  // are read-only per D5 and must NOT be counted as admins/owners. Source
  // of truth is AccountDB.getWorkspaceMembers (single round-trip, no SQL).
  it('counts only OWNER (1 of 1+2+3 members) as `remaining`', async () => {
    const { ctx, captured } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'MAINTAINER' },
        { person: 'p3', role: 'MAINTAINER' },
        { person: 'p4', role: 'USER' },
        { person: 'p5', role: 'USER' },
        { person: 'p6', role: 'USER' }
      ]
    }
    const handlers = buildHandlers({ accountDb: async () => accountDb })
    await handlers.handleOwnersCount(ctx, 'ws-1')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ remaining: 1 })
  })

  it('returns 0 when no OWNER exists', async () => {
    const { ctx, captured } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => [
        { person: 'p1', role: 'MAINTAINER' },
        { person: 'p2', role: 'USER' }
      ]
    }
    const handlers = buildHandlers({ accountDb: async () => accountDb })
    await handlers.handleOwnersCount(ctx, 'ws-1')
    expect(captured.body).toEqual({ remaining: 0 })
  })

  it('returns 0 for an empty workspace member list', async () => {
    const { ctx, captured } = makeCtx()
    const accountDb: AccountDbLike = { getWorkspaceMembers: async () => [] }
    const handlers = buildHandlers({ accountDb: async () => accountDb })
    await handlers.handleOwnersCount(ctx, 'ws-1')
    expect(captured.body).toEqual({ remaining: 0 })
  })

  it('counts multiple OWNERs when present', async () => {
    const { ctx, captured } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' },
        { person: 'p3', role: 'OWNER' },
        { person: 'p4', role: 'MAINTAINER' }
      ]
    }
    const handlers = buildHandlers({ accountDb: async () => accountDb })
    await handlers.handleOwnersCount(ctx, 'ws-1')
    expect(captured.body).toEqual({ remaining: 3 })
  })

  it('throws when AccountDB enumeration fails', async () => {
    const { ctx } = makeCtx()
    const accountDb: AccountDbLike = {
      getWorkspaceMembers: async () => {
        throw new Error('count-down')
      }
    }
    const handlers = buildHandlers({ accountDb: async () => accountDb })
    await expect(handlers.handleOwnersCount(ctx, 'ws-1')).rejects.toThrow(/count-down/)
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
      'handleOwnersCount',
      'handleInvites',
      'handleGrants',
      'handleGrantsCount',
      'handleAuditCsvExport'
    ])
  })
})
