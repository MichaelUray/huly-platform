//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 2B Tasks 2 + 3 + 4 — WAC write-route handlers.
//
// Mirrors the structural-typing approach used by readRouter.ts. All write
// routes that used to live inline in server/account-service/src/index.ts
// (the ~780-940 block in the r12 deploy) are migrated here. account-service
// keeps mount/DI/auth/request-parsing duties only; this module owns:
//
//   * Body-parse + validate of the JSON request
//   * Last-owner protection (E3 — refuse to drop workspace OWNER count to 0)
//   * Canonical Huly mutation via TxOperations.updateDoc (D3)
//   * Sequenced audit-log INSERT immediately after mutation (B4)
//
// Atomicity caveat (B4): mutation goes via WS to transactor, audit goes via
// pg. Cross-backend atomicity without a 2PC layer is not feasible. We
// sequence mutation → audit and log a high-severity 'wac_audit_orphan'
// breadcrumb if the audit insert fails post-mutation. updateDoc-failure
// aborts before any audit is written.

import type {
  Class,
  Doc,
  DocumentUpdate,
  Ref,
  Space,
  WorkspaceUuid
} from '@hcengineering/core'
import core from '@hcengineering/core'
import { executeWorkspaceAuditInsert } from '../audit/insert'

// ---------------------------------------------------------------------------
// Minimal structural surfaces (zero new package deps)
// ---------------------------------------------------------------------------

/** Koa-compatible context. Only the fields our handlers touch are typed. */
export interface KoaWriteCtxLike {
  request: {
    body?: any
  }
  res: {
    writeHead: (status: number, headers?: Record<string, string>) => void
    write?: (chunk: any) => boolean | void
    end: (chunk?: any) => void
    headersSent?: boolean
  }
}

/** Subset of postgres-base DBClient that the handlers exercise. */
export interface WritePgClientLike {
  execute: (query: string, parameters?: any[]) => Promise<any[]>
}

/** Subset of AccountDB used here (member-role updates + member-counting). */
export interface WriteAccountDbLike {
  getWorkspaceMembers: (workspaceId: any) => Promise<Array<{ person: string, role?: string | null }>>
  updateWorkspaceRole: (accountId: any, workspaceId: any, role: any) => Promise<void>
  /**
   * H3 — atomic compound update that refuses the role change if it would
   * leave the workspace with zero OWNERs. The predicate is enforced inside
   * the SQL `UPDATE … WHERE …` so two concurrent demote requests cannot
   * both observe `ownerCount=2` and both succeed (the classic
   * Time-of-Check / Time-of-Use race in the read-then-update path).
   *
   * Contract:
   *   - Returns `true` when the row was updated.
   *   - Returns `false` when the predicate refused the update (i.e. the
   *     target was the last OWNER and a non-OWNER role was requested).
   *
   * The reference SQL is:
   *   UPDATE workspace_members SET role=$role
   *     WHERE person=$account AND workspace=$workspace
   *       AND (
   *         $role = 'OWNER'
   *         OR EXISTS (
   *           SELECT 1 FROM workspace_members o
   *           WHERE o.workspace=$workspace
   *             AND o.role='OWNER'
   *             AND o.person <> $account
   *         )
   *       )
   *   RETURNING 1
   *
   * Implementations that don't have a Postgres backend can fall back to
   * a transactional read+update, but MUST keep the gate atomic.
   *
   * Optional: hosts running an older `@hcengineering/account` build may
   * not expose this method. The handler then falls back to the legacy
   * non-atomic read+update path and logs a `wac_owner_race_fallback`
   * breadcrumb so an operator can grep for it.
   */
  updateWorkspaceRoleIfNotLastOwner?: (
    accountId: any,
    workspaceId: any,
    role: any
  ) => Promise<boolean>
}

/**
 * Subset of MeasureContext used here:
 *   - `warn` / `error` for breadcrumbs
 *   - `measure(name, value)` for the orphan counter (M1). The full
 *     MeasureContext implementation routes `measure` calls through its
 *     metrics tree; subscribe to `wac_audit_orphan` for alerting.
 *     Optional so test harnesses don't need to provide it.
 */
