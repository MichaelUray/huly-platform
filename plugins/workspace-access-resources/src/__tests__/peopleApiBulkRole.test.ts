//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wave 5 Task C1 — bulk-role client/server type alignment.
//
// Server emits {batch_id, appliedCount, results[]} with a per-target
// outcome (see server-plugins/workspace-access/src/http/writeRouter.ts
// handleBulkMemberRole). The client used to type the response as
// {batch_id, affected}, which silently swallowed partial failures.
//
// These tests pin down:
//   1. `peopleApi.bulkChangeRole` POSTs the canonical body shape AND
//      returns the new {batch_id, appliedCount, results[]} contract
//      verbatim (no transformation/loss).
//   2. `summarizeBulkRoleResult` correctly buckets statuses for the
//      consumer UI (PeopleBulkBar), including the all-failed and the
//      forward-compat-unknown-status edge cases.
//

import { setDefaultWacClient, WacClient } from '../api/wacClient'
import {
  peopleApi,
  summarizeBulkRoleResult,
  type BulkRoleResult
} from '../api/peopleApi'

describe('peopleApi.bulkChangeRole — wire contract', () => {
  const originalFetch = (globalThis as any).fetch

  afterEach(() => {
    ;(globalThis as any).fetch = originalFetch
  })

  it('POSTs {members, role} and returns the per-target outcome array', async () => {
    const captured: Array<{ url: string, init: RequestInit }> = []
    const serverResponse: BulkRoleResult = {
      batch_id: 'b1719500000000',
      appliedCount: 3,
      results: [
        { memberUuid: 'u-1', status: 'ok' },
        { memberUuid: 'u-2', status: 'ok' },
        { memberUuid: 'u-3', status: 'ok' },
        { memberUuid: 'u-4', status: 'last_owner_refused' },
        { memberUuid: 'u-5', status: 'internal', detail: 'write_failed' }
      ]
    }
    ;(globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
      captured.push({ url, init })
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json () { return serverResponse },
        async text () { return JSON.stringify(serverResponse) },
        headers: new Headers({ 'content-type': 'application/json' })
      }
    })

    setDefaultWacClient(
      new WacClient({
        baseUrl: 'https://example.test/api/wac',
        getToken: () => 'tok-abc'
      })
    )

    const out = await peopleApi.bulkChangeRole('ws-xyz', ['u-1', 'u-2', 'u-3', 'u-4', 'u-5'], 'USER')

    // 1) Wire shape preserved verbatim — no client-side reshaping.
    expect(out).toEqual(serverResponse)
    expect(out.batch_id).toBe('b1719500000000')
    expect(out.appliedCount).toBe(3)
    expect(out.results).toHaveLength(5)

    // 2) Request hit the canonical endpoint with the canonical body.
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://example.test/api/wac/ws-xyz/members/bulk/role')
    expect(captured[0].init.method).toBe('POST')
    const body = JSON.parse(String(captured[0].init.body))
    expect(body).toEqual({
      members: ['u-1', 'u-2', 'u-3', 'u-4', 'u-5'],
      role: 'USER'
    })
  })
})

describe('summarizeBulkRoleResult — UI-facing reduce', () => {
  it('buckets a mixed result (3 ok + 1 last_owner_refused + 1 internal)', () => {
    const result: BulkRoleResult = {
      batch_id: 'b1',
      appliedCount: 3,
      results: [
        { memberUuid: 'a', status: 'ok' },
        { memberUuid: 'b', status: 'ok' },
        { memberUuid: 'c', status: 'ok' },
        { memberUuid: 'd', status: 'last_owner_refused' },
        { memberUuid: 'e', status: 'internal', detail: 'write_failed' }
      ]
    }
    const s = summarizeBulkRoleResult(result)
    expect(s.total).toBe(5)
    expect(s.applied).toBe(3)
    expect(s.failed).toBe(2)
    expect(s.byStatus.ok).toBe(3)
    expect(s.byStatus.last_owner_refused).toBe(1)
    expect(s.byStatus.internal).toBe(1)
    expect(s.byStatus.forbidden).toBe(0)
    expect(s.byStatus.not_found).toBe(0)
    // The failure list is exactly the non-ok rows, preserving per-row
    // detail so the UI can show it.
    expect(s.failures).toEqual([
      { memberUuid: 'd', status: 'last_owner_refused' },
      { memberUuid: 'e', status: 'internal', detail: 'write_failed' }
    ])
  })

  it('all-ok input: zero failures, applied === total', () => {
    const s = summarizeBulkRoleResult({
      batch_id: 'b2',
      appliedCount: 2,
      results: [
        { memberUuid: 'x', status: 'ok' },
        { memberUuid: 'y', status: 'ok' }
      ]
    })
    expect(s.applied).toBe(2)
    expect(s.failed).toBe(0)
    expect(s.failures).toHaveLength(0)
  })

  it('all-failed input: applied=0, every row in failures[]', () => {
    const s = summarizeBulkRoleResult({
      batch_id: 'b3',
      appliedCount: 0,
      results: [
        { memberUuid: 'p', status: 'not_found' },
        { memberUuid: 'q', status: 'forbidden' }
      ]
    })
    expect(s.applied).toBe(0)
    expect(s.failed).toBe(2)
    expect(s.failures).toHaveLength(2)
  })

  it('empty results: zeroes all the way down', () => {
    const s = summarizeBulkRoleResult({ batch_id: 'b4', appliedCount: 0, results: [] })
    expect(s).toEqual({
      total: 0,
      applied: 0,
      failed: 0,
      byStatus: {
        ok: 0,
        last_owner_refused: 0,
        forbidden: 0,
        not_found: 0,
        internal: 0
      },
      failures: []
    })
  })

  it('forward-compat: an unknown status is bucketed as internal failure', () => {
    // If the server ever ships a new status before the client knows
    // about it, the operator must still see "something went wrong"
    // rather than a silent success.
    const s = summarizeBulkRoleResult({
      batch_id: 'b5',
      appliedCount: 1,
      results: [
        { memberUuid: 'a', status: 'ok' },
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        { memberUuid: 'b', status: 'some_new_status' as any, detail: 'future' }
      ]
    })
    expect(s.applied).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.byStatus.internal).toBe(1)
    expect(s.failures).toHaveLength(1)
    expect(s.failures[0].memberUuid).toBe('b')
  })
})
