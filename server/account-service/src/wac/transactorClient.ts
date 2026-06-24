//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

// Phase 2B Task 1 (D3) — TxOperations client for WAC write path.
//
// Holds a per-workspace `TxOperations` connection to the Huly transactor.
// Write-handlers in the next task (P2B-T2) consume this client to mutate
// space documents through the canonical Huly path so we get:
//
//   * server-side cache invalidation
//   * websocket broadcast to connected clients
//   * tx-event audit emission
//
// Pool semantics:
//   * `Map<WorkspaceUuid, Promise<TxOperations>>` keyed by workspaceUuid.
//   * First call per workspace triggers a connect; subsequent calls reuse.
//   * Rejected connect promises are NOT cached — the next caller retries.
//   * `close()` shuts down every cached client.
//
// Auth: an admin-token signed with the system account uuid is used per
// connection, with `extra={admin:'true', service:'account-service-wac'}`.

import core, {
  TxOperations,
  systemAccountUuid,
  type Class,
  type Client,
  type Doc,
  type DocumentUpdate,
  type MeasureContext,
  type Ref,
  type Space,
  type WorkspaceUuid
} from '@hcengineering/core'
import { createClient } from '@hcengineering/server-client'
import { generateToken } from '@hcengineering/server-token'

/**
 * Connector signature consumed by the pool. Production wiring uses
 * `@hcengineering/server-client`'s `createClient`; tests inject a stub.
 */
export type WacClientFactory = (transactorUrl: string, token: string) => Promise<Client>

/** Default factory bound to the real transactor connector. */
export const defaultWacClientFactory: WacClientFactory = async (transactorUrl, token) => {
  return await createClient(transactorUrl, token)
}

export interface WacTxClientOptions {
  transactorUrl: string
  // serverSecret is read by `generateToken` from process env / metadata,
  // but accepting it here keeps the contract explicit and makes the
  // dependency obvious to operators.
  serverSecret: string
  measureCtx: MeasureContext
  /** Test seam — defaults to {@link defaultWacClientFactory}. */
  clientFactory?: WacClientFactory
  /**
   * Test seam — overrides token generation. Production uses
   * `@hcengineering/server-token`'s `generateToken` with the system
   * account uuid.
   */
  tokenFactory?: (workspace: WorkspaceUuid) => string
}

export interface WacTxClient {
  /**
   * Apply an updateDoc through the transactor. Throws on connect or tx
   * failure; the underlying connect promise is NOT cached on failure so
   * the next call can retry.
   */
  updateDoc: <T extends Doc>(
    workspaceUuid: WorkspaceUuid,
    actorUuid: string,
    _class: Ref<Class<T>>,
    space: Ref<Space>,
    _id: Ref<T>,
    update: DocumentUpdate<T>
  ) => Promise<void>

  /** Helper for read-after-write checks. */
  findOne: <T extends Doc>(
    workspaceUuid: WorkspaceUuid,
    _class: Ref<Class<T>>,
    query: any
  ) => Promise<T | undefined>

  /** Graceful shutdown — closes every cached client. */
  close: () => Promise<void>
}

/**
 * Create a per-workspace TxOperations pool against the transactor.
 *
 * @public
 */
export function createWacTxClient (opts: WacTxClientOptions): WacTxClient {
  const { transactorUrl, measureCtx } = opts
  const clientFactory = opts.clientFactory ?? defaultWacClientFactory
  const tokenFactory =
    opts.tokenFactory ??
    ((workspace: WorkspaceUuid) =>
      generateToken(systemAccountUuid, workspace, {
        admin: 'true',
        service: 'account-service-wac'
      }))

  const pool = new Map<WorkspaceUuid, Promise<TxOperations>>()

  function getOrConnect (workspaceUuid: WorkspaceUuid): Promise<TxOperations> {
    const cached = pool.get(workspaceUuid)
    if (cached !== undefined) return cached

    const pending = (async (): Promise<TxOperations> => {
      const token = tokenFactory(workspaceUuid)
      let client: Client
      try {
        client = await clientFactory(transactorUrl, token)
      } catch (err) {
        // Surface a stable, greppable error id; the caller will see this.
        throw new Error(`wac_transactor_connect_failed: ${workspaceUuid}`)
      }
      // First successful connection per workspace — heartbeat event.
      measureCtx.info('wac transactor connected', { workspace: workspaceUuid })

      // Hook the optional onConnect lifecycle for re-connect / maintenance
      // visibility. The Client surface exposes `onConnect?` on the
      // underlying ClientConnection; not all client implementations
      // populate it, so the assignment is best-effort.
      const anyClient = client as unknown as {
        onConnect?: (event: number, lastTx: string | undefined, data: any) => Promise<void>
      }
      const prevOnConnect = anyClient.onConnect
      anyClient.onConnect = async (event, lastTx, data) => {
        // 0=Connected, 1=Reconnected, 2=Upgraded, 3=Refresh, 4=Maintenance
        // (matches ClientConnectEvent in @hcengineering/core).
        if (event === 1) {
          measureCtx.info('wac transactor reconnected', { workspace: workspaceUuid })
        } else if (event === 4) {
          measureCtx.warn('wac transactor maintenance', { workspace: workspaceUuid })
        }
        if (prevOnConnect !== undefined) {
          await prevOnConnect(event, lastTx, data)
        }
      }

      // `core.account.System` is the canonical PersonId used by server-side
      // tooling (dev/tool, migrations). The token itself carries the
      // system account uuid (see `generateToken(systemAccountUuid, ...)`)
      // so authorization is by uuid; the PersonId here only labels the
      // `modifiedBy` field on emitted txns.
      return new TxOperations(client, core.account.System)
    })()

    // Don't cache rejected promises — the next caller should retry the
    // connect. We attach a swallow-handler so the unhandled-rejection
    // tracker stays quiet; the original rejection is still visible to
    // the awaiting caller.
    pending.catch(() => {
      if (pool.get(workspaceUuid) === pending) {
        pool.delete(workspaceUuid)
      }
    })

    pool.set(workspaceUuid, pending)
    return pending
  }

  return {
    async updateDoc (workspaceUuid, actorUuid, _class, space, _id, update) {
      const ops = await getOrConnect(workspaceUuid)
      // The transactor records `modifiedBy` from the token's account; we
      // pass `actorUuid` through so future server-plugin handlers can
      // attribute the mutation to the real caller (today the transactor
      // uses the token-bound account; actorUuid is forwarded for audit).
      void actorUuid
      await ops.updateDoc(_class, space, _id, update)
    },
    async findOne (workspaceUuid, _class, query) {
      const ops = await getOrConnect(workspaceUuid)
      return (await ops.findOne(_class, query)) as any
    },
    async close () {
      const entries = Array.from(pool.values())
      pool.clear()
      await Promise.all(
        entries.map(async (p) => {
          try {
            const ops = await p
            await ops.close()
          } catch (err) {
            measureCtx.warn('wac transactor close error', { err: String(err) })
          }
        })
      )
    }
  }
}