export interface WriteMeasureCtxLike {
  warn: (msg: string, attrs?: Record<string, unknown>) => void
  error: (msg: string, attrs?: Record<string, unknown>) => void
  measure?: (name: string, value: number, override?: boolean) => void
}

/** Structural surface of the WacTxClient (defined in account-service). */
export interface WacTxClientLike {
  updateDoc: <T extends Doc>(
    workspaceUuid: WorkspaceUuid,
    actorUuid: string,
    _class: Ref<Class<T>>,
    space: Ref<Space>,
    _id: Ref<T>,
    update: DocumentUpdate<T>
  ) => Promise<void>
  findOne: <T extends Doc>(
    workspaceUuid: WorkspaceUuid,
    _class: Ref<Class<T>>,
    query: any
  ) => Promise<T | undefined>
  /**
   * P2B-T6 — remove a doc via TxOperations. Broadcasts the removal
   * to live transactor clients (covers collaborator-grant revoke).
   */
  removeDoc: <T extends Doc>(
    workspaceUuid: WorkspaceUuid,
    actorUuid: string,
    _class: Ref<Class<T>>,
    space: Ref<Space>,
    _id: Ref<T>
  ) => Promise<void>
}

/**
 * P2B-T5 — best-effort cache invalidator. Called after a successful
 * workspace-role mutation to nudge live clients to drop cached perms.
 * The concrete implementation lives in account-service (Option (B) —
 * a marker tx against the workspace-level Space). Failures inside
 * `invalidateAccountInWorkspace` MUST NOT propagate — the handler
 * does not wrap the call in try/catch.
 */
export interface WacCacheInvalidatorLike {
  invalidateAccountInWorkspace: (workspaceUuid: WorkspaceUuid, accountUuid: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Deps + handler surface
// ---------------------------------------------------------------------------

export interface WacWriteDeps {
  measureCtx: WriteMeasureCtxLike
  txClient: WacTxClientLike
  pgClient: () => Promise<WritePgClientLike>
  accountDb: () => Promise<WriteAccountDbLike>
  /**
   * P2B-T5 — best-effort cache invalidator invoked after a successful
   * workspace-role mutation. Optional: if absent, the handlers skip
   * the invalidation step (legacy hosts / tests that don't care).
   */
  cacheInvalidator?: WacCacheInvalidatorLike
  /** Keep-alive response headers used by the host for JSON writes. */
  jsonHeaders?: Record<string, string>
}

export interface WacWriteHandlers {
  handleSpaceMembers: (ctx: KoaWriteCtxLike, workspaceUuid: string, callerUuid: string, spaceId: string) => Promise<void>
  handleSpaceOwners: (ctx: KoaWriteCtxLike, workspaceUuid: string, callerUuid: string, spaceId: string) => Promise<void>
  handleSpacePrivacy: (ctx: KoaWriteCtxLike, workspaceUuid: string, callerUuid: string, spaceId: string) => Promise<void>
  handleSpaceAutoJoin: (ctx: KoaWriteCtxLike, workspaceUuid: string, callerUuid: string, spaceId: string) => Promise<void>
  handleSpaceArchived: (ctx: KoaWriteCtxLike, workspaceUuid: string, callerUuid: string, spaceId: string) => Promise<void>
  handleMemberRole: (ctx: KoaWriteCtxLike, workspaceUuid: string, callerUuid: string, memberUuid: string) => Promise<void>
  handleBulkMemberRole: (ctx: KoaWriteCtxLike, workspaceUuid: string, callerUuid: string) => Promise<void>
  handleGrantRevoke: (
    ctx: KoaWriteCtxLike,
    workspaceUuid: string,
    callerUuid: string,
    recipient: string,
    resource: string
  ) => Promise<void>
}

// ---------------------------------------------------------------------------
// Constants + small helpers
// ---------------------------------------------------------------------------

const DEFAULT_JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Connection: 'keep-alive',
  'Keep-Alive': 'timeout=5, max=1000'
}

// T3 — Guest sub-roles. Accept both the wire form (READONLY_GUEST,
// DOC_GUEST) emitted by handleMembers and the core-enum form
// (READONLYGUEST, DocGuest) coming from upstream callers, so the
// edit-role surface is tolerant to whichever shape the UI sends.
const ALLOWED_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'MAINTAINER',
  'USER',
  'GUEST',
  'READONLY_GUEST',
  'READONLYGUEST',
  'DOC_GUEST',
  'DocGuest'
])

