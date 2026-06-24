//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { createRateLimiter, type RateLimiter } from '../util/redisRateLimiter'

// Route the `ioredis` import in redisRateLimiter.ts to ioredis-mock so
// `new Redis(url)` returns an in-memory implementation that supports
// EVAL with INCR + PEXPIRE.
jest.mock('ioredis', () => require('ioredis-mock'))

describe('redisRateLimiter — Redis backend (via ioredis-mock)', () => {
  // NOTE: ioredis-mock keeps a singleton in-memory store keyed by URL —
  // state from one test leaks into the next. We work around it by
  // namespacing every key with a per-test prefix.
  let limiter: RateLimiter
  let prefix: string
  let counter = 0
  beforeEach(() => {
    counter += 1
    prefix = `t${counter}:`
    limiter = createRateLimiter({ redisUrl: 'redis://mock' })
  })
  afterEach(async () => {
    await limiter.close?.()
  })

  it('allows first 5 requests, denies 6th (fixed window)', async () => {
    const k = `${prefix}fixed`
    for (let i = 0; i < 5; i++) {
      expect(await limiter.check(k, 5, 60_000)).toBe(true)
    }
    expect(await limiter.check(k, 5, 60_000)).toBe(false)
  })

  it('isolates keys', async () => {
    const k1 = `${prefix}iso-a`
    const k2 = `${prefix}iso-b`
    for (let i = 0; i < 5; i++) {
      await limiter.check(k1, 5, 60_000)
    }
    expect(await limiter.check(k1, 5, 60_000)).toBe(false)
    expect(await limiter.check(k2, 5, 60_000)).toBe(true)
  })

  it('handles concurrent INCR atomically', async () => {
    const k = `${prefix}race`
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => await limiter.check(k, 5, 60_000))
    )
    expect(results.filter((r) => r).length).toBe(5)
    expect(results.filter((r) => !r).length).toBe(5)
  })

  it('allows again after window expires (PEXPIRE-driven reset)', async () => {
    // Short windowMs so we can wait real time without slowing the
    // suite. ioredis-mock honours PEXPIRE TTLs.
    const k = `${prefix}expiring`
    for (let i = 0; i < 3; i++) {
      expect(await limiter.check(k, 3, 50)).toBe(true)
    }
    expect(await limiter.check(k, 3, 50)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(await limiter.check(k, 3, 50)).toBe(true)
  })
})

describe('redisRateLimiter — in-memory fallback', () => {
  it('is used when no redisUrl is provided', async () => {
    const limiter = createRateLimiter({})
    for (let i = 0; i < 5; i++) {
      expect(await limiter.check('mem-k', 5, 60_000)).toBe(true)
    }
    expect(await limiter.check('mem-k', 5, 60_000)).toBe(false)
  })

  it('isolates keys in memory', async () => {
    const limiter = createRateLimiter({})
    expect(await limiter.check('a', 1, 60_000)).toBe(true)
    expect(await limiter.check('a', 1, 60_000)).toBe(false)
    expect(await limiter.check('b', 1, 60_000)).toBe(true)
  })

  it('resets after window expires (real time)', async () => {
    const limiter = createRateLimiter({})
    expect(await limiter.check('exp', 1, 30)).toBe(true)
    expect(await limiter.check('exp', 1, 30)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await limiter.check('exp', 1, 30)).toBe(true)
  })

  it('emits a warn breadcrumb when no redisUrl is provided', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    createRateLimiter({ logger })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('process-local')
    )
  })
})
