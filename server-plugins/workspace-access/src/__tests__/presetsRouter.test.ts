//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Tests for the WAC Permission Templates (Presets) router.
//
// Covers:
//   - validateShape: rejects unknown role, non-array addToSpaces, etc.
//   - GET list: returns rows + parses shape jsonb
//   - POST create: happy path, 400 on bad name/shape, 409 on UNIQUE violation
//   - PUT update: partial update, 404 missing, audit old+new snapshot
//   - DELETE delete: 200 + audit, 404 missing
//   - POST apply: snapshot-at-apply (later edits do NOT change applied
//     members), per-target results, role + addToSpaces side-effects,
//     last_owner_refused via the atomic helper, 409 workspace-wide guard.

import { AccountRole } from '@hcengineering/core'

import {
  createWacPresetsHandlers,
  validateShape,
  type WacPresetsHandlers
} from '../http/presetsRouter'
import type {
  KoaWriteCtxLike,
  WacWriteDeps,
  WacTxClientLike,
  WriteAccountDbLike,
  WriteMeasureCtxLike,
  WritePgClientLike
} from '../http/writeRouter'

// ---------------------------------------------------------------------------
// Captured-response helper (mirrors writeRouter.test.ts)
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

// ---------------------------------------------------------------------------
// pg-stub: routes by SQL substring
// ---------------------------------------------------------------------------

interface PgRoute {
  match: RegExp
  /** Either a static rows array, a thunk producing rows, or an Error to throw. */
  respond: any[] | ((params: any[]) => any[] | Promise<any[]>) | Error
}

interface PgCall { query: string, params: any[] }

function makePg (routes: PgRoute[]): { pg: WritePgClientLike, calls: PgCall[] } {
  const calls: PgCall[] = []
  const pg: WritePgClientLike = {
    async execute (query, params = []) {
      calls.push({ query, params })
      for (const r of routes) {
        if (r.match.test(query)) {
          if (r.respond instanceof Error) throw r.respond
          if (typeof r.respond === 'function') return await r.respond(params)
          return r.respond
        }
      }
      return []
    }
  }
  return { pg, calls }
}

interface HarnessOpts {
  pgRoutes?: PgRoute[]
  members?: Array<{ person: string, role?: string | null }>
  atomicRoleUpdateImpl?: (call: { account: string, role: string }) => Promise<boolean>
  updateRoleImpl?: (call: { account: string, role: string }) => Promise<void>
  updateDocImpl?: (call: any) => Promise<void>
  withCacheInvalidator?: boolean
}

interface Harness {
  handlers: WacPresetsHandlers
  pgCalls: PgCall[]
  errors: Array<{ msg: string, attrs: any }>
  warns: Array<{ msg: string, attrs: any }>
  metrics: Array<{ name: string, value: number }>
  roleCalls: Array<{ account: string, role: string, atomic: boolean }>
  txCalls: Array<{ workspace: string, _id: string, update: any }>
  invalidateCalls: Array<{ workspace: string, account: string }>
}

