//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 2A — WAC read-route handlers.
//
// All read-route bodies that used to live inline in
// server/account-service/src/index.ts (lines ~957-1340 in the r12 deploy)
// are migrated here. account-service keeps mount/DI/auth/request-parsing
// duties only; this module owns policy + business logic for /api/wac/*
// reads + the audit CSV export.
//
// Behavior is bit-identical to the pre-migration state. All handlers
// throw on pg errors — the host wraps them in 500 { error: 'internal',
// detail: 'wac_read_failed' } the same way the inline code did.
//
// Structural typing is used for ctx / pg / accountDb so the plugin
// avoids picking up @hcengineering/postgres-base or @hcengineering/account
// as runtime dependencies. The host owns the heavy types; the handlers
// only need the duck-typed surface they actually touch.

// ---------------------------------------------------------------------------
// Minimal structural surfaces (zero new package deps)
// ---------------------------------------------------------------------------

/** Koa-compatible context. Only the fields our handlers touch are typed. */
export interface KoaCtxLike {
  res: {
    writeHead: (status: number, headers?: Record<string, string>) => void
    write: (chunk: any) => boolean | void
    end: (chunk?: any) => void
    headersSent?: boolean
  }
}

/** Subset of postgres-base DBClient that the handlers exercise. */
export interface PgClientLike {
  execute: (query: string, parameters?: any[]) => Promise<any[]>
}

/** Subset of AccountDB used here (the members enumeration path). */
export interface AccountDbLike {
  getWorkspaceMembers: (workspaceId: any) => Promise<Array<{ person: string, role?: string | null }>>
}

/** Subset of MeasureContext used here (logging only). */
export interface MeasureCtxLike {
  warn: (msg: string, attrs?: Record<string, unknown>) => void
  error: (msg: string, attrs?: Record<string, unknown>) => void
}

// ---------------------------------------------------------------------------
// Deps + handler surface
// ---------------------------------------------------------------------------

export interface WacReadDeps {
  measureCtx: MeasureCtxLike
  /** Lazy account-db handle (the host already memoizes this internally). */
  accountDb: () => Promise<AccountDbLike>
  /** Lazy pg-client handle (host wraps Sql via createDBClient once). */
  pgClient: () => Promise<PgClientLike>
  /** Resolve a workspace URL/UUID param to its canonical UUID, or null. */
  resolveWorkspaceUuid: (param: string) => Promise<string | null>
  /** Keep-alive response headers used by the host for JSON writes. */
  jsonHeaders?: Record<string, string>
  /**
   * Phase 4 T3 — additional `_class` strings appended to the hardcoded
   * v1 whitelist in `handleSpaces`. Plugins that register their own
   * `core.class.Space` subclass can be exposed in the WAC Resources
   * view without a code change by setting `WAC_EXTRA_SPACE_CLASSES` on
   * the account-service host (comma-separated, colon-form e.g.
   * `myplugin:class:Foo,other:class:Bar`). The host parses the env and
   * passes the resulting array down here. Empty / unset → no-op.
   *
   * Extra classes inherit the default capability block
   * (`editableHere=true, openInApp=null, v2NotYet=false`); they are NOT
   * synthesized as v2-placeholder rows.
   */
  extraSpaceClasses?: string[]
}

