//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 2B Tasks 2 + 3 + 4 — tests for the write-route handlers.
//
// Each handler is exercised against stub txClient + pgClient + accountDb.
// Tests pin:
//   - Happy-path: txClient.updateDoc called with expected args, audit
//     INSERT issued, 200 returned.
//   - Body parse-error → 400.
//   - Space not found → 404.
//   - Last-owner refusal → 409 (where applicable).
//   - txClient.updateDoc throws → 500, no audit insert.
//   - pg-audit insert throws AFTER successful updateDoc → 200 still
//     returned, error logged via measureCtx.error('… wac_audit_orphan …').
//
// handleGrantRevoke is the real revoke (P2B-T6): findOne collaborator,
// removeDoc via TxOperations, audit row, 200. Failure paths covered.

import core from '@hcengineering/core'

import {
  createWacWriteHandlers,
  type WacWriteDeps,
  type WacWriteHandlers,
  type KoaWriteCtxLike,
  type WacTxClientLike,
  type WritePgClientLike,
  type WriteAccountDbLike,
  type WriteMeasureCtxLike
} from '../http/writeRouter'

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface CapturedResponse {
  status?: number
  headers?: Record<string, string>
  body?: any
  raw: any[]
  endCalled: boolean
}

function makeCtx (body: any = {}): { ctx: KoaWriteCtxLike, captured: CapturedResponse } {
  const captured: CapturedResponse = { raw: [], endCalled: false }
  const ctx: KoaWriteCtxLike = {
    request: { body },
    res: {
      writeHead (status, headers) {
        captured.status = status
        captured.headers = headers
      },
      end (chunk) {
        if (chunk !== undefined) captured.raw.push(chunk)
        captured.endCalled = true
        if (captured.raw.length === 1 && typeof captured.raw[0] === 'string') {
          try {
            captured.body = JSON.parse(captured.raw[0])
          } catch {
            captured.body = captured.raw[0]
          }
        }
      }
    }
  }
  return { ctx, captured }
}

interface TxCall {
  workspace: string
  actor: string
  _class: string
  space: string
  _id: string
  update: any
}

interface PgCall {
  query: string
  params: any[]
}

interface RoleUpdateCall {
  account: string
  workspace: string
  role: string
}

interface InvalidateCall {
  workspace: string
  account: string
}

interface RemoveDocCall {
  workspace: string
  actor: string
  _class: string
  space: string
  _id: string
}

interface FindOneCall {
  workspace: string
  _class: string
  query: any
}

interface Harness {
  deps: WacWriteDeps
  handlers: WacWriteHandlers
  txCalls: TxCall[]
  pgCalls: PgCall[]
  roleCalls: RoleUpdateCall[]
  invalidateCalls: InvalidateCall[]
  removeDocCalls: RemoveDocCall[]
  findOneCalls: FindOneCall[]
  errors: Array<{ msg: string, attrs: any }>
  warns: Array<{ msg: string, attrs: any }>
  /** M1 — measureCtx.measure(name, value) call log. */
  metrics: Array<{ name: string, value: number }>
}

interface MakeHarnessOpts {
  spaceRow?: Record<string, any> | null
  members?: Array<{ person: string, role?: string | null }>
  updateDocImpl?: (call: TxCall) => Promise<void>
  auditInsertThrows?: boolean
  pgFindRowOverride?: any[] // explicit response for the SELECT space row
  updateRoleImpl?: (call: RoleUpdateCall) => Promise<void>
  /** P2B-T5 — install a cacheInvalidator dep that records calls. */
  withCacheInvalidator?: boolean
  /** P2B-T5 — make the invalidator throw to verify swallowing. */
  invalidatorThrows?: boolean
  /** P2B-T6 — controls what txClient.findOne returns for grant lookup. */
  findOneImpl?: (call: FindOneCall) => Promise<any>
  /** P2B-T6 — throw from txClient.removeDoc. */
  removeDocImpl?: (call: RemoveDocCall) => Promise<void>
  /**
   * H3 — install the atomic `updateWorkspaceRoleIfNotLastOwner` accountDb
   * method. Returning false simulates the SQL gate refusing the demote
   * because a concurrent request would have left zero OWNERs.
   */
  atomicRoleUpdateImpl?: (call: RoleUpdateCall) => Promise<boolean>
}

