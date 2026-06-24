//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// WAC Permission Templates (a.k.a. Role+Spaces Presets) — Tier-1.
//
// Workspace-local list of reusable "Role + addToSpaces[]" templates that
// an Owner (or impersonating instance-admin) can apply to one or more
// workspace members in a single click. Snapshot-at-Apply: the shape is
// frozen into the audit row at apply-time, so a later edit of the preset
// does NOT change which members were already configured.
//
// Storage: `workspace_access_presets` (see V34 migration). The shape
// JSONB carries only `role` + `addToSpaces` for v1; doc-permissions /
// custom-attributes are deferred to v2.
//
// HTTP surface (all gated OWNER + IMPERSONATING_ADMIN by the host):
//   GET    /api/wac/<ws>/presets
//   POST   /api/wac/<ws>/presets
//   PUT    /api/wac/<ws>/presets/<id>
//   DELETE /api/wac/<ws>/presets/<id>
//   POST   /api/wac/<ws>/presets/<id>/apply
//
// Audit events:
//   - preset_created
//   - preset_updated
//   - preset_deleted
//   - preset_applied   (metadata: { presetId, presetSnapshot, memberCount, results[] })
//
// The apply handler routes OWNER demotes through the existing atomic
// `updateWorkspaceRoleIfNotLastOwner` helper so a preset cannot
// accidentally empty the OWNER set in a single click.

import type {
  Class,
  Doc,
  DocumentUpdate,
  Ref,
  Space,
  WorkspaceUuid
} from '@hcengineering/core'
import { AccountRole } from '@hcengineering/core'
import { executeWorkspaceAuditInsert } from '../audit/insert'
import type {
  KoaWriteCtxLike,
  WacTxClientLike,
  WacWriteDeps,
  WritePgClientLike
} from './writeRouter'

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/**
 * Tier-1 preset shape. Carries the role to assign + the spaces to add
 * the target member(s) to. Doc-permissions / custom-attribute presets
 * are tracked for v2.
 */
export interface PresetShape {
  role: PresetWireRole
  /** Space `_id` strings — added to each target member's space membership. */
  addToSpaces: string[]
}

/**
 * Wire-form role accepted by `shape.role`. Mirrors the WAC role wire form
 * accepted by /members/.../role; `wireToAccountRole` below converts to
 * canonical `AccountRole` at apply time.
 */
export type PresetWireRole =
  | 'OWNER'
  | 'MAINTAINER'
  | 'USER'
  | 'GUEST'
  | 'READONLY_GUEST'
  | 'DOC_GUEST'

