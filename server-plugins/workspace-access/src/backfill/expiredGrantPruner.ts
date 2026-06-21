//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Expired-grant pruner. Polls `collaborator` for rows whose
// `expires_at` is in the past, deletes them, and writes one
// `grant_expired` audit row per removed grant.
//
// DSGVO context (Art. 5 Abs. 1 lit. e — Datensparsamkeit / Speicher-
// begrenzung): time-bounded guest grants set via `setGrantExpiry`
// (endpoints/grantEndpoints.ts) must auto-expire without manual
// admin intervention. This module is the enforcer.
//
// Single-process design: the wiring layer (account-service) starts
// exactly one timer. If a deployment runs multiple replicas the
// DELETE is idempotent — only one replica's DELETE actually affects
// rows; the others return zero. No pg-advisory-lock required today
// (see CLAUDE.md note "Tier-1 simplification"). If Igor later wants
// distributed safety, wrap `runOnce` in a `SELECT pg_try_advisory_lock`.
//
// The module is pure: it accepts `deps` (pg adapter + audit writer
// + clock) via dependency injection so it tests trivially with
// fakes. Wiring lives in the account-service.
//

export const DEFAULT_PRUNE_INTERVAL_MS = 5 * 60 * 1000 // 5 min

export interface ExpiredGrantRow {
  workspace: string
  recipientUuid: string
  resourceId: string
  resourceClass: string | null
  expiresAt: string
}

export interface ExpiredGrantPrunerDeps {
  /**
   * Atomically delete `collaborator` rows where `expires_at <= now`,
   * returning the deleted rows so the caller can emit audit events.
   *
   * SQL contract:
   *   DELETE FROM collaborator
   *   WHERE expires_at IS NOT NULL AND expires_at <= $1
   *   RETURNING workspace, attached_to AS recipient_uuid,
   *             resource_id, resource_class, expires_at;
   *
   * (The actual column names depend on the collaborator schema in
   *  the workspace transactor; the adapter normalises them to the
   *  shape above.)
   */
  deleteExpired: (now: Date) => Promise<ExpiredGrantRow[]>
  /**
   * Append one row per deleted grant to `workspace_audit_log`. Called
   * after the DELETE has committed. Failures here are logged but do
   * NOT roll back the DELETE — losing an audit row is preferable to
   * letting an expired grant live another 5 minutes.
   */
  writeAudit: (row: ExpiredGrantRow) => Promise<void>
  /** Optional log sink. Defaults to a no-op so the module stays silent in tests. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
  /** Clock injection — defaults to `Date`. */
  now?: () => Date
}

export interface PruneResult {
  /** Number of rows deleted on this pass. */
  deletedCount: number
  /** Number of audit rows successfully written (≤ deletedCount). */
  auditedCount: number
  /** Number of audit writes that threw (deletedCount - auditedCount). */
  auditFailures: number
}

export interface ExpiredGrantPrunerHandle {
  /** Force a prune pass immediately (returns when complete). */
  triggerNow: () => Promise<PruneResult>
  /** Stop the timer. Idempotent. */
  stop: () => void
}

/**
 * Run one prune pass. Safe to call concurrently from multiple
 * processes — the DELETE is atomic and idempotent (other replicas
 * see zero rows after the first replica's transaction commits).
 */
export async function runExpiredGrantPruneOnce (
  deps: ExpiredGrantPrunerDeps
): Promise<PruneResult> {
  const now = (deps.now ?? (() => new Date()))()
  const log = deps.log ?? (() => {})

  let expired: ExpiredGrantRow[]
  try {
    expired = await deps.deleteExpired(now)
  } catch (err) {
    log('error', 'expired-grant-prune: deleteExpired failed', {
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }

  if (expired.length === 0) {
    return { deletedCount: 0, auditedCount: 0, auditFailures: 0 }
  }

  let auditedCount = 0
  let auditFailures = 0
  for (const row of expired) {
    try {
      await deps.writeAudit(row)
      auditedCount++
    } catch (err) {
      auditFailures++
      // Audit-write failure is logged but does NOT block — the row
      // has already been deleted at this point; retrying would be a
      // no-op for the DELETE but would skew metrics.
      log('warn', 'expired-grant-prune: audit write failed', {
        workspace: row.workspace,
        recipientUuid: row.recipientUuid,
        resourceId: row.resourceId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  log('info', 'expired-grant-prune: pass completed', {
    deletedCount: expired.length,
    auditedCount,
    auditFailures
  })

  return { deletedCount: expired.length, auditedCount, auditFailures }
}

/**
 * Schedule recurring prune passes. Fires once immediately at start
 * (so the first deploy doesn't have to wait a full interval), then
 * every `intervalMs` thereafter. Returns a handle the caller uses
 * to force an extra pass or to stop the timer on shutdown.
 *
 * The returned `triggerNow` is also useful for tests + manual ops
 * ("run the prune NOW, don't wait 5 min").
 */
export function startExpiredGrantPruner (
  deps: ExpiredGrantPrunerDeps,
  intervalMs: number = DEFAULT_PRUNE_INTERVAL_MS
): ExpiredGrantPrunerHandle {
  const log = deps.log ?? (() => {})
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null
  // Prevent overlap: if a pass takes longer than the interval (very
  // large fleet, slow DB) the next tick is a no-op until the
  // current pass settles.
  let inFlight: Promise<PruneResult> | null = null

  const runIfIdle = async (): Promise<PruneResult> => {
    if (inFlight != null) return await inFlight
    inFlight = (async () => {
      try {
        return await runExpiredGrantPruneOnce(deps)
      } catch (err) {
        log('error', 'expired-grant-prune: pass crashed', {
          error: err instanceof Error ? err.message : String(err)
        })
        return { deletedCount: 0, auditedCount: 0, auditFailures: 0 }
      } finally {
        inFlight = null
      }
    })()
    return await inFlight
  }

  // Kick off the first pass on next tick — synchronous start() should
  // return immediately so callers don't block on DB IO during boot.
  setImmediate(() => {
    if (stopped) return
    void runIfIdle()
  })

  timer = setInterval(() => {
    if (stopped) return
    void runIfIdle()
  }, intervalMs)
  // `unref` so the timer doesn't keep the Node process alive past
  // graceful-shutdown signals — the HTTP server is the lifecycle owner.
  if (timer.unref != null) timer.unref()

  return {
    triggerNow: async () => await runIfIdle(),
    stop: () => {
      if (stopped) return
      stopped = true
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