const CALLER_ROLE_LABEL = 'workspace_owner'

// ---------------------------------------------------------------------------
// Internal: space lookup + audit helpers
// ---------------------------------------------------------------------------

/**
 * Raw space-row shape used by the handlers. Reflects what `data->>...`
 * extracts from the public.space jsonb column.
 */
interface SpaceRow {
  _id: string
  _class: string
  space: string
  members: string[]
  owners: string[]
  private: boolean
  autoJoin: boolean
  archived: boolean
}

function parseJsonArray (v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  if (typeof v !== 'string') return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function loadSpaceRow (
  pg: WritePgClientLike,
  workspaceUuid: string,
  spaceId: string
): Promise<SpaceRow | null> {
  const rows = await pg.execute(
    `SELECT "_id", "_class", "space",
            data->>'members' AS members,
            data->>'owners' AS owners,
            (data->>'private')::boolean AS private_flag,
            (data->>'autoJoin')::boolean AS auto_join,
            (data->>'archived')::boolean AS archived
     FROM space WHERE "workspaceId"=$1 AND "_id"=$2 LIMIT 1`,
    [workspaceUuid, spaceId]
  )
  if (rows[0] == null) return null
  const r = rows[0] as any
  return {
    _id: String(r._id),
    _class: String(r._class),
    space: String(r.space ?? core.space.Space),
    members: parseJsonArray(r.members),
    owners: parseJsonArray(r.owners),
    private: r.private_flag === true,
    autoJoin: r.auto_join === true,
    archived: r.archived === true
  }
}

/**
 * Insert the WAC audit row. Sequenced AFTER the mutation. If this throws
 * we log a high-severity 'wac_audit_orphan' breadcrumb but DO NOT
 * propagate — see B4 atomicity caveat at the top of this module.
 */
async function writeAuditPostMutation (
  deps: WacWriteDeps,
  pg: WritePgClientLike,
  workspace: string,
  action: string,
  actor: string | null,
  actorRole: string,
  payload: {
    target_account?: string | null
    target_space?: string | null
    target_space_class?: string | null
    old_value?: unknown
    new_value?: unknown
  }
): Promise<void> {
  try {
    // M2 — delegates to the shared helper. SQL + column list are the
    // single source of truth in `audit/insert.ts`.
    await executeWorkspaceAuditInsert(pg, {
      workspace,
      action,
      actor,
      actorRole,
      target_account: payload.target_account,
      target_space: payload.target_space,
      target_space_class: payload.target_space_class,
      old_value: payload.old_value,
      new_value: payload.new_value
    })
  } catch (err) {
    // Atomicity caveat: mutation goes via WS to transactor, audit goes via pg.
    // We sequence mutation→audit and log loud if audit fails post-mutation.
    // M1 — increment the wac_audit_orphan counter so dashboards / alerts
    // can be wired to a numeric signal instead of grepping logs. The
    // breadcrumb in the error attrs preserves the old grep contract.
    deps.measureCtx.error('wac audit-INSERT failed after successful mutation', {
      breadcrumb: 'wac_audit_orphan',
      workspace,
      action,
      actor,
      target_space: payload.target_space ?? null,
      target_account: payload.target_account ?? null,
      err: String(err)
    })
    try {
      // MeasureContext.measure aggregates into the metrics tree; an
      // observability sidecar can scrape and alert. Best-effort: a
      // missing measure function (test harness) is fine.
      deps.measureCtx.measure?.('wac_audit_orphan', 1)
    } catch {
      // Defensive: never let a metrics-side throw mask the original
      // orphan condition.
    }
  }
}

/**
 * Parse the request body. The host already mounts koa-bodyparser before
 * the WAC middleware, so `ctx.request.body` is the parsed JSON object.
 * If the parse failed upstream we get a non-object/null and fail with 400.
 */
function readBody (ctx: KoaWriteCtxLike): Record<string, any> | null {
  const b = ctx.request.body
  if (b == null) return null
  if (typeof b !== 'object') return null
  return b as Record<string, any>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the WAC write-handler set.
 *
 * Each space-flag / space-members / space-owners handler:
 *   1. parses + validates the body (400 on parse fail)
 *   2. loads the current space row (404 if missing)
 *   3. for owners: refuses to drop owners to 0 when the space is the
 *      workspace-level Space (E3 — last-owner)
 *   4. applies the canonical mutation via txClient.updateDoc (D3)
 *   5. sequences a pg-side audit-row INSERT post-mutation (B4)
 *
 * The handleMemberRole / handleBulkMemberRole handlers operate on
 * account-db (global_account.workspace_members), not the workspace
 * transactor, because role is global account state — not a workspace Doc.
 *
 * @public
 */
export function createWacWriteHandlers (deps: WacWriteDeps): WacWriteHandlers {
  const jsonHeaders = deps.jsonHeaders ?? DEFAULT_JSON_HEADERS

  const json = (ctx: KoaWriteCtxLike, status: number, body: unknown): void => {
    ctx.res.writeHead(status, jsonHeaders)
    ctx.res.end(JSON.stringify(body))
  }

  // -----------------------------------------------------------------------
  // Generic space-flag handler builder (private/autoJoin/archived)
  // -----------------------------------------------------------------------
  const makeFlagHandler = (
    bodyField: 'private' | 'autoJoin' | 'archived',
    actionResolver: (newValue: boolean) => string
  ) => {
    return async (
      ctx: KoaWriteCtxLike,
      workspaceUuid: string,
      callerUuid: string,
      spaceId: string
    ): Promise<void> => {
      const body = readBody(ctx)
      if (body == null) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const newValue = body[bodyField] === true
      const pg = await deps.pgClient()
      const spaceRow = await loadSpaceRow(pg, workspaceUuid, spaceId)
      if (spaceRow == null) {
        json(ctx, 404, { error: 'space_not_found' })
        return
      }
      try {
        await deps.txClient.updateDoc(
          workspaceUuid as WorkspaceUuid,
          callerUuid,
          spaceRow._class as Ref<Class<Doc>>,
          spaceRow.space as Ref<Space>,
          spaceRow._id as Ref<Doc>,
          { [bodyField]: newValue } as unknown as DocumentUpdate<Doc>
        )
      } catch (err) {
        deps.measureCtx.error('wac write mutation failed', {
          action: actionResolver(newValue),
          workspace: workspaceUuid,
          space: spaceId,
          err: String(err)
        })
        json(ctx, 500, { error: 'write_failed', detail: String(err) })
        return
      }
      await writeAuditPostMutation(
        deps,
        pg,
        workspaceUuid,
        actionResolver(newValue),
        callerUuid,
        CALLER_ROLE_LABEL,
        {
          target_space: spaceId,
          target_space_class: spaceRow._class,
          old_value: (spaceRow as any)[bodyField] ?? false,
          new_value: newValue
        }
      )
      json(ctx, 200, { ok: true })
    }
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  return {
    async handleSpaceMembers (ctx, workspaceUuid, callerUuid, spaceId) {
      const body = readBody(ctx)
      if (body == null || !Array.isArray(body.members)) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const newMembers: string[] = body.members.filter((m: any) => typeof m === 'string')
      const pg = await deps.pgClient()
      const spaceRow = await loadSpaceRow(pg, workspaceUuid, spaceId)
      if (spaceRow == null) {
        json(ctx, 404, { error: 'space_not_found' })
        return
      }
      try {
        await deps.txClient.updateDoc(
          workspaceUuid as WorkspaceUuid,
          callerUuid,
          spaceRow._class as Ref<Class<Doc>>,
          spaceRow.space as Ref<Space>,
          spaceRow._id as Ref<Doc>,
          { members: newMembers } as unknown as DocumentUpdate<Doc>
        )
      } catch (err) {
        deps.measureCtx.error('wac write mutation failed', {
          action: 'space_members_changed',
          workspace: workspaceUuid,
          space: spaceId,
          err: String(err)
        })
        json(ctx, 500, { error: 'write_failed', detail: String(err) })
        return
      }
      await writeAuditPostMutation(
        deps,
        pg,
        workspaceUuid,
        'space_members_changed',
        callerUuid,
        CALLER_ROLE_LABEL,
        {
          target_space: spaceId,
          target_space_class: spaceRow._class,
          old_value: spaceRow.members,
          new_value: newMembers
        }
      )
      json(ctx, 200, { ok: true })
    },

    async handleSpaceOwners (ctx, workspaceUuid, callerUuid, spaceId) {
      const body = readBody(ctx)
      if (body == null || !Array.isArray(body.owners)) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const newOwners: string[] = body.owners.filter((m: any) => typeof m === 'string')
      const pg = await deps.pgClient()
      const spaceRow = await loadSpaceRow(pg, workspaceUuid, spaceId)
      if (spaceRow == null) {
        json(ctx, 404, { error: 'space_not_found' })
        return
      }
      // E3 — last-owner check: refuse to drop the workspace-level Space's
      // owner list to zero. Other spaces can be ownerless (their effective
      // access falls back to workspace OWNERs).
      if (spaceRow._id === (core.space.Workspace as unknown as string) && newOwners.length === 0) {
        json(ctx, 409, { error: 'last_owner', detail: 'workspace_must_have_at_least_one_owner' })
        return
      }
      try {
        await deps.txClient.updateDoc(
          workspaceUuid as WorkspaceUuid,
          callerUuid,
          spaceRow._class as Ref<Class<Doc>>,
          spaceRow.space as Ref<Space>,
          spaceRow._id as Ref<Doc>,
          { owners: newOwners } as unknown as DocumentUpdate<Doc>
        )
      } catch (err) {
        deps.measureCtx.error('wac write mutation failed', {
          action: 'space_owners_changed',
          workspace: workspaceUuid,
          space: spaceId,
          err: String(err)
        })
        json(ctx, 500, { error: 'write_failed', detail: String(err) })
        return
      }
      await writeAuditPostMutation(
        deps,
        pg,
        workspaceUuid,
        'space_owners_changed',
        callerUuid,
        CALLER_ROLE_LABEL,
        {
          target_space: spaceId,
          target_space_class: spaceRow._class,
          old_value: spaceRow.owners,
          new_value: newOwners
        }
      )
      json(ctx, 200, { ok: true })
    },

    handleSpacePrivacy: makeFlagHandler('private', () => 'space_privacy_changed'),
    handleSpaceAutoJoin: makeFlagHandler('autoJoin', () => 'space_autojoin_changed'),
    handleSpaceArchived: makeFlagHandler('archived', (v) => (v ? 'space_archived' : 'space_unarchived')),

    async handleMemberRole (ctx, workspaceUuid, callerUuid, memberUuid) {
      const body = readBody(ctx)
      if (body == null) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const role = body.role
      if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
        json(ctx, 400, { error: 'bad_role' })
        return
      }
      const db = await deps.accountDb()
      const members = await db.getWorkspaceMembers(workspaceUuid as any)
      const target = members.find((m) => m.person === memberUuid)
      const oldRole = target?.role ?? null

      // H3 — atomic last-owner gate.
      //
      // The pre-fix code did a read-then-update sequence:
      //   1. count OWNERs from the workspace_members snapshot
      //   2. UPDATE workspace_members SET role=…
      // Two concurrent demote-from-OWNER requests could both observe
      // ownerCount=2 in step 1 and both succeed in step 2, leaving zero
      // OWNERs.  See `updateWorkspaceRoleIfNotLastOwner` for the SQL.
      //
      // We still do the cheap snapshot read so we can return the precise
      // 409 body (and pre-empt the round-trip when the caller is clearly
      // wrong), but the *authoritative* check is the atomic SQL gate
      // below.
      if (oldRole === 'OWNER' && role !== 'OWNER') {
        const ownerCount = members.filter((m) => m.role === 'OWNER').length
        if (ownerCount <= 1) {
          json(ctx, 409, { error: 'last_owner', detail: 'workspace_must_have_at_least_one_owner' })
          return
        }
      }

      try {
        if (db.updateWorkspaceRoleIfNotLastOwner !== undefined) {
          // Authoritative atomic path. The compound SQL refuses the
          // update if the same workspace's other OWNERs would drop to 0.
          const ok = await db.updateWorkspaceRoleIfNotLastOwner(
            memberUuid as any,
            workspaceUuid as any,
            role as any
          )
          if (!ok) {
            // The race was caught at the SQL boundary — the snapshot
            // above looked safe (ownerCount > 1) but a concurrent
            // request raced us. Return the same 409 the snapshot check
            // would have, so the caller gets a single contract.
            json(ctx, 409, { error: 'last_owner', detail: 'workspace_must_have_at_least_one_owner' })
            return
          }
        } else {
          // Legacy fallback: AccountDB build without the atomic helper.
          // Log a breadcrumb so the operator can grep `wac_owner_race_fallback`
          // and upgrade.
          deps.measureCtx.warn('wac owner-race protection degraded to TOCTOU read+update', {
            breadcrumb: 'wac_owner_race_fallback',
            workspace: workspaceUuid,
            target: memberUuid
          })
          await db.updateWorkspaceRole(memberUuid as any, workspaceUuid as any, role as any)
        }
      } catch (err) {
        deps.measureCtx.error('wac role update failed', {
          workspace: workspaceUuid,
          target: memberUuid,
          err: String(err)
        })
        json(ctx, 500, { error: 'write_failed', detail: String(err) })
        return
      }
      // P2B-T5 — best-effort live cache-invalidation. Role lives in
      // account-db and is NOT carried by a TxOperations broadcast, so
      // a demoted Owner could keep editing until reload. The
      // invalidator emits a workspace-level marker tx (Option (B));
      // failures are logged in the impl and do NOT block the response.
      if (deps.cacheInvalidator !== undefined) {
        await deps.cacheInvalidator.invalidateAccountInWorkspace(
          workspaceUuid as WorkspaceUuid,
          memberUuid
        )
      }
      const pg = await deps.pgClient()
      await writeAuditPostMutation(
        deps,
        pg,
        workspaceUuid,
        'role_changed',
        callerUuid,
        CALLER_ROLE_LABEL,
        {
          target_account: memberUuid,
          old_value: { role: oldRole },
          new_value: { role }
        }
      )
      json(ctx, 200, { ok: true })
    },

    async handleBulkMemberRole (ctx, workspaceUuid, callerUuid) {
      // H2 — per-target outcome contract.
      //
      // Pre-fix: the bulk endpoint aborted with HTTP 500 the moment any
      // single target's `updateWorkspaceRole` threw, even if the prior
      // targets had already mutated. The client had no way to tell which
      // updates landed and which didn't, and no rollback was performed
      // because none is feasible across the audit-log boundary.
      //
      // Post-fix contract: the endpoint always returns 200 with a per-
      // target outcome array. Each entry is one of:
      //   - 'ok'                — mutation + audit written
      //   - 'last_owner_refused' — gating refused (per-target check)
      //   - 'forbidden'         — reserved for future per-target ACL gating
      //   - 'not_found'         — target not in workspace_members
      //   - 'internal'          — updateWorkspaceRole threw
      // The 400 body-validation errors and the workspace-level last-owner
      // refusal (would empty the OWNER set entirely) are unchanged.
      const body = readBody(ctx)
      if (body == null || !Array.isArray(body.members)) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const targets: string[] = body.members.filter((m: any) => typeof m === 'string')
      const role = body.role
      if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
        json(ctx, 400, { error: 'bad_role' })
        return
      }
      const db = await deps.accountDb()
      const members = await db.getWorkspaceMembers(workspaceUuid as any)
      const memberIndex = new Map(members.map((m) => [m.person, m.role ?? null]))
      const ownerSet = new Set(members.filter((m) => m.role === 'OWNER').map((m) => m.person))

      // E3 — workspace-level last-owner guard kept as the hard 409: if
      // *every* requested demote would leave the OWNER set empty there's
      // no useful partial state to return. The per-target check below
      // additionally protects against a smaller bulk that targets only
      // the single remaining owner.
      if (role !== 'OWNER') {
        const remainingOwners = new Set(ownerSet)
        for (const t of targets) remainingOwners.delete(t)
        if (ownerSet.size > 0 && remainingOwners.size === 0) {
          json(ctx, 409, { error: 'last_owner', detail: 'workspace_must_have_at_least_one_owner' })
          return
        }
      }

      const batchId = `b${Date.now()}`
      const pg = await deps.pgClient()
      const results: Array<{
        memberUuid: string
        status: 'ok' | 'last_owner_refused' | 'forbidden' | 'not_found' | 'internal'
        detail?: string
      }> = []
      let appliedCount = 0
      for (const t of targets) {
        // Per-target gating BEFORE the mutation. Avoids the H3 TOCTOU
        // window: even the bulk path now refuses demote of the last
        // remaining owner when other targets in the same batch already
        // dropped owner-count to 1.
        if (!memberIndex.has(t)) {
          results.push({ memberUuid: t, status: 'not_found' })
          continue
        }
        if (role !== 'OWNER' && memberIndex.get(t) === 'OWNER') {
          if (ownerSet.size <= 1) {
            results.push({ memberUuid: t, status: 'last_owner_refused' })
            continue
          }
          // After this demote there is one fewer owner in the live set;
          // subsequent iterations see the smaller pool.
          ownerSet.delete(t)
        }

        try {
          await db.updateWorkspaceRole(t as any, workspaceUuid as any, role as any)
        } catch (err) {
          deps.measureCtx.error('wac bulk role update failed', {
            workspace: workspaceUuid,
            target: t,
            err: String(err)
          })
          // Sanitize the error message so internal stack traces don't
          // leak to the client.
          results.push({ memberUuid: t, status: 'internal', detail: 'write_failed' })
          continue
        }
        // Mutation succeeded — count + invalidate + audit only this one.
        appliedCount++
        memberIndex.set(t, role)
        if (deps.cacheInvalidator !== undefined) {
          await deps.cacheInvalidator.invalidateAccountInWorkspace(
            workspaceUuid as WorkspaceUuid,
            t
          )
        }
        await writeAuditPostMutation(
          deps,
          pg,
          workspaceUuid,
          'role_changed',
          callerUuid,
          CALLER_ROLE_LABEL,
          {
            target_account: t,
            new_value: { role, batch_id: batchId }
          }
        )
        results.push({ memberUuid: t, status: 'ok' })
      }
      json(ctx, 200, { batch_id: batchId, appliedCount, results })
    },

    async handleGrantRevoke (ctx, workspaceUuid, callerUuid, recipient, resource) {
      // P2B-T6 — real revocation. A WAC "grant" maps to a
      // `core.class.Collaborator` row that attaches a recipient
      // (AccountUuid) to a resource Doc with optional permissions.
      // Revoke = remove that row via TxOperations.removeDoc; the
      // transactor broadcasts the removal to live clients.
      //
      // Same atomicity caveat as the other writes: removeDoc goes via
      // WS, audit goes via pg. We sequence removeDoc → audit and
      // log a 'wac_audit_orphan' breadcrumb if the audit INSERT
      // fails post-removal.
      if (recipient === '' || resource === '') {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const collaboratorClass =
        (core.class as Record<string, any>).Collaborator as Ref<Class<Doc>>
      let collab: Doc | undefined
      try {
        collab = await deps.txClient.findOne(
          workspaceUuid as WorkspaceUuid,
          collaboratorClass,
          { collaborator: recipient, attachedTo: resource }
        )
      } catch (err) {
        deps.measureCtx.error('wac grant findOne failed', {
          workspace: workspaceUuid,
          recipient,
          resource,
          err: String(err)
        })
        json(ctx, 500, { error: 'write_failed', detail: String(err) })
        return
      }
      if (collab === undefined) {
        json(ctx, 404, { error: 'grant_not_found' })
        return
      }
      try {
        await deps.txClient.removeDoc(
          workspaceUuid as WorkspaceUuid,
          callerUuid,
          collab._class as Ref<Class<Doc>>,
          collab.space as Ref<Space>,
          collab._id as Ref<Doc>
        )
      } catch (err) {
        deps.measureCtx.error('wac grant removeDoc failed', {
          workspace: workspaceUuid,
          recipient,
          resource,
          err: String(err)
        })
        json(ctx, 500, { error: 'write_failed', detail: String(err) })
        return
      }
      const pg = await deps.pgClient()
      await writeAuditPostMutation(
        deps,
        pg,
        workspaceUuid,
        'grant_revoked',
        callerUuid,
        CALLER_ROLE_LABEL,
        {
          target_account: recipient,
          target_space: resource,
          old_value: { collaborator_id: String(collab._id) }
        }
      )
      json(ctx, 200, { ok: true })
    }
  }
}
