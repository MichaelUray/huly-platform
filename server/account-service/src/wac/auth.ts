//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

import type { Context } from 'koa'
import type { AccountDB } from '@hcengineering/account'
import type { AccountUuid, MeasureContext, WorkspaceUuid } from '@hcengineering/core'
import { decodeTokenVerbose } from '@hcengineering/server-token'

// Cookie name carrying the bearer token when the Authorization header is
// not present. Kept in sync with the constant declared in src/index.ts.
export const AUTH_TOKEN_COOKIE = 'account-metadata-Token'

export type WacRole = 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'

export type WacRequiredCapability =
  // any non-guest workspace member (MAINTAINER+OWNER for resource-views;
  // USER for my-access only — see `read-self`).
  | 'read'
  // my-access tab — every workspace member regardless of role.
  | 'read-self'
  // OWNER only.
  | 'edit'
  // OWNER only (impersonation, audit-export).
  | 'admin'

export interface WacAuthContext {
  callerUuid: string
  workspaceUuid: string
  role: WacRole
}

export interface WacAuthDeps {
  measureCtx: Pick<MeasureContext, 'warn' | 'error'>
  resolveWorkspaceUuid: (param: string) => Promise<string | null>
  accountDb: () => Promise<AccountDB>
  /** clock injection point for tests; defaults to Date.now */
  now?: () => number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBearerToken (ctx: Context): string | undefined {
  // Authorization header (case-insensitive "Bearer" prefix).
  const auth = ctx.req?.headers?.authorization
  if (typeof auth === 'string' && auth.length > 0) {
    const m = auth.match(/^\s*bearer\s+(.+)\s*$/i)
    if (m != null && m[1].length > 0) return m[1]
  }
  // Cookie fallback.
  try {
    const cookieVal = ctx.cookies?.get?.(AUTH_TOKEN_COOKIE)
    if (typeof cookieVal === 'string' && cookieVal.length > 0) return cookieVal
  } catch {
    // ctx.cookies is constructed lazily by Koa; the mock may not provide it.
  }
  // Final fallback: parse raw cookie header (covers minimal test mocks
  // that don't set ctx.cookies).
  const rawCookie = ctx.req?.headers?.cookie
  if (typeof rawCookie === 'string' && rawCookie.length > 0) {
    for (const part of rawCookie.split(';')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      const name = part.slice(0, eq).trim()
      if (name === AUTH_TOKEN_COOKIE) {
        const v = part.slice(eq + 1).trim()
        if (v.length > 0) return v
      }
    }
  }
  return undefined
}

function writeJson (ctx: Context, status: number, body: unknown): void {
  // Defensive: don't overwrite a response that's already been written.
  // Routes short-circuit on null return, but this keeps the helper safe to
  // call multiple times within a single request.
  if (ctx.res?.headersSent === true) return
  ctx.res?.writeHead?.(status, { 'Content-Type': 'application/json' })
  ctx.res?.end?.(JSON.stringify(body))
}

function mapRole (raw: string | null | undefined): WacRole {
  if (raw == null) return 'GUEST'
  const u = String(raw).toUpperCase()
  switch (u) {
    case 'OWNER':
      return 'OWNER'
    case 'MAINTAINER':
      return 'MAINTAINER'
    case 'USER':
      return 'USER'
    // Anything else (GUEST/DocGuest/ReadOnlyGuest/unknown) collapses to GUEST.
    default:
      return 'GUEST'
  }
}

function capabilityAllows (role: WacRole, required: WacRequiredCapability): boolean {
  switch (required) {
    case 'admin':
    case 'edit':
      return role === 'OWNER'
    case 'read':
      return role === 'OWNER' || role === 'MAINTAINER'
    case 'read-self':
      // Any workspace member, including USER. GUEST denied.
      return role !== 'GUEST'
  }
}

// ---------------------------------------------------------------------------
// Public helper
// ---------------------------------------------------------------------------

/**
 * Authenticate a WAC request. On success returns the auth context. On
 * failure, writes the appropriate status to ctx and returns null. Routes
 * should treat null as a signal to return immediately without further work.
 *
 * Status codes used:
 *   401 missing_token            — no Authorization header (or no AUTH_TOKEN_COOKIE)
 *   401 invalid_token            — decode failed or token-version mismatch
 *   404 workspace_not_found      — resolveWorkspaceUuid returned null
 *   403 no_workspace_membership  — caller has no role row in workspace_members
 *   403 insufficient_role        — role too low for the required capability
 *
 * Token-version check note: `AccountDB` does not expose a dedicated
 * `verifyTokenVersion` method (that helper lives in `@hcengineering/account`
 * as a standalone util). To keep this file's dependency footprint tight we
 * fetch the account row directly via `db.account.findOne({ uuid })` and
 * compare against the `extra.token_version` claim (string), mirroring the
 * canonical logic in server/account/src/utils.ts:verifyTokenVersion. An
 * accountless row (e.g. service-issued tokens) skips the version check, as
 * upstream does.
 */
export async function authenticateWac (
  ctx: Context,
  workspaceParam: string,
  required: WacRequiredCapability,
  deps: WacAuthDeps
): Promise<WacAuthContext | null> {
  const { measureCtx, resolveWorkspaceUuid, accountDb } = deps

  // 1. Extract bearer token.
  const token = extractBearerToken(ctx)
  if (token === undefined || token === '') {
    measureCtx.warn('wac auth denied', { reason: 'missing_token', workspace: workspaceParam })
    writeJson(ctx, 401, { error: 'missing_token' })
    return null
  }

  // 2. Decode + verify signature.
  let decoded
  try {
    decoded = decodeTokenVerbose(measureCtx as MeasureContext, token)
  } catch (err) {
    measureCtx.warn('wac auth denied', {
      reason: 'invalid_token',
      detail: 'decode_failed',
      workspace: workspaceParam,
      err: String(err)
    })
    writeJson(ctx, 401, { error: 'invalid_token' })
    return null
  }

  const callerUuid = decoded.account as string
  const extra = (decoded.extra ?? {}) as Record<string, any>

  // 3. Verify token-version against account row.
  try {
    const db = await accountDb()
    const tokenVersionClaim = parseInt(String(extra.token_version ?? '0'), 10)
    const account = await db.account.findOne({ uuid: callerUuid as AccountUuid })
    // Account row may be missing for service-issued tokens — match upstream
    // verifyTokenVersion behaviour and only enforce when a row exists.
    if (account != null) {
      const currentVersion = (account as any).tokenVersion ?? 0
      if (currentVersion > tokenVersionClaim) {
        measureCtx.warn('wac auth denied', {
          reason: 'invalid_token',
          detail: 'token_version',
          callerUuid,
          workspace: workspaceParam
        })
        writeJson(ctx, 401, { error: 'invalid_token', detail: 'token_version' })
        return null
      }
      if ((account as any).disabledAt != null) {
        measureCtx.warn('wac auth denied', {
          reason: 'invalid_token',
          detail: 'account_disabled',
          callerUuid,
          workspace: workspaceParam
        })
        writeJson(ctx, 401, { error: 'invalid_token', detail: 'token_version' })
        return null
      }
    }
  } catch (err) {
    measureCtx.error('wac auth db lookup failed', {
      reason: 'invalid_token',
      detail: 'db_error',
      callerUuid,
      workspace: workspaceParam,
      err: String(err)
    })
    writeJson(ctx, 401, { error: 'invalid_token' })
    return null
  }

  // 4. Resolve workspace UUID.
  let workspaceUuid: string | null
  try {
    workspaceUuid = await resolveWorkspaceUuid(workspaceParam)
  } catch (err) {
    measureCtx.warn('wac auth denied', {
      reason: 'workspace_not_found',
      callerUuid,
      workspace: workspaceParam,
      err: String(err)
    })
    writeJson(ctx, 404, { error: 'workspace_not_found', workspace: workspaceParam })
    return null
  }
  if (workspaceUuid == null) {
    measureCtx.warn('wac auth denied', {
      reason: 'workspace_not_found',
      callerUuid,
      workspace: workspaceParam
    })
    writeJson(ctx, 404, { error: 'workspace_not_found', workspace: workspaceParam })
    return null
  }

  // 5. Membership + role lookup.
  // We use the cheaper single-row `getWorkspaceRole` variant instead of
  // pulling every member row via `getWorkspaceMembers`.
  let dbRoleRaw: string | null = null
  try {
    const db = await accountDb()
    const r = await db.getWorkspaceRole(callerUuid as AccountUuid, workspaceUuid as WorkspaceUuid)
    dbRoleRaw = r ?? null
  } catch (err) {
    measureCtx.error('wac auth role lookup failed', {
      reason: 'no_workspace_membership',
      callerUuid,
      workspace: workspaceParam,
      err: String(err)
    })
    writeJson(ctx, 403, { error: 'no_workspace_membership' })
    return null
  }

  if (dbRoleRaw == null) {
    measureCtx.warn('wac auth denied', {
      reason: 'no_workspace_membership',
      callerUuid,
      workspace: workspaceParam
    })
    writeJson(ctx, 403, { error: 'no_workspace_membership' })
    return null
  }

  const role = mapRole(dbRoleRaw)

  // 6. Capability gate.
  if (!capabilityAllows(role, required)) {
    measureCtx.warn('wac auth denied', {
      reason: 'insufficient_role',
      callerUuid,
      workspace: workspaceParam,
      role,
      required
    })
    writeJson(ctx, 403, { error: 'insufficient_role', role, required })
    return null
  }

  return { callerUuid, workspaceUuid, role }
}
