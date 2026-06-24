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
import {
  systemAccountUuid,
  readOnlyGuestAccountUuid,
  type AccountUuid,
  type MeasureContext,
  type WorkspaceUuid
} from '@hcengineering/core'
import { decodeTokenVerbose } from '@hcengineering/server-token'

// M4 — canonical token-version skip-list. Mirrors the upstream
// `verifyTokenVersion` helper at server/account/src/utils.ts:209-214.
// The three special accounts are issued by service code, never have
// a `disabledAt` and never bump tokenVersion, so the check would
// always pass — but we still want to short-circuit the DB round-trip
// AND make sure that an operator who manually tampers with their
// account row can't accidentally lock the service principals out.
//
// `GUEST_ACCOUNT` is declared in `@hcengineering/account/utils` (not
// in `@hcengineering/core`'s component.ts). We inline the literal to
// avoid pulling `@hcengineering/account` into this file just for one
// constant — it has been stable since the Guest invite-link feature
// shipped (see server/account/src/utils.ts:75).
const GUEST_ACCOUNT_UUID = 'b6996120-416f-49cd-841e-e4a5d2e49c9b'

// Cookie name carrying the bearer token when the Authorization header is
// not present. Kept in sync with the constant declared in src/index.ts.
export const AUTH_TOKEN_COOKIE = 'account-metadata-Token'

/**
 * Workspace-level roles surfaced over the WAC wire.
 *
 * Mirrors core's `AccountRole` enum (foundations/core/.../classes.ts:604)
 * but normalized to the WAC wire shape:
 *   GUEST           = core `Guest`         ('GUEST')
 *   READONLY_GUEST  = core `ReadOnlyGuest` ('READONLYGUEST')
 *   DOC_GUEST       = core `DocGuest`      ('DocGuest')
 *
 * All three guest variants collapse to the same capability bucket for v1
 * — they share the "no read/edit, my-access only" surface. Finer-grained
 * per-variant gating is tracked as a v2 follow-up.
 */
export type WacRole =
  | 'OWNER'
  | 'MAINTAINER'
  | 'USER'
  | 'GUEST'
  | 'READONLY_GUEST'
  | 'DOC_GUEST'

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

/**
 * Map a raw DB role-string to its `WacRole`. Handles both wire-form
 * (`READONLY_GUEST`, `DOC_GUEST`) and core-enum form (`READONLYGUEST`,
 * `DocGuest`) so the helper is tolerant to both upstream sources without
 * collapsing the guest variants into a single bucket.
 *
 * M6 — fail-closed default.
 *
 * Unknown role strings collapse to `'GUEST'` — the most restrictive
 * bucket (`!isGuestVariant` is the gate for `read-self`, so a GUEST is
 * locked out of everything except their own self-view).
 *
 * This is intentional: if upstream adds a new `AccountRole` enum value
 * that WAC's wire-form list doesn't yet know about, the safe behaviour
 * is to deny access until WAC is taught to handle it. The alternative
 * (defaulting to USER or MAINTAINER) would silently grant whatever
 * surface the new role corresponds to.
 *
 * **When adding a new role here:** also add it to the `WacWireRole`
 * union in `server-plugins/workspace-access/src/http/readRouter.ts`,
 * the `ALLOWED_ROLES` set in `writeRouter.ts`, and the dropdown options
 * in `plugins/workspace-access-resources/src/components/people/PersonDrawer.svelte`.
 * See README "i18n status" for the matching IntlString registration.
 */
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
    case 'GUEST':
      return 'GUEST'
    // Wire form + core-enum form (READONLYGUEST without the underscore).
    case 'READONLY_GUEST':
    case 'READONLYGUEST':
      return 'READONLY_GUEST'
    case 'DOC_GUEST':
    case 'DOCGUEST':
      return 'DOC_GUEST'
    // Anything else (unknown) collapses to GUEST.
    default:
      return 'GUEST'
  }
}

/**
 * Predicate: is the role one of the three Guest variants? For v1 all
 * three share the same capability bucket — no read/edit, my-access only.
 */
function isGuestVariant (role: WacRole): boolean {
  return role === 'GUEST' || role === 'READONLY_GUEST' || role === 'DOC_GUEST'
}

function capabilityAllows (role: WacRole, required: WacRequiredCapability): boolean {
  switch (required) {
    case 'admin':
    case 'edit':
      return role === 'OWNER'
    case 'read':
      return role === 'OWNER' || role === 'MAINTAINER'
    case 'read-self':
      // Any workspace member, including USER. All guest variants denied.
      return !isGuestVariant(role)
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
  // M4 — short-circuit for the three special-account UUIDs that the
  // canonical `verifyTokenVersion` helper skips (systemAccountUuid,
  // GUEST_ACCOUNT, readOnlyGuestAccountUuid). These accounts are
  // issued by service code and never carry a meaningful tokenVersion;
  // running the check against them was a no-op round-trip pre-fix.
  if (
    callerUuid === systemAccountUuid ||
    callerUuid === GUEST_ACCOUNT_UUID ||
    callerUuid === readOnlyGuestAccountUuid
  ) {
    // Skip 3 entirely — go straight to workspace resolution.
  } else {
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
  } // end M4 skip-list else

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