function makeHarness (opts: HarnessOpts = {}): Harness {
  const errors: Array<{ msg: string, attrs: any }> = []
  const warns: Array<{ msg: string, attrs: any }> = []
  const metrics: Array<{ name: string, value: number }> = []
  const roleCalls: Harness['roleCalls'] = []
  const txCalls: Harness['txCalls'] = []
  const invalidateCalls: Harness['invalidateCalls'] = []
  const measureCtx: WriteMeasureCtxLike = {
    warn (msg, attrs) { warns.push({ msg, attrs: attrs ?? {} }) },
    error (msg, attrs) { errors.push({ msg, attrs: attrs ?? {} }) },
    measure (name, value) { metrics.push({ name, value }) }
  }
  const { pg, calls } = makePg(opts.pgRoutes ?? [])
  const accountDb: WriteAccountDbLike = {
    getWorkspaceMembers: async () => opts.members ?? [],
    updateWorkspaceRole: (async (account: any, _ws: any, role: any) => {
      roleCalls.push({ account: String(account), role: String(role), atomic: false })
      if (opts.updateRoleImpl != null) {
        await opts.updateRoleImpl({ account: String(account), role: String(role) })
      }
    }) as any,
    updateWorkspaceRoleIfNotLastOwner: (async (account: any, _ws: any, role: any) => {
      roleCalls.push({ account: String(account), role: String(role), atomic: true })
      if (opts.atomicRoleUpdateImpl != null) {
        return await opts.atomicRoleUpdateImpl({ account: String(account), role: String(role) })
      }
      return true
    }) as any
  }
  const txClient: WacTxClientLike = {
    updateDoc: (async (workspace: any, _actor: any, _class: any, _space: any, _id: any, update: any) => {
      txCalls.push({ workspace: String(workspace), _id: String(_id), update })
      if (opts.updateDocImpl != null) await opts.updateDocImpl({ _id: String(_id), update })
    }) as any,
    findOne: (async () => undefined) as any,
    removeDoc: (async () => {}) as any
  }
  const deps: WacWriteDeps = {
    measureCtx,
    txClient,
    pgClient: async () => pg,
    accountDb: async () => accountDb
  }
  if (opts.withCacheInvalidator === true) {
    deps.cacheInvalidator = {
      invalidateAccountInWorkspace: (async (workspace: any, account: any) => {
        invalidateCalls.push({ workspace: String(workspace), account: String(account) })
      }) as any
    }
  }
  const handlers = createWacPresetsHandlers(deps)
  return {
    handlers,
    pgCalls: calls,
    errors,
    warns,
    metrics,
    roleCalls,
    txCalls,
    invalidateCalls
  }
}

function auditRows (h: Harness): PgCall[] {
  return h.pgCalls.filter((c) => /INSERT INTO workspace_audit_log/i.test(c.query))
}

// ---------------------------------------------------------------------------
// validateShape
// ---------------------------------------------------------------------------

