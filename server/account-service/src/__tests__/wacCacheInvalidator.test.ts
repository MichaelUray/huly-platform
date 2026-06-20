//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 2B Task 5 (E2) — tests for the WAC cache invalidator.
//
// Pinned contracts:
//   1. happy path: invalidator updates the workspace-level Space doc
//      with `lastRoleInvalidationAt` + `lastRoleInvalidationFor`.
//   2. failure path: txClient.updateDoc throws → invalidator logs a
//      'wac_cache_invalidation_failed' warn breadcrumb and resolves
//      (no propagation — the brief calls this best-effort).
//   3. system actor is overridable for tests / alternative wirings.

import core from '@hcengineering/core'

import {
  createWacCacheInvalidator,
  noopWacCacheInvalidator
} from '../wac/cacheInvalidator'
import type { WacTxClient } from '../wac/transactorClient'

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as any
const ACCOUNT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function makeMeasureCtx (): any {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}

interface MockTxClient {
  client: WacTxClient
  updateDocCalls: Array<{ workspace: any, actor: string, _class: any, space: any, _id: any, update: any }>
  shouldThrow: { value: boolean }
}

function makeMockTx (): MockTxClient {
  const updateDocCalls: any[] = []
  const shouldThrow = { value: false }
  const client: WacTxClient = {
    updateDoc: jest.fn(async (workspace, actor, _class, space, _id, update) => {
      if (shouldThrow.value) throw new Error('tx fail')
      updateDocCalls.push({ workspace, actor, _class, space, _id, update })
    }) as any,
    findOne: jest.fn(async () => undefined) as any,
    close: jest.fn(async () => {}) as any
  } as any
  return { client, updateDocCalls, shouldThrow }
}

describe('createWacCacheInvalidator (P2B-T5)', () => {
  it('writes a marker tx to the workspace-level Space doc', async () => {
    const tx = makeMockTx()
    const measureCtx = makeMeasureCtx()
    const inv = createWacCacheInvalidator({
      txClient: tx.client,
      measureCtx,
      now: () => 1700000000000
    })
    await inv.invalidateAccountInWorkspace(WS, ACCOUNT)
    expect(tx.updateDocCalls).toHaveLength(1)
    const call = tx.updateDocCalls[0]
    expect(call.workspace).toBe(WS)
    expect(call._class).toBe(core.class.Space)
    expect(call.space).toBe(core.space.Space)
    expect(call._id).toBe(core.space.Workspace)
    expect(call.update).toEqual({
      lastRoleInvalidationAt: 1700000000000,
      lastRoleInvalidationFor: ACCOUNT
    })
    // No warn breadcrumb on the happy path.
    expect(measureCtx.warn).not.toHaveBeenCalled()
  })

  it('swallows tx errors and logs wac_cache_invalidation_failed', async () => {
    const tx = makeMockTx()
    tx.shouldThrow.value = true
    const measureCtx = makeMeasureCtx()
    const inv = createWacCacheInvalidator({
      txClient: tx.client,
      measureCtx
    })
    // MUST NOT throw — contract is best-effort.
    await inv.invalidateAccountInWorkspace(WS, ACCOUNT)
    expect(measureCtx.warn).toHaveBeenCalledTimes(1)
    const attrs = (measureCtx.warn as jest.Mock).mock.calls[0][1]
    expect(attrs.breadcrumb).toBe('wac_cache_invalidation_failed')
    expect(attrs.workspace).toBe(WS)
    expect(attrs.account).toBe(ACCOUNT)
  })

  it('uses configurable systemActorUuid', async () => {
    const tx = makeMockTx()
    const inv = createWacCacheInvalidator({
      txClient: tx.client,
      measureCtx: makeMeasureCtx(),
      systemActorUuid: 'override-actor'
    })
    await inv.invalidateAccountInWorkspace(WS, ACCOUNT)
    expect(tx.updateDocCalls[0].actor).toBe('override-actor')
  })
})

describe('noopWacCacheInvalidator', () => {
  it('resolves with no side effects', async () => {
    await expect(noopWacCacheInvalidator.invalidateAccountInWorkspace(WS, ACCOUNT))
      .resolves.toBeUndefined()
  })
})