export interface WacReadHandlers {
  handleMembers: (ctx: KoaCtxLike, workspaceUuid: string, workspaceParam: string) => Promise<void>
  /**
   * `workspaceParam` is the URL-form workspace label/UUID that the caller
   * hit. It's used to build the `capabilities.openInApp` deep-link strings
   * for both real rows and the v2 placeholders so the UI can route to
   * `/workbench/<ws>/...` without needing the workspaceUuid.
   */
  handleSpaces: (ctx: KoaCtxLike, workspaceUuid: string, workspaceParam: string) => Promise<void>
  handleSpaceDetail: (ctx: KoaCtxLike, workspaceUuid: string, workspaceParam: string, spaceId: string) => Promise<void>
  handleAudit: (ctx: KoaCtxLike, workspaceUuid: string) => Promise<void>
  handleMyAccess: (ctx: KoaCtxLike, workspaceUuid: string, callerUuid: string, callerRole: string) => Promise<void>
  handleAdminsCount: (ctx: KoaCtxLike, workspaceUuid: string) => Promise<void>
  handleInvites: (ctx: KoaCtxLike, workspaceUuid: string) => Promise<void>
  handleGrants: (ctx: KoaCtxLike, workspaceUuid: string) => Promise<void>
  handleGrantsCount: (ctx: KoaCtxLike, workspaceUuid: string) => Promise<void>
  handleAuditCsvExport: (ctx: KoaCtxLike, workspaceUuid: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Small in-module helpers
// ---------------------------------------------------------------------------

const DEFAULT_JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Connection: 'keep-alive',
  'Keep-Alive': 'timeout=5, max=1000'
}

/** RFC 4180 CSV escape; only quote when comma/quote/CR/LF is present. */
function csvEscape (v: unknown): string {
  const s = v == null ? '' : String(v)
  return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s
}

/** Build a single CSV row terminated with CRLF (Excel-friendly). */
function csvLine (cols: ReadonlyArray<unknown>): string {
  return cols.map(csvEscape).join(',') + '\r\n'
}

function writeJson (ctx: KoaCtxLike, status: number, body: unknown, headers: Record<string, string>): void {
  ctx.res.writeHead(status, headers)
  ctx.res.end(JSON.stringify(body))
}

/** Activity-bucket label exposed by handleMembers. */
export type ActivityBucket = 'today' | '7d' | '30d' | '90d+'

/**
 * Compute the activity bucket for a `lastActivityAt` timestamp relative
 * to `now`. Both arguments are wall-clock milliseconds since epoch — the
 * function is TZ-independent (it operates on a pure `now - lastAct`
 * delta) and is the single source of truth for the four bucket
 * boundaries:
 *
 *   delta <  1 day  → 'today'
 *   delta <  7 days → '7d'
 *   delta < 30 days → '30d'
 *   otherwise       → '90d+'
 *
 * Exported so it can be unit-tested independently of the handler (which
 * additionally pulls rows from pg and is hard to drive deterministically).
 * `now` is injectable so jest fake-timers + `Date.now()` both work; the
 * handler always passes `Date.now()` so behavior is unchanged.
 */
export function bucketForActivity (
  now: number,
  lastActivityAt: number | null
): ActivityBucket {
  if (lastActivityAt == null || !Number.isFinite(lastActivityAt)) return '90d+'
  const delta = now - lastActivityAt
  if (delta < 86400_000) return 'today'
  if (delta < 7 * 86400_000) return '7d'
  if (delta < 30 * 86400_000) return '30d'
  return '90d+'
}

/** Legacy in-handler shim — bind `now` to wall-clock and delegate. */
function bucketize (lastActMs: number | null): ActivityBucket {
  return bucketForActivity(Date.now(), lastActMs)
}

function classDotted (v: unknown): string {
  return String(v ?? '').replace(/:/g, '.')
}

/**
 * Allowed `_class` shape: `<plugin>:class:<Name>` — letters, digits,
 * underscores, dots, hyphens in segments. Anything else is rejected
 * (logged downstream by the host on first call) so an mis-typed env
 * value can't widen the whitelist to e.g. `*`.
 */
const SPACE_CLASS_RE = /^[A-Za-z0-9_.-]+:class:[A-Za-z0-9_.-]+$/

/**
 * Merge the hardcoded v1 class whitelist with optional extras from
 * `WAC_EXTRA_SPACE_CLASSES`. Extras are de-duplicated against the base
 * list and against each other, and silently filtered if they don't look
 * like a valid `plugin:class:Name` token. Order: base first, then
 * extras in original env order, for a deterministic IN-list shape.
 *
 * Exported so account-service tests (and future plugin tests) can
 * exercise the parser without spinning up the handler.
 */
export function mergeSpaceClassWhitelist (
  baseClasses: ReadonlyArray<string>,
  extras: ReadonlyArray<string> | undefined
): string[] {
  if (extras == null || extras.length === 0) return [...baseClasses]
  const seen = new Set(baseClasses)
  const out = [...baseClasses]
  for (const raw of extras) {
    const v = String(raw).trim()
    if (v === '' || seen.has(v) || !SPACE_CLASS_RE.test(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/**
 * Wire-form WAC role. Mirrors the server/account-service WacRole type +
 * frontend `WorkspaceRole`. Kept inline (rather than imported) so the
 * plugin doesn't pick up account-service as a runtime dependency.
 */
export type WacWireRole =
  | 'OWNER'
  | 'MAINTAINER'
  | 'USER'
  | 'GUEST'
  | 'READONLY_GUEST'
  | 'DOC_GUEST'

/**
 * Normalize a raw DB role-string to its WAC wire form. Tolerant to both
 * the wire form (`READONLY_GUEST`) and the core-enum form (`READONLYGUEST`,
 * `DocGuest`) so handleMembers preserves guest-variant distinction
 * regardless of which upstream produced the row.
 */
function mapWacRole (raw: string | null | undefined): WacWireRole {
  if (raw == null) return 'USER'
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
    case 'READONLY_GUEST':
    case 'READONLYGUEST':
      return 'READONLY_GUEST'
    case 'DOC_GUEST':
    case 'DOCGUEST':
      return 'DOC_GUEST'
    default:
      return 'GUEST'
  }
}

/**
 * Capability-Matrix mapping (T2).
 *
 * For each `_class` whitelisted in `handleSpaces`, return:
 *  - editableHere: whether WAC owns the members/owners/flags edit surface
 *  - openInApp:    deep-link to the underlying Huly workbench app, or null
 *
 * Currently every v1 class is `editableHere=true`; the openInApp path
 * mirrors the workbench routes that the front-end already understands
 * (e.g. `/workbench/<ws>/tracker/<spaceId>`).
 *
 * The placeholder rows appended below this query (`chunter.placeholder.v2`,
 * `love.placeholder.v2`, `guest.placeholder.v2`) supply their own
 * capabilities block inline.
 */
function capabilitiesForRealRow (
  classDotted: string,
  workspaceParam: string,
  spaceId: string
): { editableHere: boolean, openInApp: string | null, v2NotYet: boolean } {
  let app: string | null = null
  switch (classDotted) {
    case 'tracker.class.Project':
      app = `/workbench/${workspaceParam}/tracker/${spaceId}`
      break
    case 'document.class.Teamspace':
      app = `/workbench/${workspaceParam}/document/${spaceId}`
      break
    case 'drive.class.Drive':
      app = `/workbench/${workspaceParam}/drive/${spaceId}`
      break
    case 'card.class.CardSpace':
      app = `/workbench/${workspaceParam}/card/${spaceId}`
      break
    case 'lead.class.Funnel':
      app = `/workbench/${workspaceParam}/lead/${spaceId}`
      break
    case 'recruit.class.Vacancy':
    case 'recruit.class.JobFunnel':
      app = `/workbench/${workspaceParam}/recruit/${spaceId}`
      break
    default:
      app = null
  }
  return { editableHere: true, openInApp: app, v2NotYet: false }
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the WAC read-handler set. The factory captures the deps in a
 * closure so the host can register the handlers once and dispatch by
 * sub-route name without re-building per request.
 *
 * Auth + workspace-param resolution happens in the host BEFORE these
 * handlers are invoked. The handlers receive the resolved workspaceUuid
 * (and, where relevant, callerUuid/role) as direct args.
 */
export function createWacReadHandlers (deps: WacReadDeps): WacReadHandlers {
  const jsonHeaders = deps.jsonHeaders ?? DEFAULT_JSON_HEADERS

  const json = (ctx: KoaCtxLike, status: number, body: unknown): void => {
    writeJson(ctx, status, body, jsonHeaders)
  }

  return {
    async handleMembers (ctx, workspaceUuid, workspaceParam) {
      const pg = await deps.pgClient()
      const db = await deps.accountDb()
      const members = await db.getWorkspaceMembers(workspaceUuid as any)
      const items: any[] = []
      for (const m of members) {
        const personUuid = m.person
        const personRows = await pg.execute(
          'SELECT first_name, last_name FROM global_account.person WHERE uuid=$1 LIMIT 1',
          [personUuid]
        )
        const emailRows = await pg.execute(
          "SELECT value FROM global_account.social_id WHERE person_uuid=$1 AND type='email' LIMIT 1",
          [personUuid]
        )
        const acctRows = await pg.execute(
          'SELECT last_activity_at FROM global_account.account WHERE uuid=$1::uuid LIMIT 1',
          [personUuid]
        )
        const rawAct = acctRows[0]?.last_activity_at
        const lastAct = rawAct == null ? null : Number(rawAct)
        const spacesRows = await pg.execute(
          `SELECT count(*)::int AS n FROM public.space
             WHERE "workspaceId" = $1
               AND ((data->'members') ? $2 OR (data->'owners') ? $2)`,
          [workspaceUuid as any, personUuid]
        )
        const spacesCount = Number(spacesRows[0]?.n ?? 0)
        const fn = personRows[0]?.first_name ?? ''
        const ln = personRows[0]?.last_name ?? ''
        const display = `${fn} ${ln}`.trim() || (emailRows[0]?.value ?? personUuid)
        items.push({
          uuid: personUuid,
          name: display,
          email: emailRows[0]?.value ?? '',
          // T3 — preserve Guest sub-role distinction (GUEST / READONLY_GUEST
          // / DOC_GUEST) rather than collapsing all variants to 'GUEST'.
          role: mapWacRole(m.role),
          activityBucket: bucketize(lastAct),
          spacesCount
        })
      }
      json(ctx, 200, { items, cursor: null, _workspace: workspaceParam })
    },

    async handleSpaces (ctx, workspaceUuid, workspaceParam) {
      const pg = await deps.pgClient()
      // T3 — hardcoded v1-managed core classes (7 entries). Anything outside
      // this list is invisible to WAC unless explicitly added via
      // WAC_EXTRA_SPACE_CLASSES on the host (see WacReadDeps.extraSpaceClasses).
      const baseClasses = [
        'tracker:class:Project',
        'document:class:Teamspace',
        'drive:class:Drive',
        'card:class:CardSpace',
        'lead:class:Funnel',
        'recruit:class:Vacancy',
        'recruit:class:JobFunnel'
      ]
      const allClasses = mergeSpaceClassWhitelist(baseClasses, deps.extraSpaceClasses)
      // Build a numbered placeholder list ($2,$3,…) so the value list is
      // bound through libpq rather than interpolated — keeps the path safe
      // even if a future env value sneaks something non-class-shaped past
      // the validator in mergeSpaceClassWhitelist.
      const inPlaceholders = allClasses.map((_, i) => `$${i + 2}`).join(',')
      const rows = await pg.execute(
        `SELECT s."_id", s."_class",
                s.data->>'name' AS name,
                (s.data->>'private')::boolean AS private_flag,
                (s.data->>'autoJoin')::boolean AS auto_join,
                (s.data->>'archived')::boolean AS archived,
                s.data->'owners' AS owners,
                (SELECT count(*)::int FROM collaborator c
                   WHERE c."workspaceId" = s."workspaceId"
                     AND c."attachedTo" = s."_id") AS members_count
         FROM space s
         WHERE s."workspaceId"=$1
           AND s."_class" IN (${inPlaceholders})
         ORDER BY s.data->>'name' ASC
         LIMIT 200`,
        [workspaceUuid, ...allClasses]
      )
      const items: any[] = rows.map((r: any) => {
        const cls = classDotted(r._class)
        return {
          _id: r._id,
          _class: cls,
          name: r.name ?? '—',
          ownerIds: parseJsonArray(r.owners),
          membersCount: Number(r.members_count ?? 0),
          private: r.private_flag === true,
          autoJoin: r.auto_join === true,
          archived: r.archived === true,
          capabilities: capabilitiesForRealRow(cls, workspaceParam, r._id)
        }
      })
      // T1.5 — append v2 placeholder rows so the UI can render
      // "not managed here yet" cards next to real rows for the
      // deliberately-excluded v1 resource types.
      items.push(
        {
          _id: 'wac:placeholder:chat-channels',
          _class: 'chunter.placeholder.v2',
          name: 'Chat Channels',
          ownerIds: [],
          membersCount: 0,
          private: false,
          autoJoin: false,
          archived: false,
          capabilities: {
            editableHere: false,
            openInApp: `/workbench/${workspaceParam}/chunter`,
            v2NotYet: true
          }
        },
        {
          _id: 'wac:placeholder:office-rooms',
          _class: 'love.placeholder.v2',
          name: 'Office Rooms',
          ownerIds: [],
          membersCount: 0,
          private: false,
          autoJoin: false,
          archived: false,
          capabilities: {
            editableHere: false,
            openInApp: `/workbench/${workspaceParam}/love`,
            v2NotYet: true
          }
        },
        {
          _id: 'wac:placeholder:guest-links',
          _class: 'guest.placeholder.v2',
          name: 'Guest Links',
          ownerIds: [],
          membersCount: 0,
          private: false,
          autoJoin: false,
          archived: false,
          capabilities: { editableHere: false, openInApp: null, v2NotYet: true }
        }
      )
      json(ctx, 200, { items, cursor: null })
    },

    async handleSpaceDetail (ctx, workspaceUuid, workspaceParam, spaceId) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        `SELECT "_id", "_class",
                data->>'name' AS name,
                (data->>'private')::boolean AS private_flag,
                (data->>'autoJoin')::boolean AS auto_join,
                (data->>'archived')::boolean AS archived,
                data->>'members' AS members,
                data->>'owners' AS owners
         FROM space WHERE "workspaceId"=$1 AND "_id"=$2 LIMIT 1`,
        [workspaceUuid, spaceId]
      )
      if (rows[0] == null) {
        json(ctx, 404, { error: 'space_not_found', workspace: workspaceParam, space: spaceId })
        return
      }
      const r = rows[0]
      const members = parseJsonArray(r.members)
      const owners = parseJsonArray(r.owners)
      json(ctx, 200, {
        _id: r._id,
        _class: classDotted(r._class),
        name: r.name ?? '—',
        ownerIds: owners,
        members,
        membersCount: members.length,
        private: r.private_flag === true,
        autoJoin: r.auto_join === true,
        archived: r.archived === true
      })
    },

    async handleAudit (ctx, workspaceUuid) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        `SELECT id, ts::text AS ts, action, actor::text AS actor, actor_role,
                target_account::text AS target_account, target_space,
                metadata
         FROM workspace_audit_log
         WHERE workspace=$1
         ORDER BY ts DESC
         LIMIT 100`,
        [workspaceUuid]
      )
      const items = rows.map((r: any) => ({
        id: r.id,
        ts: r.ts,
        action: r.action,
        actor: r.actor,
        actor_pseudonym: null,
        actor_role: r.actor_role,
        target_account: r.target_account,
        target_space: r.target_space,
        metadata: r.metadata ?? {}
      }))
      json(ctx, 200, { items, cursor: null })
    },

    async handleMyAccess (ctx, workspaceUuid, callerUuid, callerRole) {
      const pg = await deps.pgClient()
      const spacesMemberOf: any[] = []
      const spacesOwned: any[] = []
      const rows = await pg.execute(
        `SELECT "_id", "_class", data->>'name' AS name,
                data->>'members' AS members, data->>'owners' AS owners,
                (data->>'private')::boolean AS private_flag,
                (data->>'archived')::boolean AS archived
         FROM space
         WHERE "workspaceId"=$1
           AND (data->'members' ? $2 OR data->'owners' ? $2)
         ORDER BY data->>'name' ASC LIMIT 200`,
        [workspaceUuid, callerUuid]
      )
      for (const r of rows as any[]) {
        const memberList = parseJsonArray(r.members)
        const owners = parseJsonArray(r.owners)
        const spaceOut = {
          _id: r._id,
          _class: classDotted(r._class),
          name: r.name ?? '—',
          ownerIds: owners,
          membersCount: memberList.length,
          private: r.private_flag === true,
          autoJoin: false,
          archived: r.archived === true
        }
        if (owners.includes(callerUuid)) spacesOwned.push(spaceOut)
        if (memberList.includes(callerUuid) && !owners.includes(callerUuid)) spacesMemberOf.push(spaceOut)
      }
      json(ctx, 200, {
        role: callerRole,
        spacesMemberOf,
        spacesOwned,
        grantsReceived: [],
        grantsGiven: []
      })
    },

    async handleAdminsCount (ctx, workspaceUuid) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        "SELECT count(*) AS c FROM global_account.workspace_members WHERE workspace_uuid=$1 AND role IN ('OWNER','MAINTAINER')",
        [workspaceUuid]
      )
      const remaining = parseInt(rows[0]?.c ?? '0', 10)
      json(ctx, 200, { remaining })
    },

