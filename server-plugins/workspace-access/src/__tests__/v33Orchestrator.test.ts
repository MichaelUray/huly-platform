import { v33BackfillWorkspace, MAX_RETRIES, type BackfillDeps, type BackfillRow } from '../backfill/v33Orchestrator'

function makeDeps (overrides: Partial<BackfillDeps> = {}, runs: Map<string, BackfillRow> = new Map()): BackfillDeps & { runs: Map<string, BackfillRow>, written: any[][] } {
  const written: any[][] = []
  let counter = 0
  const base: BackfillDeps = {
    getOrCreateRun: async (workspace) => {
      const existing = runs.get(workspace)
      if (existing != null) return existing
      const fresh: BackfillRow = { id: `r${counter++}`, workspace, state: 'running', last_cursor: null, retry_count: 0 }
      runs.set(workspace, fresh)
      return fresh
    },
    updateRun: async (id, patch) => {
      for (const row of runs.values()) {
        if (row.id === id) {
          Object.assign(row, patch)
        }
      }
    },
    fetchNextBatch: async () => ({ items: [], nextCursor: null }),
    writeEntries: async (_ws, items) => {
      written.push(items)
    },
    uuid: () => `b${counter++}`,
    now: () => 1
  }
  return { ...base, ...overrides, runs, written }
}

describe('v33BackfillWorkspace', () => {
  it('returns immediately when run already completed', async () => {
    const runs = new Map<string, BackfillRow>([['ws1', { id: 'r1', workspace: 'ws1', state: 'completed', last_cursor: null, retry_count: 0 }]])
    const d = makeDeps({}, runs)
    const res = await v33BackfillWorkspace(d, 'ws1')
    expect(res.finalState).toBe('completed')
    expect(d.written.length).toBe(0)
  })

  it('returns paused state without progressing', async () => {
    const runs = new Map<string, BackfillRow>([['ws1', { id: 'r1', workspace: 'ws1', state: 'paused', last_cursor: 'c5', retry_count: 0 }]])
    const d = makeDeps({}, runs)
    const res = await v33BackfillWorkspace(d, 'ws1')
    expect(res.finalState).toBe('paused')
  })

  it('walks batches until exhausted', async () => {
    let batchN = 0
    const d = makeDeps({
      fetchNextBatch: async () => {
        batchN++
        if (batchN === 1) return { items: [{ action: 'member_added', actor: 'u1', actor_role: 'system' }], nextCursor: 'c1' }
        if (batchN === 2) return { items: [{ action: 'space_archived', actor: null, actor_role: 'system' }], nextCursor: null }
        return { items: [], nextCursor: null }
      }
    })
    const res = await v33BackfillWorkspace(d, 'ws1')
    expect(res.finalState).toBe('completed')
    expect(d.written.length).toBe(2)
  })

  it('gives up after MAX_RETRIES failures', async () => {
    const runs = new Map<string, BackfillRow>([
      ['ws1', { id: 'r1', workspace: 'ws1', state: 'failed', last_cursor: null, retry_count: MAX_RETRIES }]
    ])
    const d = makeDeps({}, runs)
    const res = await v33BackfillWorkspace(d, 'ws1')
    expect(res.finalState).toBe('failed')
    expect(d.written.length).toBe(0)
  })

  it('records failure_reason + bumps retry_count on error', async () => {
    const d = makeDeps({
      fetchNextBatch: async () => {
        throw new Error('boom')
      }
    })
    await expect(v33BackfillWorkspace(d, 'ws1')).rejects.toThrow('boom')
    const row = d.runs.get('ws1')!
    expect(row.state).toBe('failed')
    expect(row.retry_count).toBe(1)
  })
})