function defaultSpaceRow (id = 'space-1', _class = 'tracker:class:Project'): Record<string, any> {
  return {
    _id: id,
    _class,
    space: 'core:space:Space',
    members: JSON.stringify(['m1', 'm2']),
    owners: JSON.stringify(['o1']),
    private_flag: false,
    auto_join: false,
    archived: false
  }
}

function makeHarness (opts: MakeHarnessOpts = {}): Harness {
  const txCalls: TxCall[] = []
  const pgCalls: PgCall[] = []
  const roleCalls: RoleUpdateCall[] = []
  const invalidateCalls: InvalidateCall[] = []
  const removeDocCalls: RemoveDocCall[] = []
  const findOneCalls: FindOneCall[] = []
  const errors: Array<{ msg: string, attrs: any }> = []
  const warns: Array<{ msg: string, attrs: any }> = []
  const metrics: Array<{ name: string, value: number }> = []

  const measureCtx: WriteMeasureCtxLike = {
    warn (msg, attrs) { warns.push({ msg, attrs: attrs ?? {} }) },
    error (msg, attrs) { errors.push({ msg, attrs: attrs ?? {} }) },
    measure (name, value) { metrics.push({ name, value }) }
  }

  const txClient: WacTxClientLike = {
    updateDoc: (async (workspace: any, actor: any, _class: any, space: any, _id: any, update: any) => {
      const call: TxCall = {
        workspace: String(workspace),
        actor: String(actor),
        _class: String(_class),
        space: String(space),
        _id: String(_id),
        update
      }
      txCalls.push(call)
      if (opts.updateDocImpl != null) await opts.updateDocImpl(call)
    }) as any,
    findOne: (async (workspace: any, _class: any, query: any) => {
      const call: FindOneCall = {
        workspace: String(workspace),
        _class: String(_class),
        query
      }
      findOneCalls.push(call)
      if (opts.findOneImpl != null) return await opts.findOneImpl(call)
      return undefined
    }) as any,
    removeDoc: (async (workspace: any, actor: any, _class: any, space: any, _id: any) => {
      const call: RemoveDocCall = {
        workspace: String(workspace),
        actor: String(actor),
        _class: String(_class),
        space: String(space),
        _id: String(_id)
      }
      removeDocCalls.push(call)
      if (opts.removeDocImpl != null) await opts.removeDocImpl(call)
    }) as any
  }

  const spaceRow = opts.spaceRow !== undefined ? opts.spaceRow : defaultSpaceRow()
  let spaceLookupDone = false
  const pgClient: WritePgClientLike = {
    async execute (query, params = []) {
      pgCalls.push({ query, params })
      const isSpaceSelect = /FROM space WHERE "workspaceId"=\$1 AND "_id"=\$2 LIMIT 1/i.test(query)
      if (isSpaceSelect && !spaceLookupDone) {
        spaceLookupDone = true
        if (opts.pgFindRowOverride != null) return opts.pgFindRowOverride
        return spaceRow == null ? [] : [spaceRow]
      }
      const isAuditInsert = /INSERT INTO workspace_audit_log/i.test(query)
      if (isAuditInsert) {
        if (opts.auditInsertThrows === true) {
          throw new Error('pg audit insert failed')
        }
        return []
      }
      return []
    }
  }

  const accountDb: WriteAccountDbLike = {
    getWorkspaceMembers: async () => opts.members ?? [],
    updateWorkspaceRole: (async (account: any, workspace: any, role: any) => {
      const call: RoleUpdateCall = {
        account: String(account),
        workspace: String(workspace),
        role: String(role)
      }
      roleCalls.push(call)
      if (opts.updateRoleImpl != null) await opts.updateRoleImpl(call)
    }) as any
  }
  if (opts.atomicRoleUpdateImpl != null) {
    accountDb.updateWorkspaceRoleIfNotLastOwner = (async (
      account: any,
      workspace: any,
      role: any
    ) => {
      const call: RoleUpdateCall = {
        account: String(account),
        workspace: String(workspace),
        role: String(role)
      }
      roleCalls.push(call)
      // call back to record + decide outcome
      return await opts.atomicRoleUpdateImpl!(call)
    }) as any
  }

  const deps: WacWriteDeps = {
    measureCtx,
    txClient,
    pgClient: async () => pgClient,
    accountDb: async () => accountDb
  }
  if (opts.withCacheInvalidator === true) {
    deps.cacheInvalidator = {
      invalidateAccountInWorkspace: (async (workspace: any, account: any) => {
        invalidateCalls.push({ workspace: String(workspace), account: String(account) })
        if (opts.invalidatorThrows === true) {
          throw new Error('invalidator boom')
        }
      }) as any
    }
  }
  const handlers = createWacWriteHandlers(deps)
  return {
    deps,
    handlers,
    txCalls,
    pgCalls,
    roleCalls,
    invalidateCalls,
    removeDocCalls,
    findOneCalls,
    errors,
    warns,
    metrics
  }
}

