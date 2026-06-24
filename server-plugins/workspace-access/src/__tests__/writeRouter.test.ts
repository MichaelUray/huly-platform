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
// handleGrantRevoke is the 501 stub (P0-T5); a single test pins that
// behavior until P2B-T6 lands.

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

interface Harness {
  deps: WacWriteDeps
  handlers: WacWriteHandlers
  txCalls: TxCall[]
  pgCalls: PgCall[]
  roleCalls: RoleUpdateCall[]
  errors: Array<{ msg: string, attrs: any }>
  warns: Array<{ msg: string, attrs: any }>
}

interface MakeHarnessOpts {
  spaceRow?: Record<string, any> | null
  members?: Array<{ person: string, role?: string | null }>
  updateDocImpl?: (call: TxCall) => Promise<void>
  auditInsertThrows?: boolean
  pgFindRowOverride?: any[] // explicit response for the SELECT space row
  updateRoleImpl?: (call: RoleUpdateCall) => Promise<void>
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
  const errors: Array<{ msg: string, attrs: any }> = []
  const warns: Array<{ msg: string, attrs: any }> = []

  const measureCtx: WriteMeasureCtxLike = {
    warn (msg, attrs) { warns.push({ msg, attrs: attrs ?? {} }) },
    error (msg, attrs) { errors.push({ msg, attrs: attrs ?? {} }) }
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
    findOne: (async () => undefined) as any
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

  const deps: WacWriteDeps = {
    measureCtx,
    txClient,
    pgClient: async () => pgClient,
    accountDb: async () => accountDb
  }
  const handlers = createWacWriteHandlers(deps)
  return { deps, handlers, txCalls, pgCalls, roleCalls, errors, warns }
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
})

// ---------------------------------------------------------------------------
// handleBulkMemberRole
// ---------------------------------------------------------------------------

describe('writeRouter — handleBulkMemberRole', () => {
  it('happy path: updates each target + per-target audit + 200', async () => {
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
    expect(captured.body.affected).toBe(2)
    expect(typeof captured.body.batch_id).toBe('string')
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

  it('409 last_owner when bulk-demote would empty the OWNER set', async () => {
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

  it('500 when updateWorkspaceRole throws mid-batch, audit only for completed', async () => {
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
    expect(captured.status).toBe(500)
    // Only the first audit was written (the second update threw before).
    expect(auditCalls(h)).toHaveLength(1)
  })

  it('200 + orphan-log when audit throws post-mutation (does NOT abort batch)', async () => {
    const h = makeHarness({
      members: [{ person: 'p1', role: 'USER' }],
      auditInsertThrows: true
    })
    const { ctx, captured } = makeCtx({ role: 'MAINTAINER', members: ['p1'] })
    await h.handlers.handleBulkMemberRole(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(h.errors.some((e) => e.attrs.breadcrumb === 'wac_audit_orphan')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// handleGrantRevoke — 501 stub
// ---------------------------------------------------------------------------

describe('writeRouter — handleGrantRevoke', () => {
  it('returns 501 not_implemented and writes no audit', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleGrantRevoke(ctx, 'ws-1', 'caller-1', 'recipient-1', 'resource-1')
    expect(captured.status).toBe(501)
    expect(captured.body.error).toBe('not_implemented')
    expect(captured.body.detail).toBe('wac_grant_revoke_pending_v2')
    expect(auditCalls(h)).toHaveLength(0)
    expect(h.warns.length).toBeGreaterThanOrEqual(1)
  })
})
