//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 4 T2 — boundary regression test for `bucketForActivity`.
//
// The 4 buckets (today / 7d / 30d / 90d+) are computed off a
// `now - lastActivityAt` delta. This file pins the cutover so any future
// drift in the threshold math (off-by-one, day-vs-24h, leap-second-ish
// rounding) is caught by CI.
//
// The handler always passes `Date.now()` for `now`, so jest's fake-timers
// API is also exercised here — both code paths (direct `now` arg AND
// `Date.now()`-via-handler) end up consulting the same comparator.

import { bucketForActivity, type ActivityBucket } from '../http/readRouter'

const DAY = 86_400_000
// Fixed wall-clock anchor: 2026-06-15T12:00:00Z. Picked deliberately
// inside CEST (DST in EU) so a TZ-confused future implementation that
// accidentally normalizes to local-midnight would land on a different
// bucket than the wall-clock delta would.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

describe('bucketForActivity — boundary pinning', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(NOW))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  // The four "just inside the bucket" deltas. Each value is strictly less
  // than its bucket's upper bound, so the next bucket up must NOT fire.
  const cases: Array<{ name: string, deltaMs: number, expected: ActivityBucket }> = [
    { name: '23h59m → today', deltaMs: 23 * 3_600_000 + 59 * 60_000, expected: 'today' },
    { name: '6d23h → 7d', deltaMs: 6 * DAY + 23 * 3_600_000, expected: '7d' },
    { name: '29d23h → 30d', deltaMs: 29 * DAY + 23 * 3_600_000, expected: '30d' },
    { name: '89d23h → 90d+', deltaMs: 89 * DAY + 23 * 3_600_000, expected: '90d+' }
  ]

  for (const c of cases) {
    it(c.name, () => {
      const lastAct = NOW - c.deltaMs
      expect(bucketForActivity(NOW, lastAct)).toBe(c.expected)
      // And via the wall-clock that the handler actually uses:
      expect(bucketForActivity(Date.now(), lastAct)).toBe(c.expected)
    })
  }

  it('null lastActivity → 90d+', () => {
    expect(bucketForActivity(NOW, null)).toBe('90d+')
  })

  it('non-finite lastActivity (NaN) → 90d+', () => {
    expect(bucketForActivity(NOW, NaN)).toBe('90d+')
  })

  // Cross-bucket edges: a delta of *exactly* the cutover ms must promote
  // to the next bucket up. Pins the `<` vs `<=` direction of each test.
  it('exactly 1 day → 7d (not today)', () => {
    expect(bucketForActivity(NOW, NOW - DAY)).toBe('7d')
  })
  it('exactly 7 days → 30d (not 7d)', () => {
    expect(bucketForActivity(NOW, NOW - 7 * DAY)).toBe('30d')
  })
  it('exactly 30 days → 90d+ (not 30d)', () => {
    expect(bucketForActivity(NOW, NOW - 30 * DAY)).toBe('90d+')
  })
})