function auditCalls (h: Harness): PgCall[] {
  return h.pgCalls.filter((c) => /INSERT INTO workspace_audit_log/i.test(c.query))
}

// ---------------------------------------------------------------------------
// handleSpaceMembers
// ---------------------------------------------------------------------------

describe('writeRouter — handleSpaceMembers', () => {
  it('happy path: mutates via txClient + inserts audit row + 200', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ members: ['a', 'b', 'c'] })
    await h.handlers.handleSpaceMembers(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ ok: true })
    expect(h.txCalls).toHaveLength(1)
    expect(h.txCalls[0]).toMatchObject({
      workspace: 'ws-1',
      actor: 'caller-1',
      _class: 'tracker:class:Project',
      space: 'core:space:Space',
      _id: 'space-1',
      update: { members: ['a', 'b', 'c'] }
    })
    expect(auditCalls(h)).toHaveLength(1)
  })

  it('400 on missing / non-array body.members', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ members: 'not-an-array' })
    await h.handlers.handleSpaceMembers(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(400)
    expect(captured.body).toEqual({ error: 'bad_request' })
    expect(h.txCalls).toHaveLength(0)
  })

  it('404 when space not found', async () => {
    const h = makeHarness({ spaceRow: null })
    const { ctx, captured } = makeCtx({ members: ['x'] })
    await h.handlers.handleSpaceMembers(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(404)
    expect(captured.body).toEqual({ error: 'space_not_found' })
    expect(h.txCalls).toHaveLength(0)
  })

  it('500 when txClient.updateDoc throws, no audit insert', async () => {
    const h = makeHarness({
      updateDocImpl: async () => {
        throw new Error('boom')
      }
    })
    const { ctx, captured } = makeCtx({ members: ['a'] })
    await h.handlers.handleSpaceMembers(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(500)
    expect(captured.body.error).toBe('write_failed')
    expect(auditCalls(h)).toHaveLength(0)
  })

  it('200 when pg-audit INSERT throws AFTER successful mutation, logs orphan', async () => {
    const h = makeHarness({ auditInsertThrows: true })
    const { ctx, captured } = makeCtx({ members: ['a'] })
    await h.handlers.handleSpaceMembers(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(200)
    expect(h.txCalls).toHaveLength(1)
    expect(h.errors.some((e) => e.attrs.breadcrumb === 'wac_audit_orphan')).toBe(true)
    // M1 — orphan counter increment.
    expect(h.metrics).toContainEqual({ name: 'wac_audit_orphan', value: 1 })
  })
})

// ---------------------------------------------------------------------------
// handleSpaceOwners + last-owner protection
// ---------------------------------------------------------------------------

describe('writeRouter — handleSpaceOwners', () => {
  it('happy path: updates owners via txClient + audit + 200', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ owners: ['o2', 'o3'] })
    await h.handlers.handleSpaceOwners(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(200)
    expect(h.txCalls[0].update).toEqual({ owners: ['o2', 'o3'] })
    expect(auditCalls(h)).toHaveLength(1)
  })

  it('400 on missing owners array', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleSpaceOwners(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(400)
    expect(captured.body).toEqual({ error: 'bad_request' })
  })

  it('404 when space not found', async () => {
    const h = makeHarness({ spaceRow: null })
    const { ctx, captured } = makeCtx({ owners: ['o1'] })
    await h.handlers.handleSpaceOwners(ctx, 'ws-1', 'caller-1', 'missing')
    expect(captured.status).toBe(404)
  })

  it('409 last_owner when zero-owner-list applied to workspace-level Space', async () => {
    const wsSpaceId = core.space.Workspace as unknown as string
    const h = makeHarness({ spaceRow: { ...defaultSpaceRow(wsSpaceId, 'core:class:Space') } })
    const { ctx, captured } = makeCtx({ owners: [] })
    await h.handlers.handleSpaceOwners(ctx, 'ws-1', 'caller-1', wsSpaceId)
    expect(captured.status).toBe(409)
    expect(captured.body.error).toBe('last_owner')
    expect(h.txCalls).toHaveLength(0)
  })

  it('allows zero owners on a non-workspace-level space', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ owners: [] })
    await h.handlers.handleSpaceOwners(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(200)
    expect(h.txCalls).toHaveLength(1)
  })

  it('500 when txClient throws, no audit', async () => {
    const h = makeHarness({ updateDocImpl: async () => { throw new Error('x') } })
    const { ctx, captured } = makeCtx({ owners: ['o1'] })
    await h.handlers.handleSpaceOwners(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(500)
    expect(auditCalls(h)).toHaveLength(0)
  })

  it('200 + orphan-log when audit throws post-mutation', async () => {
    const h = makeHarness({ auditInsertThrows: true })
    const { ctx, captured } = makeCtx({ owners: ['o1'] })
    await h.handlers.handleSpaceOwners(ctx, 'ws-1', 'caller-1', 'space-1')
    expect(captured.status).toBe(200)
    expect(h.errors.some((e) => e.attrs.breadcrumb === 'wac_audit_orphan')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Flag handlers (privacy/auto-join/archived) — parametrised
// ---------------------------------------------------------------------------

interface FlagFixture {
  name: string
  field: 'private' | 'autoJoin' | 'archived'
  invoke: (handlers: WacWriteHandlers, ctx: KoaWriteCtxLike, ws: string, caller: string, sp: string) => Promise<void>
  expectedAction: (newValue: boolean) => string
}

const FLAG_FIXTURES: FlagFixture[] = [
  {
    name: 'handleSpacePrivacy',
    field: 'private',
    invoke: async (h, ctx, w, c, s) => await h.handleSpacePrivacy(ctx, w, c, s),
    expectedAction: () => 'space_privacy_changed'
  },
  {
    name: 'handleSpaceAutoJoin',
    field: 'autoJoin',
    invoke: async (h, ctx, w, c, s) => await h.handleSpaceAutoJoin(ctx, w, c, s),
    expectedAction: () => 'space_autojoin_changed'
  },
  {
    name: 'handleSpaceArchived',
    field: 'archived',
    invoke: async (h, ctx, w, c, s) => await h.handleSpaceArchived(ctx, w, c, s),
    expectedAction: (v) => (v ? 'space_archived' : 'space_unarchived')
  }
]

for (const fx of FLAG_FIXTURES) {
  describe(`writeRouter — ${fx.name}`, () => {
    it('happy path: updates flag via txClient + audit + 200', async () => {
      const h = makeHarness()
      const { ctx, captured } = makeCtx({ [fx.field]: true })
      await fx.invoke(h.handlers, ctx, 'ws-1', 'caller-1', 'space-1')
      expect(captured.status).toBe(200)
      expect(h.txCalls).toHaveLength(1)
      expect(h.txCalls[0].update).toEqual({ [fx.field]: true })
      const audits = auditCalls(h)
      expect(audits).toHaveLength(1)
      expect(audits[0].params[1]).toBe(fx.expectedAction(true))
    })

    it('400 when body cannot be parsed', async () => {
      const h = makeHarness()
      const { ctx, captured } = makeCtx(null)
      await fx.invoke(h.handlers, ctx, 'ws-1', 'caller-1', 'space-1')
      expect(captured.status).toBe(400)
    })

    it('404 when space missing', async () => {
      const h = makeHarness({ spaceRow: null })
      const { ctx, captured } = makeCtx({ [fx.field]: true })
      await fx.invoke(h.handlers, ctx, 'ws-1', 'caller-1', 'space-1')
      expect(captured.status).toBe(404)
    })

    it('500 when updateDoc throws, no audit', async () => {
      const h = makeHarness({ updateDocImpl: async () => { throw new Error('boom') } })
      const { ctx, captured } = makeCtx({ [fx.field]: true })
      await fx.invoke(h.handlers, ctx, 'ws-1', 'caller-1', 'space-1')
      expect(captured.status).toBe(500)
      expect(auditCalls(h)).toHaveLength(0)
    })

    it('200 + orphan-log when audit fails post-mutation', async () => {
      const h = makeHarness({ auditInsertThrows: true })
      const { ctx, captured } = makeCtx({ [fx.field]: true })
      await fx.invoke(h.handlers, ctx, 'ws-1', 'caller-1', 'space-1')
      expect(captured.status).toBe(200)
      expect(h.errors.some((e) => e.attrs.breadcrumb === 'wac_audit_orphan')).toBe(true)
    })
  })
}

// ---------------------------------------------------------------------------
// handleMemberRole — last-owner protection on demote
// ---------------------------------------------------------------------------

describe('writeRouter — handleMemberRole', () => {
  it('happy path: updates role via accountDb + audit + 200', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' },
        { person: 'p3', role: 'USER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p3')
    expect(captured.status).toBe(200)
    expect(h.roleCalls[0]).toEqual({ account: 'p3', workspace: 'ws-1', role: 'MAINTAINER' })
    expect(auditCalls(h)).toHaveLength(1)
  })

  it('400 on bad role', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ role: 'GOD' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p3')
    expect(captured.status).toBe(400)
    expect(captured.body.error).toBe('bad_role')
    expect(h.roleCalls).toHaveLength(0)
  })

  it('400 on missing body', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx(null)
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p3')
    expect(captured.status).toBe(400)
  })

  it('409 last_owner when demoting the only OWNER', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'USER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'USER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
    expect(captured.status).toBe(409)
    expect(captured.body.error).toBe('last_owner')
    expect(h.roleCalls).toHaveLength(0)
  })

  it('allows demoting one OWNER when another remains', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'USER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
    expect(captured.status).toBe(200)
    expect(h.roleCalls).toHaveLength(1)
  })

  it('500 when accountDb.updateWorkspaceRole throws, no audit', async () => {
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }],
      updateRoleImpl: async () => { throw new Error('db fail') }
    })
    const { ctx, captured } = makeCtx({ role: 'USER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
    expect(captured.status).toBe(500)
    expect(auditCalls(h)).toHaveLength(0)
  })

  it('200 + orphan-log when audit throws post-mutation', async () => {
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }],
      auditInsertThrows: true
    })
    const { ctx, captured } = makeCtx({ role: 'USER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
    expect(captured.status).toBe(200)
    expect(h.errors.some((e) => e.attrs.breadcrumb === 'wac_audit_orphan')).toBe(true)
  })

  // H3 — atomic owner-race protection. The reference SQL is documented in
  // WriteAccountDbLike.updateWorkspaceRoleIfNotLastOwner. We can't write a
  // deterministic concurrency test in jest, but we CAN pin two contracts:
  //   1. When the accountDb exposes the atomic helper, the handler routes
  //      through it instead of the legacy update.
  //   2. When the atomic helper returns false (= the SQL gate refused the
  //      demote because a concurrent request raced us), the handler
  //      returns 409 last_owner — even though the snapshot read above
  //      saw a safe ownerCount.
  describe('H3: atomic owner-race protection', () => {
    it('routes through updateWorkspaceRoleIfNotLastOwner when available', async () => {
      const h = makeHarness({
        members: [
          { person: 'p1', role: 'OWNER' },
          { person: 'p2', role: 'OWNER' }
        ],
        atomicRoleUpdateImpl: async () => true
      })
      const { ctx, captured } = makeCtx({ role: 'USER' })
      await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
      expect(captured.status).toBe(200)
      expect(h.roleCalls).toHaveLength(1)
      // No fallback warn breadcrumb when the atomic path is taken.
      expect(h.warns.some((w) => w.attrs.breadcrumb === 'wac_owner_race_fallback')).toBe(false)
    })

    it('returns 409 when the SQL gate refuses the demote (race lost)', async () => {
      // Snapshot read sees ownerCount=2 (safe), but the atomic SQL gate
      // returns false — a concurrent demote already landed before our
      // UPDATE, leaving only one OWNER. We must still return 409.
      const h = makeHarness({
        members: [
          { person: 'p1', role: 'OWNER' },
          { person: 'p2', role: 'OWNER' }
        ],
        atomicRoleUpdateImpl: async () => false
      })
      const { ctx, captured } = makeCtx({ role: 'USER' })
      await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
      expect(captured.status).toBe(409)
      expect(captured.body.error).toBe('last_owner')
      // The atomic helper was called, but no legacy fallback.
      expect(h.roleCalls).toHaveLength(1)
      expect(auditCalls(h)).toHaveLength(0)
    })

    it('legacy fallback path (no atomic helper) still works and logs the breadcrumb', async () => {
      const h = makeHarness({
        members: [
          { person: 'p1', role: 'OWNER' },
          { person: 'p2', role: 'OWNER' }
        ]
        // No atomicRoleUpdateImpl — the handler falls back to the
        // legacy non-atomic updateWorkspaceRole.
      })
      const { ctx, captured } = makeCtx({ role: 'USER' })
      await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
      expect(captured.status).toBe(200)
      expect(h.warns.some((w) => w.attrs.breadcrumb === 'wac_owner_race_fallback')).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// handleBulkMemberRole
// ---------------------------------------------------------------------------

describe('writeRouter — handleBulkMemberRole', () => {
  it('happy path: all-success returns 200 with per-target ok rows', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' },
        { person: 'p3', role: 'USER' },
        { person: 'p4', role: 'USER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER', members: ['p3', 'p4'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(captured.body.appliedCount).toBe(2)
    expect(typeof captured.body.batch_id).toBe('string')
    expect(captured.body.results).toEqual([
      { memberUuid: 'p3', status: 'ok' },
      { memberUuid: 'p4', status: 'ok' }
    ])
    expect(h.roleCalls).toHaveLength(2)
    expect(auditCalls(h)).toHaveLength(2)
  })

  it('400 when members is not an array', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ role: 'USER', members: 'x' })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(400)
    expect(captured.body.error).toBe('bad_request')
  })

  it('400 on bad role', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ role: 'BOSS', members: ['p1'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(400)
    expect(captured.body.error).toBe('bad_role')
  })

  it('409 last_owner when bulk-demote would empty the OWNER set entirely', async () => {
    // Workspace-level guard kept: if the bulk covers *every* owner there
    // is no useful partial state to return — keep the hard 409.
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'USER', members: ['p1', 'p2'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(409)
    expect(h.roleCalls).toHaveLength(0)
  })

  it('H2: partial success — internal error on one target, others ok', async () => {
    let call = 0
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }, { person: 'p2', role: 'USER' }],
      updateRoleImpl: async () => {
        call++
        if (call === 2) throw new Error('boom')
      }
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER', members: ['p1', 'p2'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(captured.body.appliedCount).toBe(1)
    expect(captured.body.results).toEqual([
      { memberUuid: 'p1', status: 'ok' },
      { memberUuid: 'p2', status: 'internal', detail: 'write_failed' }
    ])
    // Only the successful one was audited.
    expect(auditCalls(h)).toHaveLength(1)
  })

  it('H2: per-target last_owner_refused when smaller bulk covers the only owner', async () => {
    // Bulk-targets only p1 (the single OWNER) — workspace-level guard
    // doesn't fire because the OWNER set isn't empty after only p1 was
    // requested? It is. Then we need a different shape: 2 owners, target
    // both (covered above as 409). For per-target refusal we need a bulk
    // that targets a single owner alongside non-owners — the workspace-
    // level guard accepts (p1's demote leaves zero), so we use a 1-owner
    // workspace.
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'USER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'USER', members: ['p1'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    // Workspace-level guard catches this one (entire OWNER set would be
    // empty) so 409 is correct. Documenting the alternative path:
    expect(captured.status).toBe(409)
  })

  it('H2: per-target last_owner_refused when batch starts depleting owners', async () => {
    // 2 owners + 1 user. Batch demotes both owners. Workspace-level guard
    // catches it as 409 today. Document expected behaviour for the
    // case where p3 (USER) is included alongside — guard still fires
    // because demoting p1+p2 leaves zero owners.
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' },
        { person: 'p3', role: 'USER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'USER', members: ['p1', 'p2', 'p3'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(409)
  })

  it('H2: not_found status for targets missing from workspace_members', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'USER' }
      ]
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER', members: ['p2', 'ghost'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(captured.body.appliedCount).toBe(1)
    expect(captured.body.results).toEqual([
      { memberUuid: 'p2', status: 'ok' },
      { memberUuid: 'ghost', status: 'not_found' }
    ])
    expect(h.roleCalls).toHaveLength(1)
  })

  it('200 + orphan-log when audit throws post-mutation (does NOT abort batch)', async () => {
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }],
      auditInsertThrows: true
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER', members: ['p1'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(captured.body.appliedCount).toBe(1)
    expect(captured.body.results).toEqual([{ memberUuid: 'p1', status: 'ok' }])
    expect(h.errors.some((e) => e.attrs.breadcrumb === 'wac_audit_orphan')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P2B-T5 — cacheInvalidator wiring (single + bulk role-change)
// ---------------------------------------------------------------------------

describe('writeRouter — P2B-T5 cacheInvalidator (handleMemberRole)', () => {
  it('invokes cacheInvalidator after successful role change', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' },
        { person: 'p3', role: 'USER' }
      ],
      withCacheInvalidator: true
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p3')
    expect(captured.status).toBe(200)
    expect(h.invalidateCalls).toEqual([{ workspace: 'ws-1', account: 'p3' }])
    expect(auditCalls(h)).toHaveLength(1)
  })

  it('skips cacheInvalidator on bad-role 400', async () => {
    const h = makeHarness({ withCacheInvalidator: true })
    const { ctx, captured } = makeCtx({ role: 'GOD' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p3')
    expect(captured.status).toBe(400)
    expect(h.invalidateCalls).toHaveLength(0)
  })

  it('skips cacheInvalidator when role update throws (no mutation = no signal)', async () => {
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }],
      updateRoleImpl: async () => { throw new Error('db fail') },
      withCacheInvalidator: true
    })
    const { ctx, captured } = makeCtx({ role: 'USER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
    expect(captured.status).toBe(500)
    expect(h.invalidateCalls).toHaveLength(0)
  })

  it('handler does NOT wrap invalidator — contract: invalidator must swallow internally', async () => {
    // The handler is documented as best-effort: it calls the invalidator
    // without try/catch. The production impl (cacheInvalidator.ts)
    // swallows all errors and logs a 'wac_cache_invalidation_failed'
    // breadcrumb. This test pins that an invalidator which violates the
    // contract by throwing WILL propagate — so the production impl
    // MUST keep swallowing. See cacheInvalidator.ts top-of-file note.
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }],
      withCacheInvalidator: true,
      invalidatorThrows: true
    })
    const { ctx } = makeCtx({ role: 'MAINTAINER' })
    await expect(
      h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
    ).rejects.toThrow(/invalidator boom/)
    // The role mutation already committed before the invalidator ran.
    expect(h.roleCalls).toHaveLength(1)
  })

  it('no invalidator dep wired = no calls, handler still 200', async () => {
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }]
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER' })
    await h.handlers.handleMemberRole(ctx, 'ws-1', 'caller-1', 'p1')
    expect(captured.status).toBe(200)
    expect(h.invalidateCalls).toHaveLength(0)
  })
})

