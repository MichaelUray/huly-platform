//
// Copyright © 2026 Hardcore Engineering Inc.
//

// Dedicated suite for the Redis fail-open path. Kept in its own file
// so we can mock `ioredis` with a throwing stub at the module level —
// the sibling redisRateLimiter.test.ts mocks it as ioredis-mock for
// happy-path coverage and the two factories cannot share a process.

jest.mock('ioredis', () => {
  return class FakeRedis {
    on (): void {
      /* no-op */
    }
    async eval (): Promise<number> {
      throw new Error('connection refused')
    }
    async quit (): Promise<void> {
      /* no-op */
    }
    disconnect (): void {
      /* no-op */
    }
  }
})

import { createRateLimiter, type RateLimiter } from '../util/redisRateLimiter'

describe('redisRateLimiter — fail-open on Redis EVAL error', () => {
  it('returns true (allows) and logs an error when eval throws', async () => {
    const errors: Array<{ msg: string, attrs?: any }> = []
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: (msg: string, attrs?: any): void => {
        errors.push({ msg, attrs })
      }
    }
    const limiter: RateLimiter = createRateLimiter({
      redisUrl: 'redis://broken',
      logger
    })
    try {
      const allowed = await limiter.check('any-key', 1, 1000)
      expect(allowed).toBe(true)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].msg).toContain('failing open')
      // Tolerant of additional context keys, but `key` must be there.
      expect(errors[0].attrs?.key).toBe('any-key')
    } finally {
      await limiter.close?.()
    }
  })
})
