//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wiring for the time-bounded grants prune loop. Lives in
// account-service because the existing WAC stub routes also live here
// (see ── WAC stub routes ── section in index.ts) — this keeps the
// lifecycle owner of the polling timer in the same process that owns
// the HTTP layer.
//
// The actual prune logic + audit emission contract is defined in
// `@hcengineering/server-workspace-access` (backfill/expiredGrantPruner).
// This module supplies the deps adapter: a stub DELETE that returns
// no rows (until the workspace transactor is wired in a follow-up PR)
// and a JSON-log audit writer.
//
// Why a stub DELETE today: the workspace transactor lookup + actual
// `collaborator` schema differs per deployment and isn't reachable
// from the account-service process yet. The pruner loop is still
// started so:
//   1. The timer's existence + cadence is observable in production
//      logs from day one.
//   2. The migration is exercised even before grants get expiry dates.
//   3. The wiring layer in the transactor PR plugs in a real adapter
//      by swapping `deleteExpired` — zero changes to the pruner code.
//

import {
  startExpiredGrantPruner,
  DEFAULT_PRUNE_INTERVAL_MS,
  type ExpiredGrantPrunerHandle,
  type ExpiredGrantPrunerDeps,
  type ExpiredGrantRow
} from '@hcengineering/server-workspace-access'

export interface WacGrantPrunerOptions {
  intervalMs?: number
  /**
   * Real deleteExpired adapter, injected by the workspace-transactor
   * wiring PR. When omitted, a no-op stub is used (returns empty array,
   * audit writer never fires) so the timer + log cadence are still
   * observable without coupling to the collaborator schema.
   */
  deleteExpired?: ExpiredGrantPrunerDeps['deleteExpired']
  /** Optional audit writer override. Defaults to a JSON console.log. */
  writeAudit?: ExpiredGrantPrunerDeps['writeAudit']
  /** Optional log sink. Defaults to a stdout JSON line. */
  log?: ExpiredGrantPrunerDeps['log']
}

const defaultLog: NonNullable<ExpiredGrantPrunerDeps['log']> = (level, msg, extra) => {
  // Keep this single-line JSON so it slots into the existing
  // account-service log pipeline without surprises.
  const line = JSON.stringify({
    component: 'wac-expired-grant-pruner',
    level,
    msg,
    ...(extra ?? {})
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

const defaultWriteAudit: NonNullable<ExpiredGrantPrunerDeps['writeAudit']> = async (row: ExpiredGrantRow) => {
  // Real implementation writes to `workspace_audit_log` via the WAC
  // audit logger. Until the workspace transactor adapter lands the
  // stub deleteExpired returns no rows, so this path is dead code in
  // production. We still ship the JSON-log version so the contract
  // is exercised in dev/test environments where a fake adapter is
  // injected.
  console.log(JSON.stringify({
    component: 'wac-expired-grant-pruner',
    level: 'info',
    msg: 'grant_expired',
    workspace: row.workspace,
    recipient: row.recipientUuid,
    resource: row.resourceId,
    resource_class: row.resourceClass,
    expired_at: row.expiresAt
  }))
}

/**
 * Start the time-bounded grants prune loop. Call once during
 * account-service boot. The returned handle's `stop()` is invoked
 * by the existing `close()` path on shutdown so the timer doesn't
 * outlive the HTTP server.
 */
export function startWacExpiredGrantPruner (opts: WacGrantPrunerOptions = {}): ExpiredGrantPrunerHandle {
  const deps: ExpiredGrantPrunerDeps = {
    deleteExpired: opts.deleteExpired ?? (async () => []),
    writeAudit: opts.writeAudit ?? defaultWriteAudit,
    log: opts.log ?? defaultLog
  }
  return startExpiredGrantPruner(deps, opts.intervalMs ?? DEFAULT_PRUNE_INTERVAL_MS)
}