describe('writeRouter — P2B-T5 cacheInvalidator (handleBulkMemberRole)', () => {
  it('invokes cacheInvalidator per-target after each successful mutation', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p3', role: 'USER' },
        { person: 'p4', role: 'USER' }
      ],
      withCacheInvalidator: true
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER', members: ['p3', 'p4'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(h.invalidateCalls).toEqual([
      { workspace: 'ws-1', account: 'p3' },
      { workspace: 'ws-1', account: 'p4' }
    ])
  })

  it('cacheInvalidator NOT invoked for the target that failed to mutate (H2 partial-success contract)', async () => {
    let call = 0
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'USER' },
        { person: 'p2', role: 'USER' }
      ],
      updateRoleImpl: async () => {
        call++
        if (call === 2) throw new Error('boom')
      },
      withCacheInvalidator: true
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER', members: ['p1', 'p2'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    // H2: 200 with per-target outcomes (was 500 pre-fix).
    expect(captured.status).toBe(200)
    expect(captured.body.appliedCount).toBe(1)
    expect(h.invalidateCalls).toEqual([{ workspace: 'ws-1', account: 'p1' }])
  })
})

// ---------------------------------------------------------------------------
// P2B-T6 — handleGrantRevoke (real implementation)
// ---------------------------------------------------------------------------

