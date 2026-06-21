//
// Copyright © 2026 Hardcore Engineering Inc.
//

import Redis from 'ioredis'

export interface RateLimiter {
  /** Returns true if allowed, false if rate-limit exceeded. */
  check: (key: string, max: number, windowMs: number) => Promise<boolean>
  close?: () => Promise<void>
}

export interface RateLimiterLogger {
  info: (msg: string, attrs?: Record<string, any>) => void
  warn: (msg: string, attrs?: Record<string, any>) => void
  error: (msg: string, attrs?: Record<string, any>) => void
}

export interface RateLimiterOpts {
  /** When set, use a Redis backend. When unset, in-memory fallback. */
  redisUrl?: string
  logger?: RateLimiterLogger
}

/**
 * Fixed-window rate-limiter. Uses Redis when REDIS_URL is set, otherwise
 * falls back to a process-local in-memory store (acceptable for dev/test;
 * documented D7 violation in production / multi-pod deployments).
 *
 * Wave 6 — Task B5. Replaces the standalone TokenBucketLimiter instances
 * for the admin and WAC CSV-export routes so the per-token cap is
 * enforced cluster-wide instead of per-pod.
 */
export function createRateLimiter (opts: RateLimiterOpts): RateLimiter {
  if (opts.redisUrl != null && opts.redisUrl !== '') {
    return makeRedisLimiter(opts.redisUrl, opts.logger)
  }
  opts.logger?.warn(
    'account-service rate-limiter: process-local — set REDIS_URL for horizontal scale (D7)'
  )
  return makeInMemoryLimiter()
}

// Lua script (fixed-window semantics):
//   INCR the bucket. If the counter is new (== 1), set the expiry.
//   Returns 1 if allowed, 0 if over the cap.
//
// Why Lua and not MULTI/INCR + EXPIRE? Codex amendment: a MULTI block
// that always re-EXPIREs would slide the window with every request
// (effectively sliding-window), masking sustained abuse. The fixed
// window we want is "first request opens a TTL-bound bucket; the next
// reset is only after that TTL elapses". Lua gives us the atomic
// "INCR then PEXPIRE iff new" we need.
const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if current <= tonumber(ARGV[1]) then
  return 1
else
  return 0
end
`

function makeRedisLimiter (url: string, logger?: RateLimiterLogger): RateLimiter {
  // Default ioredis options — eager connect at construction. ioredis
  // itself never throws synchronously on bad host; it emits 'error'
  // and retries with the built-in exponential backoff. A failing
  // connection therefore surfaces as an error log + a fail-open
  // allow() inside check() (see catch below), never as a boot crash.
  // maxRetriesPerRequest caps how long a single command will block
  // before we give up and fail-open — keeps the export endpoint snappy
  // when Redis is hard down.
  const redis = new Redis(url, { maxRetriesPerRequest: 2 })
  redis.on('error', (err) => {
    logger?.error('rate-limiter: redis error', { err: String(err) })
  })
  logger?.info('account-service rate-limiter: redis backend')

  return {
    async check (key: string, max: number, windowMs: number): Promise<boolean> {
      try {
        const result = (await redis.eval(
          FIXED_WINDOW_LUA,
          1,
          key,
          String(max),
          String(windowMs)
        )) as number
        return result === 1
      } catch (err) {
        // Redis unavailable: fail OPEN (allow). Better UX than
        // blocking the user on transient infra issues. The error is
        // logged so ops can correlate the breadcrumb with the alert.
        logger?.error('rate-limiter: check failed, failing open', {
          err: String(err),
          key
        })
        return true
      }
    },
    async close (): Promise<void> {
      try {
        await redis.quit()
      } catch {
        // Already closed / never connected — ignore.
        redis.disconnect()
      }
    }
  }
}

interface InMemoryBucket {
  count: number
  resetAt: number
}

function makeInMemoryLimiter (): RateLimiter {
  // Single-process fallback. Equivalent to the legacy TokenBucketLimiter
  // semantics ("first request opens a window of windowMs; reset after
  // the window expires"). Intentionally simple — no proactive GC, the
  // existing 1-min interval in serveAccount no longer fires and the
  // map is bounded by (active tokens × windowMs). For dev/test only.
  const buckets = new Map<string, InMemoryBucket>()
  return {
    async check (key: string, max: number, windowMs: number): Promise<boolean> {
      const now = Date.now()
      const bucket = buckets.get(key)
      if (bucket === undefined || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      bucket.count += 1
      return bucket.count <= max
    }
  }
}
