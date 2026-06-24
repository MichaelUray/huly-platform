//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

// Phase 2B Task 1 (D3) — pool semantics for the WAC TxOperations client.
//
// Covers the four scenarios laid out in the task brief:
//
//   1. Pool reuse        — two updateDoc calls for WS_A share one connect.
//   2. Per-workspace     — WS_A and WS_B trigger two separate connects.
//   3. Connect failure   — first attempt rejects, next call retries.
//   4. close()           — all cached clients receive close().

import { createWacTxClient, type WacClientFactory } from '../wac/transactorClient'

// v4-shaped UUIDs to satisfy any downstream uuid.validate checks.
const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as any
const WS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as any
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

// Minimal Doc shape used by the brief's updateDoc signature. We don't
// touch real Huly classes — the mock client records the call.
type MinimalDoc = any
const CLASS_REF: any = 'test:class:Space'
const SPACE_REF: any = 'test:space:Workspace'

function makeMeasureCtx (): any {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}

interface MockClient {
  updateDocCalls: Array<{ _class: any, space: any, _id: any, update: any, modifiedBy: any }>
  findOneCalls: Array<{ _class: any, query: any }>
  closeCalls: number
}

function makeMockClient (): { mock: MockClient, client: any } {
  const mock: MockClient = {
    updateDocCalls: [],
    findOneCalls: [],
    closeCalls: 0
  }
  // The TxOperations constructor calls into the client via `tx()` for
  // updateDoc. Stubbing `tx` is enough to satisfy `updateDoc`.
  const client: any = {
    tx: jest.fn(async (tx: any) => {
      // The TxFactory builds a TxUpdateDoc with objectClass/objectSpace
      // /objectId/operations. Record those so the test can assert.
      // modifiedBy is taken from the TxOperations `user` field — H1
      // assert that the caller's actorUuid is threaded into the tx.
      mock.updateDocCalls.push({
        _class: tx.objectClass,
        space: tx.objectSpace,
        _id: tx.objectId,
        update: tx.operations,
        modifiedBy: tx.modifiedBy
      })
      return {}
    }),
    findOne: jest.fn(async (_class: any, query: any) => {
      mock.findOneCalls.push({ _class, query })
      return undefined
    }),
    findAll: jest.fn(async () => []),
    close: jest.fn(async () => {
      mock.closeCalls += 1
    }),
    getHierarchy: jest.fn(() => ({})),
    getModel: jest.fn(() => ({}))
  }
  return { mock, client }
}

