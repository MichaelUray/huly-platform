//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

import { generateToken } from '@hcengineering/server-token'
import { systemAccountUuid, readOnlyGuestAccountUuid } from '@hcengineering/core'
import { authenticateWac, type WacAuthDeps } from '../wac/auth'

const GUEST_ACCOUNT = 'b6996120-416f-49cd-841e-e4a5d2e49c9b'

// Phase 1 Task 1 — authenticateWac helper.
//
// Covers the 11 scenarios laid out in the task brief:
//
//   1. No Authorization header and no cookie  -> 401 missing_token
//   2. Authorization "Bearer garbage"         -> 401 invalid_token
//   3. Token-version mismatch                 -> 401 invalid_token (detail=token_version)
//   4. resolveWorkspaceUuid -> null           -> 404 workspace_not_found
//   5. Caller not in workspace_members        -> 403 no_workspace_membership
//   6. required=edit, role=MAINTAINER         -> 403 insufficient_role
//   7. required=read, role=MAINTAINER         -> success
//   8. required=read, role=USER               -> 403 insufficient_role
//   9. required=read-self, role=USER          -> success
//  10. required=read-self, role=GUEST         -> 403 insufficient_role
//  11. required=admin,  role=OWNER            -> success

// v4-shaped UUIDs (required by the token generator's uuid.validate check).
const CALLER = '11111111-1111-4111-8111-111111111111'
const WORKSPACE = '22222222-2222-4222-8222-222222222222'

interface MockCtx {
  req: { headers: Record<string, string | undefined> }
  res: {
    statusCode: number | null
    headersSent: boolean
    body: any
    writeHead: (status: number, headers?: Record<string, string>) => void
    end: (body?: string) => void
  }
  cookies?: { get: (name: string) => string | undefined }
}

function makeCtx (opts: { authHeader?: string, cookieHeader?: string, cookieGet?: (name: string) => string | undefined } = {}): MockCtx {
  const headers: Record<string, string | undefined> = {}
  if (opts.authHeader !== undefined) headers.authorization = opts.authHeader
  if (opts.cookieHeader !== undefined) headers.cookie = opts.cookieHeader

  const res: MockCtx['res'] = {
    statusCode: null,
    headersSent: false,
    body: null,
    writeHead (status: number) {
      this.statusCode = status
      this.headersSent = true
    },
    end (body?: string) {
      try {
        this.body = body != null ? JSON.parse(body) : null
      } catch {
        this.body = body
      }
    }
  }

  return {
    req: { headers },
    res,
    cookies: opts.cookieGet != null ? { get: opts.cookieGet } : undefined
  }
}

interface AccountRow {
  uuid: string
  tokenVersion?: number
  disabledAt?: number | null
}

function makeDeps (opts: {
  workspaceUuid?: string | null
  workspaceResolveThrows?: boolean
  account?: AccountRow | null
  workspaceRole?: string | null
  roleLookupThrows?: boolean
  // A3 — Impersonation test hooks.
  isInstanceAdmin?: (accountUuid: string) => boolean | Promise<boolean>
  isInstanceAdminThrows?: boolean
}): WacAuthDeps {
  const warn = jest.fn()
  const error = jest.fn()

  const db: any = {
    account: {
      findOne: async (q: any) => {
        if (opts.account === undefined) {
          // Default: a fresh account row with tokenVersion=0, not disabled.
          return { uuid: q.uuid, tokenVersion: 0, disabledAt: null }
        }
        return opts.account
      }
    },
    getWorkspaceRole: async (_acc: string, _ws: string) => {
      if (opts.roleLookupThrows === true) throw new Error('db down')
      return opts.workspaceRole ?? null
    },
    isInstanceAdmin: async (accountUuid: string) => {
      if (opts.isInstanceAdminThrows === true) throw new Error('isInstanceAdmin db down')
      if (opts.isInstanceAdmin != null) return await opts.isInstanceAdmin(accountUuid)
      // Default: nobody is an admin unless the test opts in.
      return false
    }
  }

  return {
    measureCtx: { warn, error },
    accountDb: async () => db,
    resolveWorkspaceUuid: async (_param: string) => {
      if (opts.workspaceResolveThrows === true) throw new Error('pg failure')
      return opts.workspaceUuid !== undefined ? opts.workspaceUuid : WORKSPACE
    }
  }
}

