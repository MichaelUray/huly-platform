//
// Copyright © 2026 Hardcore Engineering Inc.
//
// CRUD endpoints for workspace_access_webhooks subscriptions.
//
// Gating: OWNER or IMPERSONATING_ADMIN only (READ + WRITE). MAINTAINER
// is explicitly NOT allowed — webhooks can carry PII (when data_filter
// is 'full') and altering the destination URL would let a maintainer
// exfiltrate audit events out of the workspace.
//

import {
  assertWorkspaceContext,
  getEffectiveRole,
  WRITE_ALLOWED_ROLES,
  Forbidden,
  type RoleCtx,
  type ImpersonationCtx
} from '@hcengineering/access-management-server'
import { validateWebhookUrl, WebhookUrlError, type LookupFn } from '../webhooks/ssrf'
import {
  dispatchWebhook,
  type DataFilter,
  type DispatcherDeps,
  type WebhookSubscription
} from '../webhooks/dispatcher'

export type { WebhookSubscription, DataFilter }

/**
 * Stable, narrow set of audit-event names a subscription may listen
 * to. Keep additions deliberate — webhook receivers in the wild rely
 * on this enum being a closed set.
 */
export const ALLOWED_WEBHOOK_EVENT_TYPES: ReadonlyArray<string> = Object.freeze([
  'role_changed',
  'grant_created',
  'grant_revoked',
  'grant_expired',
  'member_removed',
  'space_members_changed',
  'space_owners_changed'
])

export const MAX_WEBHOOKS_PER_WORKSPACE = 20

export class ValidationError extends Error {
  readonly status: number
  readonly code: string
  constructor (code: string, message?: string, status = 400) {
    // Embed the stable `code` in the message so caller test matchers
    // and log lines can grep for `code` without inspecting `.code`.
    super(message != null && message !== code ? `${code}: ${message}` : code)
    this.name = 'ValidationError'
    this.code = code
    this.status = status
  }
}

export interface WebhookRow extends WebhookSubscription {
  createdBy: string | null
  createdAt: string
}

export interface WebhookBackend {
  list: (workspace: string) => Promise<WebhookRow[]>
  getById: (workspace: string, id: string) => Promise<WebhookRow | null>
  create: (input: {
    workspace: string
    url: string
    secret: string | null
    eventTypes: string[]
    active: boolean
    dataFilter: DataFilter
    createdBy: string | null
  }) => Promise<WebhookRow>
  update: (workspace: string, id: string, patch: {
    url?: string
    secret?: string | null
    eventTypes?: string[]
    active?: boolean
    dataFilter?: DataFilter
  }) => Promise<WebhookRow | null>
  delete: (workspace: string, id: string) => Promise<boolean>
  /**
   * List active subscriptions matching a workspace + event. Used by
   * the audit hook so dispatch is gated to listeners that asked for
   * this event_type.
   */
  listActiveForEvent: (workspace: string, eventType: string) => Promise<WebhookRow[]>
}

export interface WebhookCtx extends RoleCtx, ImpersonationCtx {
  token: { audience?: string; workspace?: string }
}

export interface WebhookCreateInput {
  url: unknown
  secret?: unknown
  event_types?: unknown
  eventTypes?: unknown
  active?: unknown
  data_filter?: unknown
  dataFilter?: unknown
}

export interface WebhookUpdateInput {
  url?: unknown
  secret?: unknown
  event_types?: unknown
  eventTypes?: unknown
  active?: unknown
  data_filter?: unknown
  dataFilter?: unknown
}

async function gateWrite (ctx: WebhookCtx, workspace: string): Promise<void> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== workspace) throw new Forbidden('workspace mismatch')
  const role = await getEffectiveRole(ctx, workspace)
  if (!WRITE_ALLOWED_ROLES.includes(role)) {
    throw new Forbidden(`webhook_write_not_allowed:${role}`)
  }
}

async function gateRead (ctx: WebhookCtx, workspace: string): Promise<void> {
  // Same gate as write — webhook config carries the destination URL
  // and (potentially) the shared secret, both of which are sensitive.
  await gateWrite(ctx, workspace)
}

function pickArray (a: unknown, b: unknown): unknown {
  return a !== undefined ? a : b
}

function parseEventTypes (raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError('event_types_required', 'event_types must be a non-empty array')
  }
  const out: string[] = []
  for (const e of raw) {
    if (typeof e !== 'string') {
      throw new ValidationError('event_type_invalid', 'event_types entries must be strings')
    }
    if (!ALLOWED_WEBHOOK_EVENT_TYPES.includes(e)) {
      throw new ValidationError('event_type_unknown', `event_type "${e}" is not in the allowed set`)
    }
    if (!out.includes(e)) out.push(e)
  }
  return out
}

function parseDataFilter (raw: unknown, fallback: DataFilter = 'minimal'): DataFilter {
  if (raw === undefined || raw === null) return fallback
  if (raw !== 'minimal' && raw !== 'full') {
    throw new ValidationError('data_filter_invalid', 'data_filter must be "minimal" or "full"')
  }
  return raw
}

function parseUrlOrThrowApi (raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ValidationError('url_required', 'url is required and must be a string')
  }
  try {
    validateWebhookUrl(raw)
  } catch (err) {
    if (err instanceof WebhookUrlError) {
      // 422 specifically for SSRF / private-IP rejection so the API can
      // surface a distinct "you tried to point at an internal host"
      // error vs a generic "URL malformed".
      const status = err.code === 'host_is_blocked_ip' ? 422 : 400
      throw new ValidationError(err.code, err.message, status)
    }
    throw err
  }
  return raw
}

