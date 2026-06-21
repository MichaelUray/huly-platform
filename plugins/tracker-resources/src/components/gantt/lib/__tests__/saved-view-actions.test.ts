//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { FilteredView, Viewlet } from '@hcengineering/view'
import type { Ref } from '@hcengineering/core'
import {
  buildSavedViewOptionsBlob,
  isCurrentGanttViewModified,
  resolveApplyGanttSavedView,
  type GanttSavedViewSnapshot
} from '../saved-view-actions'

const snap: GanttSavedViewSnapshot = {
  zoom: 'week',
  barColorBy: 'status',
  showPastDueOverlay: true,
  showBlockedOverlay: true,
  showSubIssueProgress: false
}

const VIEWLET_ID = 'viewlet-1' as Ref<Viewlet>

function fv (overrides: Partial<FilteredView> & { viewOptions?: Record<string, unknown> }): FilteredView {
  return {
    _id: 'fv-1' as unknown as Ref<FilteredView>,
    viewletId: VIEWLET_ID,
    ...overrides
  } as unknown as FilteredView
}

describe('buildSavedViewOptionsBlob', () => {
  it('serializes the snapshot keys', () => {
    const blob = buildSavedViewOptionsBlob({}, snap, undefined)
    expect(blob.ganttZoomLevel).toBe('week')
    expect(blob.ganttBarColorBy).toBe('status')
    expect(blob.ganttShowPastDueOverlay).toBe(true)
    expect(blob.ganttShowBlockedOverlay).toBe(true)
    expect(blob.ganttShowSubIssueProgress).toBe(false)
  })
  it('skips panAnchorDate when not pinned', () => {
    const blob = buildSavedViewOptionsBlob({}, snap, undefined)
    expect(blob.ganttPanAnchorDate).toBeUndefined()
  })
  it('includes panAnchorDate when timestamp supplied', () => {
    const blob = buildSavedViewOptionsBlob({}, snap, Date.UTC(2026, 5, 21))
    expect(blob.ganttPanAnchorDate).toBe('2026-06-21')
  })
  it('preserves non-Gantt keys in the base blob', () => {
    const base = { someOtherView: { grouping: 'priority' } }
    const blob = buildSavedViewOptionsBlob(base, snap, undefined)
    expect(blob.someOtherView).toEqual({ grouping: 'priority' })
  })
})

describe('isCurrentGanttViewModified', () => {
  it('returns false when no FilteredView is selected', () => {
    expect(isCurrentGanttViewModified(undefined, VIEWLET_ID, snap)).toBe(false)
  })
  it('returns false when the FilteredView belongs to another viewlet', () => {
    expect(isCurrentGanttViewModified(
      fv({ viewletId: 'other-viewlet' as Ref<Viewlet>, viewOptions: { ganttZoomLevel: 'week' } }),
      VIEWLET_ID,
      snap
    )).toBe(false)
  })
  it('returns false when every field matches', () => {
    expect(isCurrentGanttViewModified(
      fv({
        viewOptions: {
          ganttZoomLevel: 'week',
          ganttBarColorBy: 'status',
          ganttShowPastDueOverlay: true,
          ganttShowBlockedOverlay: true,
          ganttShowSubIssueProgress: false
        }
      }),
      VIEWLET_ID,
      snap
    )).toBe(false)
  })
  it('returns true when zoom differs', () => {
    expect(isCurrentGanttViewModified(
      fv({ viewOptions: { ganttZoomLevel: 'month' } }),
      VIEWLET_ID,
      snap
    )).toBe(true)
  })
  it('applies defaults: missing bar-color = "status"', () => {
    expect(isCurrentGanttViewModified(
      fv({ viewOptions: { ganttZoomLevel: 'week' } }),
      VIEWLET_ID,
      snap
    )).toBe(false)
  })
  it('applies defaults: missing past-due = true', () => {
    const dirtySnap: GanttSavedViewSnapshot = { ...snap, showPastDueOverlay: false }
    expect(isCurrentGanttViewModified(
      fv({ viewOptions: { ganttZoomLevel: 'week' } }),
      VIEWLET_ID,
      dirtySnap
    )).toBe(true)
  })
  it('applies defaults: missing sub-issue-progress = false', () => {
    const dirtySnap: GanttSavedViewSnapshot = { ...snap, showSubIssueProgress: true }
    expect(isCurrentGanttViewModified(
      fv({ viewOptions: { ganttZoomLevel: 'week' } }),
      VIEWLET_ID,
      dirtySnap
    )).toBe(true)
  })
})

describe('resolveApplyGanttSavedView', () => {
  it('uses default zoom=week when raw is undefined', () => {
    const r = resolveApplyGanttSavedView(undefined)
    expect(r.zoom).toBe('week')
  })
  it('reads zoom from raw', () => {
    const r = resolveApplyGanttSavedView({ ganttZoomLevel: 'quarter' })
    expect(r.zoom).toBe('quarter')
  })
  it('returns spec defaults for missing overlay keys', () => {
    const r = resolveApplyGanttSavedView({ ganttZoomLevel: 'day' })
    expect(r.barColorBy).toBe('status')
    expect(r.showPastDueOverlay).toBe(true)
    expect(r.showBlockedOverlay).toBe(true)
    expect(r.showSubIssueProgress).toBe(false)
  })
  it('respects explicit false for past-due overlay', () => {
    const r = resolveApplyGanttSavedView({
      ganttZoomLevel: 'week',
      ganttShowPastDueOverlay: false
    })
    expect(r.showPastDueOverlay).toBe(false)
  })
  it('parses panAnchorDate when present', () => {
    const r = resolveApplyGanttSavedView({
      ganttZoomLevel: 'week',
      ganttPanAnchorDate: '2026-06-21'
    })
    expect(r.panAnchorDate).toBe('2026-06-21')
  })
  it('rejects invalid bar-color modes', () => {
    const r = resolveApplyGanttSavedView({
      ganttZoomLevel: 'week',
      ganttBarColorBy: 'rainbow'
    })
    expect(r.barColorBy).toBe('status')
  })
})