function bearer (token: string): string {
  return `Bearer ${token}`
}

describe('authenticateWac', () => {
  it('1. no Authorization header and no cookie -> 401 missing_token', async () => {
    const ctx = makeCtx()
    const deps = makeDeps({})
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(401)
    expect(ctx.res.body).toEqual({ error: 'missing_token' })
  })

  it('2. Authorization "Bearer garbage" -> 401 invalid_token', async () => {
    const ctx = makeCtx({ authHeader: 'Bearer not-a-jwt-at-all' })
    const deps = makeDeps({})
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(401)
    expect(ctx.res.body).toEqual({ error: 'invalid_token' })
  })

  it('3. token-version mismatch -> 401 invalid_token (detail=token_version)', async () => {
    // Token claims token_version=0 (omitted). Account row has tokenVersion=5.
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({
      account: { uuid: CALLER, tokenVersion: 5, disabledAt: null }
    })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(401)
    expect(ctx.res.body).toEqual({ error: 'invalid_token', detail: 'token_version' })
  })

  it('4. resolveWorkspaceUuid -> null -> 404 workspace_not_found', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceUuid: null })
    const res = await authenticateWac(ctx as any, 'no-such-ws', 'read', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(404)
    expect(ctx.res.body).toEqual({ error: 'workspace_not_found', workspace: 'no-such-ws' })
  })

  it('5. caller not in workspace_members -> 403 no_workspace_membership', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: null }) // explicit: no membership row
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({ error: 'no_workspace_membership' })
  })

  it('6. required=edit, role=MAINTAINER -> 403 insufficient_role', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'MAINTAINER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({ error: 'insufficient_role', role: 'MAINTAINER', required: 'edit' })
  })

  it('7. required=read, role=MAINTAINER -> success', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'MAINTAINER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res).toEqual({ callerUuid: CALLER, workspaceUuid: WORKSPACE, role: 'MAINTAINER' })
    expect(ctx.res.statusCode).toBeNull() // no response written on success
  })

  it('8. required=read, role=USER -> 403 insufficient_role', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'USER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({ error: 'insufficient_role', role: 'USER', required: 'read' })
  })

  it('9. required=read-self, role=USER -> success', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'USER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toEqual({ callerUuid: CALLER, workspaceUuid: WORKSPACE, role: 'USER' })
    expect(ctx.res.statusCode).toBeNull()
  })

  it('10. required=read-self, role=GUEST -> 403 insufficient_role', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'GUEST' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({ error: 'insufficient_role', role: 'GUEST', required: 'read-self' })
  })

  it('11. required=admin, role=OWNER -> success', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'OWNER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'admin', deps)
    expect(res).toEqual({ callerUuid: CALLER, workspaceUuid: WORKSPACE, role: 'OWNER' })
    expect(ctx.res.statusCode).toBeNull()
  })

  // --- supplementary: cookie fallback + case-insensitive bearer prefix ----

  it('falls back to AUTH_TOKEN_COOKIE when no Authorization header is set (ctx.cookies)', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({
      cookieGet: (name) => (name === 'account-metadata-Token' ? token : undefined)
    })
    const deps = makeDeps({ workspaceRole: 'OWNER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res?.role).toBe('OWNER')
  })

  it('falls back to AUTH_TOKEN_COOKIE via raw cookie header when ctx.cookies is absent', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ cookieHeader: `account-metadata-Token=${token}; other=foo` })
    const deps = makeDeps({ workspaceRole: 'OWNER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res?.role).toBe('OWNER')
  })

  it('accepts case-insensitive bearer prefix', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: `bEaReR ${token}` })
    const deps = makeDeps({ workspaceRole: 'OWNER' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res?.role).toBe('OWNER')
  })

  it('treats an unknown role string as GUEST and denies', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'TotallyMadeUpRole' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({ error: 'insufficient_role', role: 'GUEST', required: 'read-self' })
  })

  // T3 — Guest sub-roles
  //
  // The three guest variants (GUEST / READONLY_GUEST / DOC_GUEST) all
  // share the same capability bucket for v1 — none can access read-self,
  // but the role is reported back distinctly so the UI can label rows
  // correctly. The mapper accepts both wire-form (READONLY_GUEST) and
  // core-enum form (READONLYGUEST, DocGuest) so it's tolerant to both
  // upstream sources.

  it('maps READONLYGUEST (core form) to READONLY_GUEST and denies read-self', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'READONLYGUEST' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({
      error: 'insufficient_role',
      role: 'READONLY_GUEST',
      required: 'read-self'
    })
  })

  it('maps READONLY_GUEST (wire form) to READONLY_GUEST and denies read-self', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'READONLY_GUEST' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toBeNull()
    expect(ctx.res.body).toEqual({
      error: 'insufficient_role',
      role: 'READONLY_GUEST',
      required: 'read-self'
    })
  })

  it('maps DocGuest (core form) to DOC_GUEST and denies read-self', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'DocGuest' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toBeNull()
    expect(ctx.res.body).toEqual({
      error: 'insufficient_role',
      role: 'DOC_GUEST',
      required: 'read-self'
    })
  })

  it('maps DOC_GUEST (wire form) to DOC_GUEST and denies read-self', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'DOC_GUEST' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toBeNull()
    expect(ctx.res.body).toEqual({
      error: 'insufficient_role',
      role: 'DOC_GUEST',
      required: 'read-self'
    })
  })

  // M4 — token-version skip-list for special service accounts.
  //
  // Mirrors `verifyTokenVersion` (server/account/src/utils.ts:209-214):
  // systemAccountUuid, GUEST_ACCOUNT and readOnlyGuestAccountUuid bypass
  // the version check. We assert that no `account.findOne` lookup is
  // issued for these UUIDs — keeping the auth surface aligned with the
  // canonical helper and avoiding a useless DB round-trip.

  it('M4: systemAccountUuid bypasses token-version DB lookup', async () => {
    const token = generateToken(systemAccountUuid as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'OWNER' })
    // Wrap the deps to assert no findOne happens.
    const findOneSpy = jest.fn()
    const origAccountDb = deps.accountDb
    deps.accountDb = async () => {
      const db = (await origAccountDb()) as any
      const orig = db.account.findOne
      db.account.findOne = async (q: any) => {
        findOneSpy(q)
        return await orig(q)
      }
      return db
    }
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(res?.role).toBe('OWNER')
    expect(findOneSpy).not.toHaveBeenCalled()
  })

  it('M4: GUEST_ACCOUNT bypasses token-version DB lookup', async () => {
    const token = generateToken(GUEST_ACCOUNT as any, WORKSPACE as any, { guest: 'true' })
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'GUEST' })
    const findOneSpy = jest.fn()
    const origAccountDb = deps.accountDb
    deps.accountDb = async () => {
      const db = (await origAccountDb()) as any
      const orig = db.account.findOne
      db.account.findOne = async (q: any) => {
        findOneSpy(q)
        return await orig(q)
      }
      return db
    }
    // GUEST still hits insufficient_role for 'read', but the auth machine
    // must walk past step 3 without touching the DB.
    await authenticateWac(ctx as any, WORKSPACE, 'read', deps)
    expect(findOneSpy).not.toHaveBeenCalled()
  })

  it('M4: readOnlyGuestAccountUuid bypasses token-version DB lookup', async () => {
    const token = generateToken(readOnlyGuestAccountUuid as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'READONLYGUEST' })
    const findOneSpy = jest.fn()
    const origAccountDb = deps.accountDb
    deps.accountDb = async () => {
      const db = (await origAccountDb()) as any
      const orig = db.account.findOne
      db.account.findOne = async (q: any) => {
        findOneSpy(q)
        return await orig(q)
      }
      return db
    }
    await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(findOneSpy).not.toHaveBeenCalled()
  })

  it('keeps GUEST (plain) denying read-self with role=GUEST in the response', async () => {
    const token = generateToken(CALLER as any, WORKSPACE as any, undefined)
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ workspaceRole: 'GUEST' })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res).toBeNull()
    expect(ctx.res.body).toEqual({
      error: 'insufficient_role',
      role: 'GUEST',
      required: 'read-self'
    })
  })

  // ----------------------------------------------------------------------
  // A3 — WAC impersonation flow.
  //
  // Instance-admin impersonation tokens carry `extra.impersonation='true'`
  // and `extra.actor_admin=<adminUuid>`. The admin has no workspace_members
  // row in the target workspace, so the regular role lookup would 403
  // `no_workspace_membership`. The early-branch returns role='OWNER' for
  // valid impersonation tokens (admin still in ADMIN_EMAILS allow-list).

  const impersonationExtra = (admin: string, expSec: number): Record<string, string> => ({
    impersonation: 'true',
    impersonation_ref: 'ref-1',
    actor_admin: admin,
    jti: 'jti-1',
    admin: 'true'
  })

  it('A3: valid impersonation token → success, role=OWNER, impersonation=true', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1800
    const token = generateToken(
      CALLER as any,
      WORKSPACE as any,
      impersonationExtra(CALLER, exp),
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({
      workspaceRole: null, // admin is NOT a workspace member — branch must skip the lookup
      isInstanceAdmin: () => true
    })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toEqual({
      callerUuid: CALLER,
      workspaceUuid: WORKSPACE,
      role: 'OWNER',
      impersonation: true,
      actorAdmin: CALLER
    })
    expect(ctx.res.statusCode).toBeNull()
  })

  it('A3: revoked admin (isInstanceAdmin=false) → 403 revoked_admin_impersonation', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1800
    const token = generateToken(
      CALLER as any,
      WORKSPACE as any,
      impersonationExtra(CALLER, exp),
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ isInstanceAdmin: () => false })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({ error: 'revoked_admin_impersonation' })
  })

  it('A3: wrong workspace claim → 401 invalid_impersonation_token', async () => {
    const OTHER_WS = '44444444-4444-4444-8444-444444444444'
    const exp = Math.floor(Date.now() / 1000) + 1800
    // Token issued for OTHER_WS but request targets WORKSPACE.
    const token = generateToken(
      CALLER as any,
      OTHER_WS as any,
      impersonationExtra(CALLER, exp),
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ isInstanceAdmin: () => true })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(401)
    expect(ctx.res.body).toEqual({ error: 'invalid_impersonation_token' })
  })

  it('A3: missing actor_admin claim → 401 invalid_impersonation_token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1800
    const token = generateToken(
      CALLER as any,
      WORKSPACE as any,
      {
        impersonation: 'true',
        // actor_admin intentionally omitted
        jti: 'jti-1',
        admin: 'true'
      } as any,
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ isInstanceAdmin: () => true })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(401)
    expect(ctx.res.body).toEqual({ error: 'invalid_impersonation_token' })
  })

  it('A3: actor_admin mismatched against JWT subject → 401 invalid_impersonation_token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1800
    const OTHER_ADMIN = '55555555-5555-4555-8555-555555555555'
    const token = generateToken(
      CALLER as any,
      WORKSPACE as any,
      impersonationExtra(OTHER_ADMIN, exp),
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ isInstanceAdmin: () => true })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(401)
    expect(ctx.res.body).toEqual({ error: 'invalid_impersonation_token' })
  })

  it('A3: stale token_version → 401 invalid_token (caught by step 3 before impersonation branch)', async () => {
    // Token carries token_version=0 (omitted); account row has tokenVersion=5.
    // The pre-existing token-version gate at step 3 fires before the
    // impersonation branch runs.
    const exp = Math.floor(Date.now() / 1000) + 1800
    const token = generateToken(
      CALLER as any,
      WORKSPACE as any,
      impersonationExtra(CALLER, exp),
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({
      account: { uuid: CALLER, tokenVersion: 5, disabledAt: null },
      isInstanceAdmin: () => true
    })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(401)
    expect(ctx.res.body).toEqual({ error: 'invalid_token', detail: 'token_version' })
  })

  it('A3: isInstanceAdmin db error → 403 revoked_admin_impersonation (fail closed)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1800
    const token = generateToken(
      CALLER as any,
      WORKSPACE as any,
      impersonationExtra(CALLER, exp),
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ isInstanceAdminThrows: true })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'edit', deps)
    expect(res).toBeNull()
    expect(ctx.res.statusCode).toBe(403)
    expect(ctx.res.body).toEqual({ error: 'revoked_admin_impersonation' })
  })

  it('A3: impersonation with role=read-self also passes (OWNER → all caps)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 1800
    const token = generateToken(
      CALLER as any,
      WORKSPACE as any,
      impersonationExtra(CALLER, exp),
      undefined,
      { exp }
    )
    const ctx = makeCtx({ authHeader: bearer(token) })
    const deps = makeDeps({ isInstanceAdmin: () => true })
    const res = await authenticateWac(ctx as any, WORKSPACE, 'read-self', deps)
    expect(res?.role).toBe('OWNER')
    expect(res?.impersonation).toBe(true)
  })
})