    async handleInvites (ctx, workspaceUuid) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        `SELECT id::text AS id, email, expires_on::text AS expires_on, created_on::text AS created_on
         FROM global_account.invite
         WHERE workspace_uuid=$1
         ORDER BY created_on DESC LIMIT 100`,
        [workspaceUuid]
      )
      const items = rows.map((r: any) => ({
        id: r.id,
        email: r.email ?? 'unknown',
        invitedBy: 'system',
        invitedAt: r.created_on,
        expiresAt: r.expires_on
      }))
      json(ctx, 200, { items, cursor: null })
    },

    async handleGrants (ctx, workspaceUuid) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        `SELECT c."_id" AS resource_id,
                c.collaborator AS recipient,
                c."attachedTo" AS resource,
                c."attachedToClass" AS attached_class,
                c."createdBy" AS granter,
                c."createdOn"::text AS granted_at,
                rp.first_name AS recipient_first, rp.last_name AS recipient_last,
                re.value AS recipient_email,
                gp.first_name AS granter_first, gp.last_name AS granter_last
         FROM collaborator c
         LEFT JOIN global_account.person rp ON rp.uuid::text = c.collaborator
         LEFT JOIN global_account.social_id re ON re.person_uuid::text = c.collaborator AND re.type='email'
         LEFT JOIN global_account.person gp ON gp.uuid::text = c."createdBy"
         WHERE c."workspaceId"=$1
         ORDER BY c."createdOn" DESC LIMIT 200`,
        [workspaceUuid]
      )
      const items = (rows as any[]).map((r) => {
        const recipName =
          `${r.recipient_first ?? ''} ${r.recipient_last ?? ''}`.trim() ||
          r.recipient_email ||
          r.recipient ||
          'unknown'
        const grantName =
          `${r.granter_first ?? ''} ${r.granter_last ?? ''}`.trim() || r.granter || 'system'
        return {
          recipientUuid: r.recipient ?? 'unknown',
          recipientName: recipName,
          granterUuid: r.granter ?? 'system',
          granterName: grantName,
          resourceId: r.resource ?? r.resource_id,
          resourceClass: classDotted(r.attached_class),
          resourceTitle: String(r.attached_class ?? 'Resource').replace(/.*:class:/, ''),
          grantedAt: r.granted_at
        }
      })
      json(ctx, 200, { items, cursor: null })
    },

    async handleGrantsCount (ctx, workspaceUuid) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        'SELECT count(*) AS c FROM collaborator WHERE "workspaceId"=$1',
        [workspaceUuid]
      )
      json(ctx, 200, { count: parseInt((rows[0] as any)?.c ?? '0', 10) })
    },

    async handleAuditCsvExport (ctx, workspaceUuid) {
      const pg = await deps.pgClient()
      const rows = await pg.execute(
        `SELECT id, ts::text AS ts, action, actor::text AS actor, actor_role,
                target_account::text AS target_account, target_space, target_space_class
         FROM workspace_audit_log
         WHERE workspace=$1
         ORDER BY ts DESC LIMIT 5000`,
        [workspaceUuid]
      )
      ctx.res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="wac-audit-${Date.now()}.csv"`,
        'Cache-Control': 'no-store'
      })
      // BOM for Excel-on-Windows UTF-8 sniffing.
      ctx.res.write(Buffer.from([0xef, 0xbb, 0xbf]))
      ctx.res.write('id,ts,action,actor,actor_role,target_account,target_space,target_space_class\r\n')
      for (const r of rows as any[]) {
        ctx.res.write(
          csvLine([
            r.id,
            r.ts,
            r.action,
            r.actor ?? '',
            r.actor_role,
            r.target_account ?? '',
            r.target_space ?? '',
            r.target_space_class ?? ''
          ])
        )
      }
      ctx.res.end()
    }
  }
}

// Re-exported for the host's source-grep guard tests + Phase 2B.
export { csvEscape as __csvEscape, csvLine as __csvLine, bucketize as __bucketize, mapWacRole as __mapWacRole }