describe('validateShape', () => {
  it('accepts a well-formed Tier-1 shape', () => {
    const r = validateShape({ role: 'USER', addToSpaces: ['s1', 's2'] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.shape).toEqual({ role: 'USER', addToSpaces: ['s1', 's2'] })
    }
  })

  it('accepts empty addToSpaces', () => {
    const r = validateShape({ role: 'MAINTAINER', addToSpaces: [] })
    expect(r.ok).toBe(true)
  })

  it('rejects unknown wire role', () => {
    const r = validateShape({ role: 'GOD', addToSpaces: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('bad_role')
  })

  it('rejects missing addToSpaces', () => {
    const r = validateShape({ role: 'USER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('bad_addToSpaces')
  })

  it('rejects non-string entries in addToSpaces', () => {
    const r = validateShape({ role: 'USER', addToSpaces: ['s1', 123] })
    expect(r.ok).toBe(false)
  })

  it('rejects empty strings in addToSpaces', () => {
    const r = validateShape({ role: 'USER', addToSpaces: [''] })
    expect(r.ok).toBe(false)
  })

  it('rejects null/non-object', () => {
    expect(validateShape(null).ok).toBe(false)
    expect(validateShape('foo').ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// handleList
// ---------------------------------------------------------------------------

describe('presetsRouter — handleList', () => {
  it('returns mapped preset rows', async () => {
    const h = makeHarness({
      pgRoutes: [
        {
          match: /FROM workspace_access_presets/,
          respond: [
            {
              id: 'p-1',
              workspace: 'ws-1',
              name: 'Default User',
              description: 'New hires',
              shape: JSON.stringify({ role: 'USER', addToSpaces: ['sp-1'] }),
              created_by: 'caller-1',
              created_at: '2026-06-21T10:00:00Z',
              updated_at: '2026-06-21T10:00:00Z'
            }
          ]
        }
      ]
    })
    const { ctx, captured } = makeCtx()
    await h.handlers.handleList(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(captured.body.items).toHaveLength(1)
    expect(captured.body.items[0]).toMatchObject({
      id: 'p-1',
      name: 'Default User',
      description: 'New hires',
      shape: { role: 'USER', addToSpaces: ['sp-1'] }
    })
  })
})

// ---------------------------------------------------------------------------
// handleCreate
// ---------------------------------------------------------------------------

describe('presetsRouter — handleCreate', () => {
  const okInsert: PgRoute = {
    match: /INSERT INTO workspace_access_presets/,
    respond: (_params) => [
      {
        id: 'p-new',
        workspace: 'ws-1',
        name: 'Sales',
        description: 'Sales Team',
        shape: JSON.stringify({ role: 'MAINTAINER', addToSpaces: ['sp-1'] }),
        created_by: 'caller-1',
        created_at: '2026-06-21T10:00:00Z',
        updated_at: '2026-06-21T10:00:00Z'
      }
    ]
  }

  it('happy path: 200 + audit row', async () => {
    const h = makeHarness({ pgRoutes: [okInsert] })
    const { ctx, captured } = makeCtx({
      name: 'Sales',
      description: 'Sales Team',
      shape: { role: 'MAINTAINER', addToSpaces: ['sp-1'] }
    })
    await h.handlers.handleCreate(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(200)
    expect(captured.body.item.id).toBe('p-new')
    expect(auditRows(h)).toHaveLength(1)
    expect(auditRows(h)[0].params[1]).toBe('preset_created')
  })

  it('400 when name empty', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ name: '   ', shape: { role: 'USER', addToSpaces: [] } })
    await h.handlers.handleCreate(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(400)
    expect(captured.body.error).toBe('bad_name')
  })

  it('400 when shape invalid', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ name: 'X', shape: { role: 'GOD', addToSpaces: [] } })
    await h.handlers.handleCreate(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(400)
    expect(captured.body.error).toBe('bad_role')
  })

  it('409 when UNIQUE (workspace, name) violation', async () => {
    const h = makeHarness({
      pgRoutes: [
        {
          match: /INSERT INTO workspace_access_presets/,
          respond: new Error('duplicate key value violates unique constraint')
        }
      ]
    })
    const { ctx, captured } = makeCtx({
      name: 'Sales',
      shape: { role: 'USER', addToSpaces: [] }
    })
    await h.handlers.handleCreate(ctx, 'ws-1', 'caller-1')
    expect(captured.status).toBe(409)
    expect(captured.body.error).toBe('name_exists')
  })
})

// ---------------------------------------------------------------------------
// handleUpdate
// ---------------------------------------------------------------------------

describe('presetsRouter — handleUpdate', () => {
  const existingRow = {
    id: 'p-1',
    workspace: 'ws-1',
    name: 'Old',
    description: null,
    shape: JSON.stringify({ role: 'USER', addToSpaces: ['sp-1'] }),
    created_by: 'caller-1',
    created_at: '2026-06-21T10:00:00Z',
    updated_at: '2026-06-21T10:00:00Z'
  }

  it('happy path: partial update merges name only', async () => {
    const h = makeHarness({
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [existingRow] },
        { match: /UPDATE workspace_access_presets/, respond: [{ ...existingRow, name: 'New', updated_at: '2026-06-21T11:00:00Z' }] }
      ]
    })
    const { ctx, captured } = makeCtx({ name: 'New' })
    await h.handlers.handleUpdate(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(200)
    expect(captured.body.item.name).toBe('New')
    const audits = auditRows(h)
    expect(audits).toHaveLength(1)
    expect(audits[0].params[1]).toBe('preset_updated')
  })

  it('404 when preset not found', async () => {
    const h = makeHarness({
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [] }
      ]
    })
    const { ctx, captured } = makeCtx({ name: 'X' })
    await h.handlers.handleUpdate(ctx, 'ws-1', 'caller-1', 'missing')
    expect(captured.status).toBe(404)
  })

  it('400 on bad shape', async () => {
    const h = makeHarness({
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [existingRow] }
      ]
    })
    const { ctx, captured } = makeCtx({ shape: { role: 'GOD', addToSpaces: [] } })
    await h.handlers.handleUpdate(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// handleDelete
// ---------------------------------------------------------------------------

describe('presetsRouter — handleDelete', () => {
  it('happy path: 200 + audit row + old_value snapshot', async () => {
    const removedRow = {
      id: 'p-1',
      workspace: 'ws-1',
      name: 'Old',
      description: null,
      shape: JSON.stringify({ role: 'USER', addToSpaces: [] }),
      created_by: 'caller-1',
      created_at: '2026-06-21T10:00:00Z',
      updated_at: '2026-06-21T10:00:00Z'
    }
    const h = makeHarness({
      pgRoutes: [{ match: /DELETE FROM workspace_access_presets/, respond: [removedRow] }]
    })
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleDelete(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ ok: true })
    const audits = auditRows(h)
    expect(audits).toHaveLength(1)
    expect(audits[0].params[1]).toBe('preset_deleted')
  })

  it('404 when preset not found', async () => {
    const h = makeHarness({
      pgRoutes: [{ match: /DELETE FROM workspace_access_presets/, respond: [] }]
    })
    const { ctx, captured } = makeCtx({})
    await h.handlers.handleDelete(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// handleApply
// ---------------------------------------------------------------------------

describe('presetsRouter — handleApply', () => {
  const snapshotRow = {
    id: 'p-1',
    workspace: 'ws-1',
    name: 'New Hire',
    description: null,
    shape: JSON.stringify({ role: 'USER', addToSpaces: ['sp-a', 'sp-b'] }),
    created_by: 'caller-1',
    created_at: '2026-06-21T10:00:00Z',
    updated_at: '2026-06-21T10:00:00Z'
  }

  it('happy path: 2 targets get role + 2 spaces each, audit carries snapshot', async () => {
    const spaceA = {
      _id: 'sp-a', _class: 'tracker:class:Project', space: 'core:space:Space',
      members: JSON.stringify([])
    }
    const spaceB = {
      _id: 'sp-b', _class: 'document:class:Teamspace', space: 'core:space:Space',
      members: JSON.stringify(['p1']) // p1 already there → idempotent count
    }
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'USER' },
        { person: 'p3', role: 'USER' }
      ],
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [snapshotRow] },
        {
          match: /FROM space WHERE "workspaceId"=\$1 AND "_id"=\$2 LIMIT 1/,
          respond: (params) => {
            if (params[1] === 'sp-a') return [spaceA]
            if (params[1] === 'sp-b') return [spaceB]
            return []
          }
        }
      ],
      withCacheInvalidator: true
    })
    const { ctx, captured } = makeCtx({ memberUuids: ['p2', 'p3'] })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(200)
    expect(captured.body.applied).toBe(2)
    expect(captured.body.results).toEqual([
      { memberUuid: 'p2', status: 'ok', addedToSpaces: 2 },
      { memberUuid: 'p3', status: 'ok', addedToSpaces: 2 }
    ])
    // Snapshot in response body
    expect(captured.body.snapshot.id).toBe('p-1')
    expect(captured.body.snapshot.shape).toEqual({ role: 'USER', addToSpaces: ['sp-a', 'sp-b'] })
    // 2 plain role updates (USER, not OWNER demote)
    expect(h.roleCalls.filter((c) => !c.atomic)).toHaveLength(2)
    expect(h.roleCalls.every((c) => c.role === AccountRole.User)).toBe(true)
    // Each target invalidated
    expect(h.invalidateCalls).toEqual([
      { workspace: 'ws-1', account: 'p2' },
      { workspace: 'ws-1', account: 'p3' }
    ])
    // One aggregated preset_applied audit row
    const audits = auditRows(h)
    expect(audits).toHaveLength(1)
    expect(audits[0].params[1]).toBe('preset_applied')
    // metadata: presetId + presetSnapshot + memberCount + results
    const metadata = JSON.parse(audits[0].params[9])
    expect(metadata.presetId).toBe('p-1')
    expect(metadata.memberCount).toBe(2)
    expect(metadata.presetSnapshot.shape.role).toBe('USER')
    expect(metadata.results).toHaveLength(2)
  })

  it('400 when memberUuids not array', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ memberUuids: 'x' })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(400)
  })

  it('400 when no targets supplied', async () => {
    const h = makeHarness()
    const { ctx, captured } = makeCtx({ memberUuids: [] })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(400)
    expect(captured.body.error).toBe('no_targets')
  })

  it('404 when preset disappeared between client list + apply', async () => {
    const h = makeHarness({
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [] }
      ]
    })
    const { ctx, captured } = makeCtx({ memberUuids: ['p2'] })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(404)
  })

  it('per-target not_found for members missing from workspace_members', async () => {
    const h = makeHarness({
      members: [{ person: 'p1', role: 'OWNER' }],
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [snapshotRow] }
      ]
    })
    const { ctx, captured } = makeCtx({ memberUuids: ['ghost'] })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(200)
    expect(captured.body.applied).toBe(0)
    expect(captured.body.results).toEqual([
      { memberUuid: 'ghost', status: 'not_found', addedToSpaces: 0 }
    ])
  })

  it('409 workspace-wide last_owner when apply would empty the OWNER set', async () => {
    // Single Owner, preset demotes to USER, batch targets that lone Owner.
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'USER' }
      ],
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [snapshotRow] }
      ]
    })
    const { ctx, captured } = makeCtx({ memberUuids: ['p1'] })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(409)
    expect(captured.body.error).toBe('last_owner')
    expect(h.roleCalls).toHaveLength(0)
  })

  it('per-target last_owner_refused when SQL gate refuses an OWNER demote', async () => {
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'OWNER' },
        { person: 'p3', role: 'OWNER' } // untargeted — workspace-level guard passes
      ],
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [snapshotRow] },
        // No spaces lookup needed for failed targets
        { match: /FROM space WHERE "workspaceId"=\$1 AND "_id"=\$2 LIMIT 1/, respond: [] }
      ],
      atomicRoleUpdateImpl: async (call) => call.account !== 'p1' // p1 loses race
    })
    const { ctx, captured } = makeCtx({ memberUuids: ['p1', 'p2'] })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(200)
    expect(captured.body.results).toEqual([
      { memberUuid: 'p1', status: 'last_owner_refused', addedToSpaces: 0 },
      { memberUuid: 'p2', status: 'ok', addedToSpaces: 0 } // sp-a/sp-b not found → 0 adds
    ])
    expect(captured.body.applied).toBe(1)
    // Both went through the atomic helper because both are OWNER demotes
    expect(h.roleCalls.filter((c) => c.atomic)).toHaveLength(2)
  })

  it('snapshot-at-apply: preset row read ONCE, response carries the captured shape', async () => {
    // Verify the snapshot in the response body is the row we returned
    // from the SELECT, not whatever a hypothetical concurrent UPDATE
    // wrote. The handler does not re-read after writes.
    const h = makeHarness({
      members: [
        { person: 'p1', role: 'OWNER' },
        { person: 'p2', role: 'USER' }
      ],
      pgRoutes: [
        { match: /SELECT id, workspace, name, description[\s\S]*FROM workspace_access_presets/, respond: [snapshotRow] },
        { match: /FROM space WHERE "workspaceId"=\$1 AND "_id"=\$2 LIMIT 1/, respond: [] }
      ]
    })
    const { ctx, captured } = makeCtx({ memberUuids: ['p2'] })
    await h.handlers.handleApply(ctx, 'ws-1', 'caller-1', 'p-1')
    expect(captured.status).toBe(200)
    // Only one SELECT against the presets table — no re-read after writes.
    const presetSelects = h.pgCalls.filter((c) =>
      /FROM workspace_access_presets/.test(c.query) && !/INSERT|UPDATE|DELETE/.test(c.query)
    )
    expect(presetSelects).toHaveLength(1)
    // Audit metadata snapshot mirrors the captured shape verbatim
    const audits = auditRows(h)
    const metadata = JSON.parse(audits[0].params[9])
    expect(metadata.presetSnapshot.shape).toEqual({ role: 'USER', addToSpaces: ['sp-a', 'sp-b'] })
  })
})