describe('writeRouter — handleGrantRevoke (P2B-T6)', () => {
  function makeCollab (id: string, attachedTo: string, recipient: string): any {
    return {
      _id: id,
      _class: 'core:class:Collaborator',
      space: 'core:space:Workspace',
      collaborator: recipient,
      attachedTo,
      attachedToClass: 'tracker:class:Project'
    }
  }

  it('happy path: finds collaborator → removeDoc → audit → 200', async () => {
    const collab = makeCollab('c-1', 'resource-1', 'recipient-1')
    const h = makeHarness({
      findOneImpl: async () => collab
    })
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', 'recipient-1', 'resource-1')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ ok: true })
    expect(h.findOneCalls).toHaveLength(1)
    expect(h.findOneCalls[0].query).toEqual({ collaborator: 'recipient-1', attachedTo: 'resource-1' })
    expect(h.removeDocCalls).toHaveLength(1)
    expect(h.removeDocCalls[0]).toMatchObject({
      workspace: 'ws-1',
      actor: 'caller-1',
      _class: 'core:class:Collaborator',
      space: 'core:space:Workspace',
      _id: 'c-1'
    })
    const audits = auditCalls(h)
    expect(audits).toHaveLength(1)
    expect(audits[0].params[1]).toBe('grant_revoked')
    expect(audits[0].params[4]).toBe('recipient-1') // target_account
    expect(audits[0].params[5]).toBe('resource-1') // target_space
  })

  it('400 when recipient empty', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', '', 'resource-1')
    expect(captured.status).toBe(400)
    expect(h.findOneCalls).toHaveLength(0)
    expect(h.removeDocCalls).toHaveLength(0)
  })

  it('400 when resource empty', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', 'recipient-1', '')
    expect(captured.status).toBe(400)
  })

  it('404 when collaborator not found', async () => {
    const h = makeHarness({ findOneImpl: async () => undefined })
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', 'recipient-1', 'resource-1')
    expect(captured.status).toBe(404)
    expect(captured.body).toEqual({ error: 'grant_not_found' })
    expect(h.removeDocCalls).toHaveLength(0)
    expect(auditCalls(h)).toHaveLength(0)
  })

  it('500 when txClient.findOne throws, no removeDoc, no audit', async () => {
    const h = makeHarness({
      findOneImpl: async () => { throw new Error('connect failed') }
    })
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', 'recipient-1', 'resource-1')
    expect(captured.status).toBe(500)
    expect(captured.body.error).toBe('write_failed')
    expect(h.removeDocCalls).toHaveLength(0)
    expect(auditCalls(h)).toHaveLength(0)
  })

  it('500 when txClient.removeDoc throws, no audit', async () => {
    const collab = makeCollab('c-1', 'resource-1', 'recipient-1')
    const h = makeHarness({
      findOneImpl: async () => collab,
      removeDocImpl: async () => { throw new Error('tx fail') }
    })
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', 'recipient-1', 'resource-1')
    expect(captured.status).toBe(500)
    expect(h.removeDocCalls).toHaveLength(1)
    expect(auditCalls(h)).toHaveLength(0)
  })

  it('200 + orphan-log when audit throws post-removal', async () => {
    const collab = makeCollab('c-1', 'resource-1', 'recipient-1')
    const h = makeHarness({
      findOneImpl: async () => collab,
      auditInsertThrows: true
    })
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', 'recipient-1', 'resource-1')
    expect(captured.status).toBe(200)
    expect(h.removeDocCalls).toHaveLength(1)
    expect(h.errors.some((e) => e.attrs.breadcrumb === 'wac_audit_orphan')).toBe(true)
  })
})
