//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wave 5 D — unit tests for the pure summarizer used by ResourceBulkBar.
// The .svelte component is not yet exercised by @testing-library here;
// keeping the counting logic out of the .svelte file lets us cover the
// shape contract end-to-end in jest.
//

import {
  summarizeResourceBulkResult,
  type ResourceBulkResult
} from '../api/resourcesBulkApi'

describe('summarizeResourceBulkResult', () => {
  it('all-ok: failed=0, byStatus.ok===total, failures empty', () => {
    const result: ResourceBulkResult = {
      batch_id: 'b1',
      applied: 3,
      results: [
        { spaceId: 's1', status: 'ok' },
        { spaceId: 's2', status: 'ok' },
        { spaceId: 's3', status: 'ok' }
      ]
    }
    const s = summarizeResourceBulkResult(result)
    expect(s.total).toBe(3)
    expect(s.applied).toBe(3)
    expect(s.failed).toBe(0)
    expect(s.byStatus.ok).toBe(3)
    expect(s.failures).toHaveLength(0)
  })

  it('mixed: not_found + internal counted under their buckets', () => {
    const result: ResourceBulkResult = {
      batch_id: 'b2',
      applied: 1,
      results: [
        { spaceId: 's1', status: 'ok' },
        { spaceId: 's2', status: 'not_found' },
        { spaceId: 's3', status: 'internal', detail: 'write_failed' }
      ]
    }
    const s = summarizeResourceBulkResult(result)
    expect(s.total).toBe(3)
    expect(s.applied).toBe(1)
    expect(s.failed).toBe(2)
    expect(s.byStatus.ok).toBe(1)
    expect(s.byStatus.not_found).toBe(1)
    expect(s.byStatus.internal).toBe(1)
    expect(s.byStatus.forbidden).toBe(0)
    expect(s.failures).toEqual([
      { spaceId: 's2', status: 'not_found' },
      { spaceId: 's3', status: 'internal', detail: 'write_failed' }
    ])
  })

  it('forward-compat: unknown status falls into internal bucket', () => {
    const result: ResourceBulkResult = {
      batch_id: 'b3',
      applied: 0,
      results: [
        // Force-cast to simulate a server that grew a new status enum
        // value before the client picked it up.
        { spaceId: 's1', status: 'soft_failed' as any }
      ]
    }
    const s = summarizeResourceBulkResult(result)
    expect(s.applied).toBe(0)
    expect(s.byStatus.internal).toBe(1)
    expect(s.failures).toHaveLength(1)
  })

  it('all-failed: applied=0, failed=total, failures lists every row', () => {
    const result: ResourceBulkResult = {
      batch_id: 'b4',
      applied: 0,
      results: [
        { spaceId: 's1', status: 'not_found' },
        { spaceId: 's2', status: 'forbidden' }
      ]
    }
    const s = summarizeResourceBulkResult(result)
    expect(s.applied).toBe(0)
    expect(s.failed).toBe(2)
    expect(s.failures).toHaveLength(2)
  })

  it('empty result-set returns zeros', () => {
    const s = summarizeResourceBulkResult({ batch_id: 'b5', applied: 0, results: [] })
    expect(s.total).toBe(0)
    expect(s.applied).toBe(0)
    expect(s.failed).toBe(0)
    expect(s.failures).toHaveLength(0)
  })
})
