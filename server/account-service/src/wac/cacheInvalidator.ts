//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 2B Task 5 (E2) — live cache-invalidation on workspace role change.
//
// Problem
// -------
// When account-service mutates `workspace_members.role` (single or bulk
// role change), affected live sessions in that workspace must drop their
// cached permissions immediately. TxOperations.updateDoc on a Doc
// already broadcasts the change to subscribed transactor clients (this
// is what covers space.members / space.owners), but the workspace-role
// table lives in account-db — the account-service has no native push
// channel to the workspace's live clients.
//
// Choice: Option (B) — TxOperations marker write
// ----------------------------------------------
// Two designs were considered:
//
//   (A) Account-service publishes a redpanda/Kafka message on a
//       canonical topic (e.g. `account.role.changed`) and the
//       transactor subscribes and broadcasts a Reconnect/Refresh
//       event to the affected account's WS connections.
//
//   (B) Account-service uses its existing WacTxClient to issue a
//       harmless TxOperations write against a workspace-level Doc
//       which the transactor naturally broadcasts to every connected
//       client of that workspace; clients refetch role state on the
//       next render.
//
// We picked (B) because:
//   * account-service does not currently depend on @hcengineering/kafka
//     and the transactor has no `account.role.changed` consumer wired.
//     Adding both for a single signal is significant infra.
//   * The WacTxClient (P2B-T1) is already in the dep graph for the
//     write-handlers — reusing it costs zero new dependencies.
//   * The signal is best-effort (E2 brief). If the marker write fails
//     we log a warn breadcrumb and continue; the role change has
//     already committed by the time the invalidator runs.
//
// Mechanism
// ---------
// We update the workspace-level Space doc (`core.space.Workspace`) with
// a transient `lastRoleInvalidationAt: <ms>` marker. The transactor
// broadcasts the TxUpdateDoc to every subscribed client; clients that
// observe the workspace-Space (the AccessCenterPage's role store, and
// any space-aware presence indicator) re-evaluate permissions on the
// next reactive tick.
//
// We DO NOT target the demoted account specifically — Option (A) could
// do that, but (B) only has the workspace-level broadcast handle.
// The fan-out is small (workspace member count) and the marker is a
// scalar; the cost is the cost of one extra Tx per role change.

import core, { type WorkspaceUuid, type Class, type Doc, type Ref, type Space } from '@hcengineering/core'

import type { WacTxClient } from './transactorClient'

/**
 * Best-effort cache invalidator surface consumed by the WAC write
 * handlers. The implementation in this file uses TxOperations against
 * the workspace-level Space to emit a Tx broadcast (Option (B)).
 *
 * Handlers call `invalidateAccountInWorkspace` AFTER a successful
 * role mutation but BEFORE the audit insert; the call returns a
 * resolved promise even on failure — failure is logged in the impl.
 *
 * @public
 */
export interface WacCacheInvalidator {
  /**
   * Signal live clients in `workspace` that account `accountUuid`'s
   * permissions changed. Best-effort: does not throw.
   */
  invalidateAccountInWorkspace: (workspace: WorkspaceUuid, accountUuid: string) => Promise<void>
}

/** Optional logger surface — kept minimal to match measureCtx usage. */
export interface WacCacheInvalidatorLogger {
  warn: (msg: string, attrs?: Record<string, unknown>) => void
}

export interface WacCacheInvalidatorOptions {
  txClient: WacTxClient
  measureCtx: WacCacheInvalidatorLogger
  /** Test seam — defaults to `Date.now`. */
  now?: () => number
  /** Test seam — defaults to the canonical system uuid. */
  systemActorUuid?: string
}

/**
 * Build the default Option (B) implementation. The implementation is
 * intentionally tolerant of error — every failure path logs once and
 * resolves, so the caller never has to wrap this in try/catch.
 *
 * @public
 */
export function createWacCacheInvalidator (opts: WacCacheInvalidatorOptions): WacCacheInvalidator {
  const { txClient, measureCtx } = opts
  const now = opts.now ?? (() => Date.now())
  const systemActorUuid = opts.systemActorUuid ?? 'wac-cache-invalidator'

  return {
    async invalidateAccountInWorkspace (workspace, accountUuid) {
      try {
        // Touch the workspace-level Space doc with a transient marker
        // field. Transactor broadcasts the TxUpdateDoc to every
        // subscribed client of `workspace`; observers of the workspace-
        // Space (role store, presence) re-evaluate permissions on the
        // next reactive tick. The field name carries the source so
        // downstream consumers can ignore it if they wish.
        const marker = {
          lastRoleInvalidationAt: now(),
          lastRoleInvalidationFor: accountUuid
        }
        await txClient.updateDoc(
          workspace,
          systemActorUuid,
          core.class.Space as Ref<Class<Doc>>,
          core.space.Space as Ref<Space>,
          core.space.Workspace as Ref<Doc>,
          marker as any
        )
      } catch (err) {
        // Best-effort: never throw. Log a warn breadcrumb so an
        // operator can grep `wac_cache_invalidation_failed` if a
        // user reports "permission cached too long".
        measureCtx.warn('wac cache-invalidation marker write failed', {
          breadcrumb: 'wac_cache_invalidation_failed',
          workspace,
          account: accountUuid,
          err: String(err)
        })
      }
    }
  }
}

/**
 * A no-op invalidator. Useful in tests and in non-production hosts
 * that don't want the marker-write side-effect.
 *
 * @public
 */
export const noopWacCacheInvalidator: WacCacheInvalidator = {
  async invalidateAccountInWorkspace () {
    // intentional no-op
  }
}
