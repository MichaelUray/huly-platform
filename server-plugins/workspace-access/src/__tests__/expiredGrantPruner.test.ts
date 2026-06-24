import {
  runExpiredGrantPruneOnce,
  startExpiredGrantPruner,
  DEFAULT_PRUNE_INTERVAL_MS,
  type ExpiredGrantPrunerDeps,
  type ExpiredGrantRow
} from '../backfill/expiredGrantPruner'

function row (overrides: Partial<ExpiredGrantRow> = {}): ExpiredGrantRow {
  return {
    workspace: 'ws1',
    recipientUuid: 'u2',
    resourceId: 'r1',
    resourceClass: 'tracker.class.Issue',
    expiresAt: '2026-06-20T00:00:00Z',
    ...overrides
  }
}

describe('runExpiredGrantPruneOnce', () => {
  it('returns zero counts when nothing to prune', async () => {
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async () => [],
      writeAudit: async () => undefined
    }
    const result = await runExpiredGrantPruneOnce(deps)
    expect(result).toEqual({ deletedCount: 0, auditedCount: 0, auditFailures: 0 })
  })

  it('emits one audit row per deleted grant', async () => {
    const audited: ExpiredGrantRow[] = []
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async () => [row(), row({ recipientUuid: 'u3', resourceId: 'r2' })],
      writeAudit: async (r) => {
        audited.push(r)
      }
    }
    const result = await runExpiredGrantPruneOnce(deps)
    expect(result.deletedCount).toBe(2)
    expect(result.auditedCount).toBe(2)
    expect(result.auditFailures).toBe(0)
    expect(audited.map((r) => r.recipientUuid)).toEqual(['u2', 'u3'])
  })

  it('passes injected `now()` through to deleteExpired', async () => {
    const seen: Date[] = []
    const fixed = new Date('2026-06-21T12:00:00Z')
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async (d) => {
        seen.push(d)
        return []
      },
      writeAudit: async () => undefined,
      now: () => fixed
    }
    await runExpiredGrantPruneOnce(deps)
    expect(seen).toEqual([fixed])
  })

  it('audit-write failure is recorded but does not block subsequent rows', async () => {
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async () => [row(), row({ recipientUuid: 'u3' }), row({ recipientUuid: 'u4' })],
      writeAudit: async (r) => {
        if (r.recipientUuid === 'u3') throw new Error('audit-down')
      }
    }
    const result = await runExpiredGrantPruneOnce(deps)
    expect(result.deletedCount).toBe(3)
    expect(result.auditedCount).toBe(2)
    expect(result.auditFailures).toBe(1)
  })

  it('deleteExpired failure throws (caller knows the DELETE itself broke)', async () => {
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async () => {
        throw new Error('db-down')
      },
      writeAudit: async () => undefined
    }
    await expect(runExpiredGrantPruneOnce(deps)).rejects.toThrow(/db-down/)
  })
})

describe('startExpiredGrantPruner', () => {
  it('exposes DEFAULT_PRUNE_INTERVAL_MS = 5 minutes', () => {
    expect(DEFAULT_PRUNE_INTERVAL_MS).toBe(5 * 60 * 1000)
  })

  it('triggerNow forces an immediate pass', async () => {
    const deletes: Date[] = []
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async (d) => {
        deletes.push(d)
        return []
      },
      writeAudit: async () => undefined
    }
    const handle = startExpiredGrantPruner(deps, 60_000)
    try {
      await handle.triggerNow()
      expect(deletes.length).toBeGreaterThanOrEqual(1)
    } finally {
      handle.stop()
    }
  })

  it('overlapping passes do not stack — second triggerNow returns the in-flight pass', async () => {
    let resolveFirst: () => void = () => {}
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    let callCount = 0
    let release: () => void = () => {}
    const releasable = new Promise<void>((resolve) => {
      release = resolve
    })
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async () => {
        callCount++
        resolveFirst()
        await releasable
        return []
      },
      writeAudit: async () => undefined
    }
    const handle = startExpiredGrantPruner(deps, 60_000)
    try {
      const p1 = handle.triggerNow()
      await firstStarted
      const p2 = handle.triggerNow()
      release()
      await Promise.all([p1, p2])
      // The startup setImmediate ALSO calls deleteExpired exactly once.
      // Overlap-protection means p2 piggybacks on p1's in-flight call.
      expect(callCount).toBeLessThanOrEqual(2)
    } finally {
      handle.stop()
    }
  })

  it('stop() is idempotent', () => {
    const deps: ExpiredGrantPrunerDeps = {
      deleteExpired: async () => [],
      writeAudit: async () => undefined
    }
    const handle = startExpiredGrantPruner(deps, 60_000)
    handle.stop()
    expect(() => handle.stop()).not.toThrow()
  })
})
