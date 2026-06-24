//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { computeThumbGeometry } from '../scrollbar-geometry'

describe('computeThumbGeometry', () => {
  it('no overflow: thumb fills the track, hasOverflow=false', () => {
    const g = computeThumbGeometry(1000, 800, 0)
    expect(g.hasOverflow).toBe(false)
  })

  it('exact match: total equals track, no overflow', () => {
    const g = computeThumbGeometry(1000, 1000, 0)
    expect(g.hasOverflow).toBe(false)
  })

  it('overflow case: thumbLength scaled proportionally', () => {
    const g = computeThumbGeometry(1000, 4000, 0)
    expect(g.hasOverflow).toBe(true)
    // 1000 * 1000 / 4000 = 250
    expect(g.thumbLength).toBe(250)
    expect(g.thumbStart).toBe(0)
  })

  it('enforces the 40 px minimum thumb length', () => {
    const g = computeThumbGeometry(100, 100_000, 0)
    expect(g.thumbLength).toBe(40)
  })

  it('thumbStart slides proportionally with scrollOffset', () => {
    const g = computeThumbGeometry(1000, 4000, 1500)
    // scrollMax = 4000 - 1000 = 3000
    // thumbMax  = 1000 - 250 = 750
    // thumbStart = (1500 / 3000) * 750 = 375
    expect(g.thumbStart).toBe(375)
    expect(g.scrollMax).toBe(3000)
    expect(g.thumbMax).toBe(750)
  })

  it('negative scrollOffset is clamped to 0', () => {
    const g = computeThumbGeometry(1000, 4000, -100)
    expect(g.thumbStart).toBe(0)
  })

  it('non-positive trackLength is treated as 1', () => {
    const g = computeThumbGeometry(0, 4000, 0)
    // track=1, thumbLength = max(40, 1/4000) = 40
    expect(g.thumbLength).toBe(40)
  })

  it('totalLength=0 collapses thumbLength to trackLength', () => {
    const g = computeThumbGeometry(800, 0, 0)
    expect(g.thumbLength).toBe(800)
    expect(g.hasOverflow).toBe(false)
  })

  it('boundary: total > track + 1 is the overflow threshold', () => {
    const noOverflow = computeThumbGeometry(1000, 1001, 0)
    expect(noOverflow.hasOverflow).toBe(false)
    const overflow = computeThumbGeometry(1000, 1002, 0)
    expect(overflow.hasOverflow).toBe(true)
  })
})