function parseSecret (raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') {
    throw new ValidationError('secret_invalid', 'secret must be a string')
  }
  if (raw.length < 8) {
    throw new ValidationError('secret_too_short', 'secret must be at least 8 characters')
  }
  if (raw.length > 256) {
    throw new ValidationError('secret_too_long', 'secret must be at most 256 characters')
  }
  return raw
}

function parseActive (raw: unknown, fallback = true): boolean {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== 'boolean') {
    throw new ValidationError('active_invalid', 'active must be a boolean')
  }
  return raw
}

export async function listWebhooks (
  ctx: WebhookCtx,
  workspace: string,
  backend: WebhookBackend
): Promise<WebhookRow[]> {
  await gateRead(ctx, workspace)
  return await backend.list(workspace)
}

export async function createWebhook (
  ctx: WebhookCtx,
  workspace: string,
  input: WebhookCreateInput,
  backend: WebhookBackend
): Promise<WebhookRow> {
  await gateWrite(ctx, workspace)
  const existing = await backend.list(workspace)
  if (existing.length >= MAX_WEBHOOKS_PER_WORKSPACE) {
    throw new ValidationError('too_many_webhooks', `Workspace already has ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks`, 409)
  }
  const url = parseUrlOrThrowApi(input.url)
  const secret = parseSecret(input.secret)
  const eventTypes = parseEventTypes(pickArray(input.event_types, input.eventTypes))
  const dataFilter = parseDataFilter(pickArray(input.data_filter, input.dataFilter))
  const active = parseActive(input.active, true)
  return await backend.create({
    workspace,
    url,
    secret,
    eventTypes,
    active,
    dataFilter,
    createdBy: ctx.actorUuid ?? null
  })
}

export async function updateWebhook (
  ctx: WebhookCtx,
  workspace: string,
  id: string,
  input: WebhookUpdateInput,
  backend: WebhookBackend
): Promise<WebhookRow> {
  await gateWrite(ctx, workspace)
  const patch: Parameters<WebhookBackend['update']>[2] = {}
  if (input.url !== undefined) patch.url = parseUrlOrThrowApi(input.url)
  if (input.secret !== undefined) patch.secret = parseSecret(input.secret)
  const eventRaw = pickArray(input.event_types, input.eventTypes)
  if (eventRaw !== undefined) patch.eventTypes = parseEventTypes(eventRaw)
  const dfRaw = pickArray(input.data_filter, input.dataFilter)
  if (dfRaw !== undefined) patch.dataFilter = parseDataFilter(dfRaw)
  if (input.active !== undefined) patch.active = parseActive(input.active)
  const row = await backend.update(workspace, id, patch)
  if (row == null) throw new ValidationError('webhook_not_found', `No webhook with id ${id}`, 404)
  return row
}

export async function deleteWebhook (
  ctx: WebhookCtx,
  workspace: string,
  id: string,
  backend: WebhookBackend
): Promise<void> {
  await gateWrite(ctx, workspace)
  const ok = await backend.delete(workspace, id)
  if (!ok) throw new ValidationError('webhook_not_found', `No webhook with id ${id}`, 404)
}

export interface TestFireDeps extends Pick<DispatcherDeps, 'fetch' | 'lookup' | 'log' | 'sleep'> {}

/**
 * Manually fire a test event to a configured webhook. Issues exactly
 * one attempt (no retry), so the API user sees the receiver's response
 * immediately.
 */
export async function testWebhook (
  ctx: WebhookCtx,
  workspace: string,
  id: string,
  backend: WebhookBackend,
  deps: TestFireDeps
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  await gateWrite(ctx, workspace)
  const sub = await backend.getById(workspace, id)
  if (sub == null) throw new ValidationError('webhook_not_found', `No webhook with id ${id}`, 404)
  const result = await dispatchWebhook(
    sub,
    {
      workspace,
      action: 'webhook_test',
      timestamp: new Date().toISOString(),
      actorUuid: ctx.actorUuid ?? null,
      targetAccountUuid: null,
      targetSpace: null
    },
    { ...deps, retryDelaysMs: [] }
  )
  const last = result.attempts[result.attempts.length - 1]
  return { ok: result.ok, status: last?.status ?? null, error: last?.error }
}

/**
 * Helper for the audit hook: load active subscriptions for `event`
 * and dispatch them async. Errors are swallowed (and logged via
 * deps.log) so the originating write never blocks on webhook IO.
 */
export async function dispatchActiveWebhooksAsync (
  workspace: string,
  event: Parameters<typeof dispatchWebhook>[1],
  backend: Pick<WebhookBackend, 'listActiveForEvent'>,
  deps: DispatcherDeps & { lookup: LookupFn }
): Promise<void> {
  let subs: WebhookRow[]
  try {
    subs = await backend.listActiveForEvent(workspace, event.action)
  } catch (err) {
    deps.log?.('error', 'webhook listActiveForEvent threw', { err: String(err) })
    return
  }
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await dispatchWebhook(sub, event, deps)
      } catch (err) {
        deps.log?.('error', 'dispatchWebhook threw unexpectedly', { webhookId: sub.id, err: String(err) })
      }
    })
  )
}