/** Row returned from the table (post-pg row mapping). */
export interface PresetRow {
  id: string
  workspace: string
  name: string
  description: string | null
  shape: PresetShape
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Per-target outcome for the apply pipeline. */
export type ApplyResultStatus =
  | 'ok'
  | 'last_owner_refused'
  | 'not_found'
  | 'internal'

export interface ApplyResult {
  memberUuid: string
  status: ApplyResultStatus
  /** Count of spaces the target was added to (or 0 on failure). */
  addedToSpaces: number
  /** Free-form detail, only populated on failure. */
  detail?: string
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export interface WacPresetsHandlers {
  handleList: (
    ctx: KoaWriteCtxLike,
    workspaceUuid: string,
    callerUuid: string
  ) => Promise<void>
  handleCreate: (
    ctx: KoaWriteCtxLike,
    workspaceUuid: string,
    callerUuid: string,
    actorAdmin?: string
  ) => Promise<void>
  handleUpdate: (
    ctx: KoaWriteCtxLike,
    workspaceUuid: string,
    callerUuid: string,
    presetId: string,
    actorAdmin?: string
  ) => Promise<void>
  handleDelete: (
    ctx: KoaWriteCtxLike,
    workspaceUuid: string,
    callerUuid: string,
    presetId: string,
    actorAdmin?: string
  ) => Promise<void>
  handleApply: (
    ctx: KoaWriteCtxLike,
    workspaceUuid: string,
    callerUuid: string,
    presetId: string,
    actorAdmin?: string
  ) => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Connection: 'keep-alive',
  'Keep-Alive': 'timeout=5, max=1000'
}

const CALLER_ROLE_LABEL = 'workspace_owner'

const WIRE_ROLES: ReadonlySet<string> = new Set([
  'OWNER', 'MAINTAINER', 'USER', 'GUEST', 'READONLY_GUEST', 'DOC_GUEST'
])

/** Convert wire-form role to canonical AccountRole. Returns null on bad input. */
function wireToAccountRole (raw: unknown): AccountRole | null {
  if (typeof raw !== 'string') return null
  switch (raw) {
    case 'OWNER': return AccountRole.Owner
    case 'MAINTAINER': return AccountRole.Maintainer
    case 'USER': return AccountRole.User
    case 'GUEST': return AccountRole.Guest
    case 'READONLY_GUEST': return AccountRole.ReadOnlyGuest
    case 'DOC_GUEST': return AccountRole.DocGuest
    default: return null
  }
}

/** Read JSON body; null on parse fail. */
function readBody (ctx: KoaWriteCtxLike): Record<string, any> | null {
  const b = ctx.request.body
  if (b == null || typeof b !== 'object') return null
  return b as Record<string, any>
}

/**
 * Validate the user-supplied shape blob. Tier-1: only role + addToSpaces.
 * Extra fields are dropped silently to keep forward-compat with v2 callers.
 */
export function validateShape (raw: unknown): { ok: true, shape: PresetShape } | { ok: false, error: string } {
  if (raw == null || typeof raw !== 'object') return { ok: false, error: 'shape_required' }
  const r = raw as Record<string, any>
  if (typeof r.role !== 'string' || !WIRE_ROLES.has(r.role)) return { ok: false, error: 'bad_role' }
  if (!Array.isArray(r.addToSpaces)) return { ok: false, error: 'bad_addToSpaces' }
  const spaces: string[] = []
  for (const s of r.addToSpaces) {
    if (typeof s !== 'string' || s.length === 0) return { ok: false, error: 'bad_addToSpaces' }
    spaces.push(s)
  }
  return { ok: true, shape: { role: r.role as PresetWireRole, addToSpaces: spaces } }
}

/** Parse the raw `shape` column (may be jsonb-string or already-parsed). */
function parseShape (raw: unknown): PresetShape {
  if (raw == null) return { role: 'USER', addToSpaces: [] }
  if (typeof raw === 'object') return raw as PresetShape
  try {
    return JSON.parse(String(raw)) as PresetShape
  } catch {
    return { role: 'USER', addToSpaces: [] }
  }
}

/** Map a raw pg row to PresetRow. */
function mapRow (r: any): PresetRow {
  return {
    id: String(r.id),
    workspace: String(r.workspace),
    name: String(r.name),
    description: r.description == null ? null : String(r.description),
    shape: parseShape(r.shape),
    created_by: r.created_by == null ? null : String(r.created_by),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at)
  }
}

/**
 * Write a preset-lifecycle audit row. Mirrors the
 * `writeAuditPostMutation` pattern from writeRouter.ts — sequenced
 * AFTER the mutation, swallows pg-side throws as a `wac_audit_orphan`
 * breadcrumb so the HTTP contract stays consistent.
 */
async function writePresetAudit (
  deps: WacWriteDeps,
  pg: WritePgClientLike,
  workspace: string,
  action: 'preset_created' | 'preset_updated' | 'preset_deleted' | 'preset_applied',
  actor: string | null,
  payload: {
    target_account?: string | null
    old_value?: unknown
    new_value?: unknown
    metadata?: Record<string, unknown>
    impersonationActorAdmin?: string | null
  }
): Promise<void> {
  try {
    await executeWorkspaceAuditInsert(pg, {
      workspace,
      action,
      actor,
      actorRole: CALLER_ROLE_LABEL,
      target_account: payload.target_account ?? null,
      old_value: payload.old_value,
      new_value: payload.new_value,
      metadata: payload.metadata,
      impersonationActorAdmin: payload.impersonationActorAdmin ?? null
    })
  } catch (err) {
    deps.measureCtx.error('wac preset audit-INSERT failed after successful mutation', {
      breadcrumb: 'wac_audit_orphan',
      workspace,
      action,
      actor,
      err: String(err)
    })
    try { deps.measureCtx.measure?.('wac_audit_orphan', 1) } catch {}
  }
}

/**
 * Look up a single space row (members + class) so the apply pipeline can
 * push a new member onto it via TxOperations.updateDoc. Mirrors the
 * `loadSpaceRow` shape in writeRouter.ts.
 */
async function loadSpaceForApply (
  pg: WritePgClientLike,
  workspaceUuid: string,
  spaceId: string
): Promise<{ _id: string, _class: string, space: string, members: string[] } | null> {
  const rows = await pg.execute(
    `SELECT "_id", "_class", "space",
            data->>'members' AS members
     FROM space WHERE "workspaceId"=$1 AND "_id"=$2 LIMIT 1`,
    [workspaceUuid, spaceId]
  )
  if (rows[0] == null) return null
  const r = rows[0] as any
  let members: string[] = []
  const raw = r.members
  if (Array.isArray(raw)) members = raw as string[]
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) members = parsed as string[]
    } catch {}
  }
  return {
    _id: String(r._id),
    _class: String(r._class),
    space: String(r.space ?? 'core:space:Space'),
    members
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the WAC presets-handler set. Shares `WacWriteDeps` with the
 * write handlers (same accountDb / pgClient / txClient / measureCtx
 * surfaces) so the host wires the routes with the same DI bundle.
 *
 * @public
 */
export function createWacPresetsHandlers (deps: WacWriteDeps): WacPresetsHandlers {
  const jsonHeaders = deps.jsonHeaders ?? DEFAULT_JSON_HEADERS
  const json = (ctx: KoaWriteCtxLike, status: number, body: unknown): void => {
    ctx.res.writeHead(status, jsonHeaders)
    ctx.res.end(JSON.stringify(body))
  }

  return {
    async handleList (ctx, workspaceUuid, _callerUuid) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        `SELECT id, workspace, name, description, shape,
                created_by, created_at::text AS created_at, updated_at::text AS updated_at
         FROM workspace_access_presets
         WHERE workspace = $1
         ORDER BY name ASC
         LIMIT 200`,
        [workspaceUuid]
      )
      const items = (rows as any[]).map(mapRow)
      json(ctx, 200, { items, cursor: null })
    },

    async handleCreate (ctx, workspaceUuid, callerUuid, actorAdmin) {
      const body = readBody(ctx)
      if (body == null) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '' || name.length > 200) {
        json(ctx, 400, { error: 'bad_name' })
        return
      }
      const description = typeof body.description === 'string' ? body.description : null
      const shapeRes = validateShape(body.shape)
      if (!shapeRes.ok) {
        json(ctx, 400, { error: shapeRes.error })
        return
      }
      const pg = await deps.pgClient()
      let row: PresetRow
      try {
        const rows = await pg.execute(
          `INSERT INTO workspace_access_presets (workspace, name, description, shape, created_by)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING id, workspace, name, description, shape,
                     created_by, created_at::text AS created_at, updated_at::text AS updated_at`,
          [workspaceUuid, name, description, JSON.stringify(shapeRes.shape), callerUuid]
        )
        if (rows[0] == null) {
          json(ctx, 500, { error: 'write_failed' })
          return
        }
        row = mapRow(rows[0])
      } catch (err) {
        // Most likely cause: UNIQUE (workspace, name) collision.
        const msg = String(err)
        if (/duplicate|unique/i.test(msg)) {
          json(ctx, 409, { error: 'name_exists' })
          return
        }
        deps.measureCtx.error('wac preset insert failed', { workspace: workspaceUuid, err: msg })
        json(ctx, 500, { error: 'write_failed', detail: msg })
        return
      }
      await writePresetAudit(deps, pg, workspaceUuid, 'preset_created', callerUuid, {
        new_value: row,
        metadata: { presetId: row.id, presetSnapshot: { name: row.name, shape: row.shape } },
        impersonationActorAdmin: actorAdmin ?? null
      })
      json(ctx, 200, { item: row })
    },

    async handleUpdate (ctx, workspaceUuid, callerUuid, presetId, actorAdmin) {
      const body = readBody(ctx)
      if (body == null) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const pg = await deps.pgClient()
      // Load existing row for the old_value snapshot + 404 if absent.
      const existingRows = await pg.execute(
        `SELECT id, workspace, name, description, shape,
                created_by, created_at::text AS created_at, updated_at::text AS updated_at
         FROM workspace_access_presets
         WHERE workspace = $1 AND id = $2 LIMIT 1`,
        [workspaceUuid, presetId]
      )
      if (existingRows[0] == null) {
        json(ctx, 404, { error: 'preset_not_found' })
        return
      }
      const existing = mapRow(existingRows[0])

      let nextName = existing.name
      let nextDescription = existing.description
      let nextShape = existing.shape

      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim() === '' || body.name.length > 200) {
          json(ctx, 400, { error: 'bad_name' })
          return
        }
        nextName = body.name.trim()
      }
      if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== 'string') {
          json(ctx, 400, { error: 'bad_description' })
          return
        }
        nextDescription = body.description as string | null
      }
      if (body.shape !== undefined) {
        const res = validateShape(body.shape)
        if (!res.ok) {
          json(ctx, 400, { error: res.error })
          return
        }
        nextShape = res.shape
      }

      let updatedRow: PresetRow
      try {
        const rows = await pg.execute(
          `UPDATE workspace_access_presets
           SET name = $3, description = $4, shape = $5::jsonb, updated_at = now()
           WHERE workspace = $1 AND id = $2
           RETURNING id, workspace, name, description, shape,
                     created_by, created_at::text AS created_at, updated_at::text AS updated_at`,
          [workspaceUuid, presetId, nextName, nextDescription, JSON.stringify(nextShape)]
        )
        if (rows[0] == null) {
          json(ctx, 404, { error: 'preset_not_found' })
          return
        }
        updatedRow = mapRow(rows[0])
      } catch (err) {
        const msg = String(err)
        if (/duplicate|unique/i.test(msg)) {
          json(ctx, 409, { error: 'name_exists' })
          return
        }
        deps.measureCtx.error('wac preset update failed', { workspace: workspaceUuid, presetId, err: msg })
        json(ctx, 500, { error: 'write_failed', detail: msg })
        return
      }
      await writePresetAudit(deps, pg, workspaceUuid, 'preset_updated', callerUuid, {
        old_value: existing,
        new_value: updatedRow,
        metadata: { presetId, presetSnapshot: { name: updatedRow.name, shape: updatedRow.shape } },
        impersonationActorAdmin: actorAdmin ?? null
      })
      json(ctx, 200, { item: updatedRow })
    },

    async handleDelete (ctx, workspaceUuid, callerUuid, presetId, actorAdmin) {
      const pg = await deps.pgClient()
      let removed: PresetRow | null = null
      try {
        const rows = await pg.execute(
          `DELETE FROM workspace_access_presets
           WHERE workspace = $1 AND id = $2
           RETURNING id, workspace, name, description, shape,
                     created_by, created_at::text AS created_at, updated_at::text AS updated_at`,
          [workspaceUuid, presetId]
        )
        if (rows[0] == null) {
          json(ctx, 404, { error: 'preset_not_found' })
          return
        }
        removed = mapRow(rows[0])
      } catch (err) {
        deps.measureCtx.error('wac preset delete failed', { workspace: workspaceUuid, presetId, err: String(err) })
        json(ctx, 500, { error: 'write_failed', detail: String(err) })
        return
      }
      await writePresetAudit(deps, pg, workspaceUuid, 'preset_deleted', callerUuid, {
        old_value: removed,
        metadata: { presetId, presetSnapshot: { name: removed.name, shape: removed.shape } },
        impersonationActorAdmin: actorAdmin ?? null
      })
      json(ctx, 200, { ok: true })
    },

    async handleApply (ctx, workspaceUuid, callerUuid, presetId, actorAdmin) {
      const body = readBody(ctx)
      if (body == null || !Array.isArray(body.memberUuids)) {
        json(ctx, 400, { error: 'bad_request' })
        return
      }
      const targets: string[] = body.memberUuids.filter((m: any) => typeof m === 'string')
      if (targets.length === 0) {
        json(ctx, 400, { error: 'no_targets' })
        return
      }
      const pg = await deps.pgClient()
      // Snapshot-at-Apply: capture the preset row NOW; subsequent edits do
      // NOT change which members were already configured.
      const presetRows = await pg.execute(
        `SELECT id, workspace, name, description, shape,
                created_by, created_at::text AS created_at, updated_at::text AS updated_at
         FROM workspace_access_presets
         WHERE workspace = $1 AND id = $2 LIMIT 1`,
        [workspaceUuid, presetId]
      )
      if (presetRows[0] == null) {
        json(ctx, 404, { error: 'preset_not_found' })
        return
      }
      const snapshot = mapRow(presetRows[0])
      const canonicalRole = wireToAccountRole(snapshot.shape.role)
      if (canonicalRole === null) {
        json(ctx, 422, { error: 'preset_shape_invalid' })
        return
      }

      const db = await deps.accountDb()
      const members = await db.getWorkspaceMembers(workspaceUuid as any)
      const memberRoleIndex = new Map(members.map((m) => [m.person, m.role ?? null]))
      const ownerSet = new Set(
        members.filter((m) => m.role === AccountRole.Owner).map((m) => m.person)
      )

      // Workspace-level guard: if this apply would empty the OWNER set,
      // refuse the entire batch — mirrors the bulk-role 409 contract.
      if (canonicalRole !== AccountRole.Owner) {
        const remainingOwners = new Set(ownerSet)
        for (const t of targets) remainingOwners.delete(t)
        if (ownerSet.size > 0 && remainingOwners.size === 0) {
          json(ctx, 409, { error: 'last_owner', detail: 'workspace_must_have_at_least_one_owner' })
          return
        }
      }

      const results: ApplyResult[] = []
      let appliedCount = 0
      for (const t of targets) {
        if (!memberRoleIndex.has(t)) {
          results.push({ memberUuid: t, status: 'not_found', addedToSpaces: 0 })
          continue
        }
        const oldRole = memberRoleIndex.get(t)
        const isOwnerDemote = oldRole === AccountRole.Owner && canonicalRole !== AccountRole.Owner

        // 1) Role mutation. Route OWNER demotes through the atomic helper
        //    to inherit the H3 race protection from handleBulkMemberRole.
        try {
          if (isOwnerDemote) {
            if (ownerSet.size <= 1) {
              results.push({ memberUuid: t, status: 'last_owner_refused', addedToSpaces: 0 })
              continue
            }
            const ok = await db.updateWorkspaceRoleIfNotLastOwner(
              t as any,
              workspaceUuid as any,
              canonicalRole
            )
            if (!ok) {
              results.push({ memberUuid: t, status: 'last_owner_refused', addedToSpaces: 0 })
              continue
            }
            ownerSet.delete(t)
          } else {
            await db.updateWorkspaceRole(t as any, workspaceUuid as any, canonicalRole)
          }
        } catch (err) {
          deps.measureCtx.error('wac preset apply role-update failed', {
            workspace: workspaceUuid,
            target: t,
            err: String(err)
          })
          results.push({ memberUuid: t, status: 'internal', addedToSpaces: 0, detail: 'role_update_failed' })
          continue
        }
        memberRoleIndex.set(t, canonicalRole)

        // 2) Space adds. Best-effort: a single failed space does not abort
        //    the whole target; we count how many succeeded.
        let addedToSpaces = 0
        for (const spaceId of snapshot.shape.addToSpaces) {
          let spaceRow: Awaited<ReturnType<typeof loadSpaceForApply>> = null
          try {
            spaceRow = await loadSpaceForApply(pg, workspaceUuid, spaceId)
          } catch (err) {
            deps.measureCtx.warn('wac preset apply space-load failed', {
              workspace: workspaceUuid,
              target: t,
              space: spaceId,
              err: String(err)
            })
            continue
          }
          if (spaceRow == null) {
            // Snapshot referenced a space that no longer exists; skip.
            continue
          }
          if (spaceRow.members.includes(t)) {
            // Idempotent: already a member, count it as added.
            addedToSpaces++
            continue
          }
          const nextMembers = [...spaceRow.members, t]
          try {
            await deps.txClient.updateDoc(
              workspaceUuid as WorkspaceUuid,
              callerUuid,
              spaceRow._class as Ref<Class<Doc>>,
              spaceRow.space as Ref<Space>,
              spaceRow._id as Ref<Doc>,
              { members: nextMembers } as unknown as DocumentUpdate<Doc>
            )
            addedToSpaces++
          } catch (err) {
            deps.measureCtx.warn('wac preset apply space-add failed', {
              workspace: workspaceUuid,
              target: t,
              space: spaceId,
              err: String(err)
            })
          }
        }

        // 3) Best-effort cache invalidation.
        if (deps.cacheInvalidator !== undefined) {
          try {
            await deps.cacheInvalidator.invalidateAccountInWorkspace(
              workspaceUuid as WorkspaceUuid,
              t
            )
          } catch (err) {
            deps.measureCtx.warn('wac preset apply cache-invalidate failed', {
              workspace: workspaceUuid,
              target: t,
              err: String(err)
            })
          }
        }

        appliedCount++
        results.push({ memberUuid: t, status: 'ok', addedToSpaces })
      }

      // Single aggregated audit row carrying the full snapshot + per-target
      // outcomes. Matches the spec contract:
      //   metadata: { presetId, presetSnapshot, memberCount, results[] }
      await writePresetAudit(deps, pg, workspaceUuid, 'preset_applied', callerUuid, {
        metadata: {
          presetId: snapshot.id,
          presetSnapshot: { name: snapshot.name, shape: snapshot.shape },
          memberCount: targets.length,
          results
        },
        impersonationActorAdmin: actorAdmin ?? null
      })
      json(ctx, 200, { applied: appliedCount, results, snapshot })
    }
  }
}

// Re-exported for tests / hosts that need to validate shapes outside the
// handler (e.g. a CLI seeding script).
export { wireToAccountRole as __presetWireToAccountRole }