describe('createWacTxClient', () => {
  it('1. reuses a single connection across multiple calls per workspace', async () => {
    const { client } = makeMockClient()
    const factory: WacClientFactory = jest.fn(async () => client) as any

    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx: makeMeasureCtx(),
      clientFactory: factory,
      tokenFactory: () => 'token-A'
    })

    await txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { foo: 'bar' } as any)
    await txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-2' as any, { foo: 'baz' } as any)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith('ws://transactor.test', 'token-A')
  })

  it('2. opens separate connections per workspace', async () => {
    const a = makeMockClient()
    const b = makeMockClient()
    const factory: WacClientFactory = jest
      .fn()
      .mockResolvedValueOnce(a.client)
      .mockResolvedValueOnce(b.client) as any

    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx: makeMeasureCtx(),
      clientFactory: factory,
      tokenFactory: (ws) => `token-${ws}`
    })

    await txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { x: 1 } as any)
    await txc.updateDoc<MinimalDoc>(WS_B, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { x: 1 } as any)

    expect(factory).toHaveBeenCalledTimes(2)
    expect((factory as jest.Mock).mock.calls[0][1]).toContain(WS_A)
    expect((factory as jest.Mock).mock.calls[1][1]).toContain(WS_B)
    expect(a.mock.updateDocCalls).toHaveLength(1)
    expect(b.mock.updateDocCalls).toHaveLength(1)
  })

  it('3. surfaces connect failure and does NOT cache the rejection', async () => {
    const { client } = makeMockClient()
    const factory: WacClientFactory = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(client) as any

    const measureCtx = makeMeasureCtx()
    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx,
      clientFactory: factory,
      tokenFactory: () => 'token-A'
    })

    await expect(
      txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { x: 1 } as any)
    ).rejects.toThrow(`wac_transactor_connect_failed: ${WS_A}`)

    // Second call must retry the factory rather than re-surface the cached
    // rejection.
    await txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-2' as any, { x: 2 } as any)

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('4. close() shuts down every cached client', async () => {
    const a = makeMockClient()
    const b = makeMockClient()
    const factory: WacClientFactory = jest
      .fn()
      .mockResolvedValueOnce(a.client)
      .mockResolvedValueOnce(b.client) as any

    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx: makeMeasureCtx(),
      clientFactory: factory,
      tokenFactory: (ws) => `token-${ws}`
    })

    await txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { x: 1 } as any)
    await txc.updateDoc<MinimalDoc>(WS_B, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { x: 1 } as any)

    await txc.close()

    expect(a.mock.closeCalls).toBe(1)
    expect(b.mock.closeCalls).toBe(1)
  })

  it('logs a heartbeat event on first successful connect', async () => {
    const { client } = makeMockClient()
    const factory: WacClientFactory = jest.fn(async () => client) as any
    const measureCtx = makeMeasureCtx()

    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx,
      clientFactory: factory,
      tokenFactory: () => 'token-A'
    })

    await txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { x: 1 } as any)

    expect(measureCtx.info).toHaveBeenCalledWith('wac transactor connected', { workspace: WS_A })
  })

  it('findOne routes through the cached client', async () => {
    const { mock, client } = makeMockClient()
    const factory: WacClientFactory = jest.fn(async () => client) as any

    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx: makeMeasureCtx(),
      clientFactory: factory,
      tokenFactory: () => 'token-A'
    })

    await txc.findOne<MinimalDoc>(WS_A, CLASS_REF, { _id: 'doc-1' })
    expect(mock.findOneCalls).toEqual([{ _class: CLASS_REF, query: { _id: 'doc-1' } }])
  })

  // H1 — TxOperations was historically constructed once per workspace with
  // `core.account.System` as the PersonId. As a result every emitted Tx had
  // `modifiedBy = System`, dropping the caller's UUID on the floor (the
  // `void actorUuid` line in the pre-fix code). The fix wraps the pooled
  // Client with a fresh `new TxOperations(client, actorUuid)` per write.
  it('H1: updateDoc threads actorUuid into the emitted Tx.modifiedBy', async () => {
    const { mock, client } = makeMockClient()
    const factory: WacClientFactory = jest.fn(async () => client) as any
    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx: makeMeasureCtx(),
      clientFactory: factory,
      tokenFactory: () => 'token-A'
    })

    await txc.updateDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any, { foo: 'bar' } as any)
    expect(mock.updateDocCalls).toHaveLength(1)
    expect(mock.updateDocCalls[0].modifiedBy).toBe(ACTOR)

    // Different caller on the SAME workspace must bind to the new actor —
    // proves we're not reusing a stale TxOperations.user.
    const otherActor = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    await txc.updateDoc<MinimalDoc>(WS_A, otherActor, CLASS_REF, SPACE_REF, 'doc-2' as any, { foo: 'baz' } as any)
    expect(mock.updateDocCalls).toHaveLength(2)
    expect(mock.updateDocCalls[1].modifiedBy).toBe(otherActor)
    // Both writes shared the single pooled connection.
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('H1: removeDoc threads actorUuid into the emitted Tx.modifiedBy', async () => {
    const { mock, client } = makeMockClient()
    // removeDoc also goes through client.tx — extend the mock recorder.
    const origTx = client.tx
    client.tx = jest.fn(async (tx: any) => {
      mock.updateDocCalls.push({
        _class: tx.objectClass,
        space: tx.objectSpace,
        _id: tx.objectId,
        update: { _removed: true },
        modifiedBy: tx.modifiedBy
      })
      return await origTx(tx)
    }) as any
    const factory: WacClientFactory = jest.fn(async () => client) as any
    const txc = createWacTxClient({
      transactorUrl: 'ws://transactor.test',
      serverSecret: 'secret',
      measureCtx: makeMeasureCtx(),
      clientFactory: factory,
      tokenFactory: () => 'token-A'
    })

    await txc.removeDoc<MinimalDoc>(WS_A, ACTOR, CLASS_REF, SPACE_REF, 'doc-1' as any)
    const lastCall = mock.updateDocCalls[mock.updateDocCalls.length - 1]
    expect(lastCall.modifiedBy).toBe(ACTOR)
  })
})
