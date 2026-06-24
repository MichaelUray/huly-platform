//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Outbound webhook dispatcher. Three responsibilities:
//
//   1. Build the payload using the subscription's data_filter
//      ('minimal' = UUIDs only; 'full' = + email/name).
//   2. Sign the payload (HMAC-SHA256) with the subscription secret
//      when one is configured.
//   3. POST with timeout + exponential-backoff retry (3 attempts:
//      1s, 4s, 16s) and report success/failure to the caller.
//
// The dispatcher is fully dependency-injected (fetch, sleep, lookup,
// audit writer) so it's unit-testable without network access.
//

import { createHmac } from 'crypto'
import { assertResolvedHostSafe, validateWebhookUrl, WebhookUrlError, type LookupFn } from './ssrf'

export type WebhookAction =
  | 'role_changed'
  | 'grant_created'
  | 'member_removed'
  | 'grant_expired'
  | 'space_members_changed'
  | 'space_owners_changed'
  | 'webhook_test'

export type DataFilter = 'minimal' | 'full'

export interface WebhookSubscription {
  id: string
  workspace: string
  url: string
  secret: string | null
  eventTypes: string[]
  active: boolean
  dataFilter: DataFilter
}

export interface AuditEvent {
  workspace: string
  action: string
  timestamp: string
  actorUuid?: string | null
  targetAccountUuid?: string | null
  targetSpace?: string | null
  /** Optional PII; only included when subscription.dataFilter === 'full'. */
  targetEmail?: string | null
  /** Optional PII; only included when subscription.dataFilter === 'full'. */
  targetName?: string | null
}

export interface DispatchAttempt {
  attempt: number
  status: number | null
  error?: string
}

export interface DispatchResult {
  ok: boolean
  attempts: DispatchAttempt[]
}

export interface DispatcherDeps {
  fetch: typeof fetch
  /** Defaults to setTimeout-based sleep. Overridable for tests. */
  sleep?: (ms: number) => Promise<void>
  /** DNS lookup; defaults to dns.promises.lookup. */
  lookup: LookupFn
  /**
   * Optional sink for the `webhook_failed` audit row that gets written
   * when all retries are exhausted. The wiring layer hooks this into
   * the same workspace_audit_log table; tests pass a spy.
   */
  recordFailureAudit?: (sub: WebhookSubscription, event: AuditEvent, result: DispatchResult) => Promise<void>
  /** Optional debug logger. */
  log?: (level: 'debug' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void
  /** Timeout per HTTP attempt, milliseconds. Default: 10_000. */
  timeoutMs?: number
  /**
   * Retry delays in ms. Default: [1_000, 4_000, 16_000] → up to 3
   * attempts after the initial one. The first entry is the wait
   * BEFORE attempt #2.
   */
  retryDelaysMs?: number[]
}

export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_RETRY_DELAYS_MS: number[] = [1_000, 4_000, 16_000]

export function buildPayload (sub: WebhookSubscription, event: AuditEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    workspace: event.workspace,
    action: event.action,
    timestamp: event.timestamp,
    actor_uuid: event.actorUuid ?? null,
    target_account_uuid: event.targetAccountUuid ?? null,
    target_space: event.targetSpace ?? null
  }
  if (sub.dataFilter === 'full') {
    payload.target_email = event.targetEmail ?? null
    payload.target_name = event.targetName ?? null
  }
  return payload
}

export function signPayload (secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Dispatch a single event to a single subscription. Honours retry +
 * timeout. On final failure, writes a `webhook_failed` audit row via
 * deps.recordFailureAudit (if supplied).
 *
 * SECURITY: every attempt re-validates the URL and re-resolves DNS,
 * so an attacker who flips the DNS answer between attempts can't move
 * the host into the blocklist mid-flight.
 */
export async function dispatchWebhook (
  sub: WebhookSubscription,
  event: AuditEvent,
  deps: DispatcherDeps
): Promise<DispatchResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const totalAttempts = retryDelaysMs.length + 1
  const attempts: DispatchAttempt[] = []

  const body = JSON.stringify(buildPayload(sub, event))
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'huly-wac-webhook/1.0',
    'x-wac-event': event.action,
    'x-wac-workspace': event.workspace,
    'x-wac-webhook-id': sub.id
  }
  if (sub.secret != null && sub.secret !== '') {
    headers['x-wac-webhook-signature'] = signPayload(sub.secret, body)
  }

  for (let i = 0; i < totalAttempts; i++) {
    if (i > 0) {
      await sleep(retryDelaysMs[i - 1])
    }
    try {
      const { url, host } = validateWebhookUrl(sub.url)
      await assertResolvedHostSafe(host, deps.lookup)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let status: number | null = null
      try {
        const resp = await deps.fetch(url.toString(), {
          method: 'POST',
          headers,
          body,
          signal: controller.signal
        })
        status = resp.status
      } finally {
        clearTimeout(timer)
      }
      attempts.push({ attempt: i + 1, status })
      if (status != null && status >= 200 && status < 300) {
        deps.log?.('debug', 'webhook delivered', { webhookId: sub.id, attempt: i + 1, status })
        return { ok: true, attempts }
      }
      // Non-2xx → keep retrying. 4xx is also retried (transient
      // 408/425/429/etc. happen); the SSRF guard kept us off internal
      // hosts so a 401 on the receiving side just means re-try.
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      attempts.push({ attempt: i + 1, status: null, error: errMsg })
      // If the URL itself is invalid or the host resolves into the
      // blocklist, retrying won't help — bail out.
      if (err instanceof WebhookUrlError) {
        deps.log?.('error', 'webhook url validation failed', { webhookId: sub.id, code: err.code })
        break
      }
    }
  }
  const result: DispatchResult = { ok: false, attempts }
  deps.log?.('warn', 'webhook failed after all retries', { webhookId: sub.id, attempts: attempts.length })
  if (deps.recordFailureAudit != null) {
    try {
      await deps.recordFailureAudit(sub, event, result)
    } catch (err) {
      deps.log?.('error', 'webhook_failed audit write threw', { webhookId: sub.id, err: String(err) })
    }
  }
  return result
}
