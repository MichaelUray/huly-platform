//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  nextStateForSetZoom,
  nextStateForVisibleDaysInput,
  nextStateForCycleZoom,
  nextStateForWheelZoom,
  reclampUserPpdToFloor,
  type ZoomSnapshot
} from '../zoom-controls'
import { ZOOM_PX_PER_DAY, MIN_PPD } from '../zoom'

const baseSnap: ZoomSnapshot = {
  zoom: 'week',
  userPxPerDay: null,
  canvasViewportWidth: 1000,
  dynamicMinPpd: MIN_PPD,
  scrollLeft: 0
}

describe('nextStateForSetZoom', () => {
  it('clears the override and resets scroll', () => {
    expect(nextStateForSetZoom('month')).toEqual({
      zoom: 'month',
      userPxPerDay: null,
      scrollLeft: 0
    })
  })
})

describe('nextStateForCycleZoom', () => {
  it('cycles +1 day -> week', () => {
    const snap = { ...baseSnap, zoom: 'day' as const }
    expect(nextStateForCycleZoom(snap, 1)).toEqual({ zoom: 'week', userPxPerDay: null, scrollLeft: 0 })
  })
  it('cycles -1 month -> week', () => {
    const snap = { ...baseSnap, zoom: 'month' as const }
    expect(nextStateForCycleZoom(snap, -1)).toEqual({ zoom: 'week', userPxPerDay: null, scrollLeft: 0 })
  })
  it('returns null at the top edge (+1 from quarter)', () => {
    const snap = { ...baseSnap, zoom: 'quarter' as const }
    expect(nextStateForCycleZoom(snap, 1)).toBeNull()
  })
  it('returns null at the bottom edge (-1 from day)', () => {
    const snap = { ...baseSnap, zoom: 'day' as const }
    expect(nextStateForCycleZoom(snap, -1)).toBeNull()
  })
})

describe('nextStateForVisibleDaysInput', () => {
  it('returns null for non-finite input', () => {
    expect(nextStateForVisibleDaysInput(baseSnap, NaN)).toBeNull()
  })
  it('returns null for input below minimum', () => {
    expect(nextStateForVisibleDaysInput(baseSnap, 0)).toBeNull()
  })
  it('returns null when viewport width is non-positive', () => {
    expect(nextStateForVisibleDaysInput({ ...baseSnap, canvasViewportWidth: 0 }, 30)).toBeNull()
  })
  it('computes pxPerDay from valid day count', () => {
    const t = nextStateForVisibleDaysInput(baseSnap, 100)
    expect(t).not.toBeNull()
    expect(t!.userPxPerDay).toBe(10) // 1000 / 100
  })
  it('clamps to dynamicMinPpd', () => {
    const t = nextStateForVisibleDaysInput({ ...baseSnap, dynamicMinPpd: 50 }, 100)
    expect(t!.userPxPerDay).toBe(50)
  })
})

describe('nextStateForWheelZoom', () => {
  it('zooming in (negative deltaY) increases px/day', () => {
    const snap = { ...baseSnap, userPxPerDay: 20, scrollLeft: 100 }
    const t = nextStateForWheelZoom(snap, { deltaY: -100, cursorX: 500, hasHScroller: true })
    expect(t).not.toBeNull()
    expect(t!.userPxPerDay).toBeGreaterThan(20)
    expect(t!.scrollLeft).toBeDefined()
  })
  it('zooming out (positive deltaY) decreases px/day', () => {
    const snap = { ...baseSnap, userPxPerDay: 20, scrollLeft: 100 }
    const t = nextStateForWheelZoom(snap, { deltaY: 100, cursorX: 500, hasHScroller: true })
    expect(t).not.toBeNull()
    expect(t!.userPxPerDay).toBeLessThan(20)
  })
  it('uses preset value when userPxPerDay is null', () => {
    const snap = { ...baseSnap, zoom: 'day' as const, userPxPerDay: null }
    const t = nextStateForWheelZoom(snap, { deltaY: -100, cursorX: 500, hasHScroller: true })
    expect(t!.userPxPerDay).toBeGreaterThan(ZOOM_PX_PER_DAY.day)
  })
  it('clamps to dynamicMinPpd when zooming out hits the floor', () => {
    const snap = { ...baseSnap, userPxPerDay: 5, dynamicMinPpd: 4 }
    const t = nextStateForWheelZoom(snap, { deltaY: 1000, cursorX: 500, hasHScroller: true })
    expect(t!.userPxPerDay).toBe(4)
  })
  it('returns null when zoom would no-op (already at floor)', () => {
    const snap = { ...baseSnap, userPxPerDay: 4, dynamicMinPpd: 4 }
    const t = nextStateForWheelZoom(snap, { deltaY: 1000, cursorX: 500, hasHScroller: true })
    expect(t).toBeNull()
  })
  it('omits scrollLeft when no horizontal scroller exists', () => {
    const snap = { ...baseSnap, userPxPerDay: 20, scrollLeft: 0 }
    const t = nextStateForWheelZoom(snap, { deltaY: -100, cursorX: 500, hasHScroller: false })
    expect(t).not.toBeNull()
    expect(t!.scrollLeft).toBeUndefined()
  })
})

describe('reclampUserPpdToFloor', () => {
  it('preserves null', () => {
    expect(reclampUserPpdToFloor(null, 10)).toBeNull()
  })
  it('returns unchanged value when above floor', () => {
    expect(reclampUserPpdToFloor(20, 10)).toBe(20)
  })
  it('clamps to floor when below', () => {
    expect(reclampUserPpdToFloor(5, 10)).toBe(10)
  })
})
