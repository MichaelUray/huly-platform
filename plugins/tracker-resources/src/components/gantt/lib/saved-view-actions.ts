//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { FilteredView, Viewlet } from '@hcengineering/view'
import type { Ref } from '@hcengineering/core'
import type { ZoomLevel } from './types'
import type { BarColorMode } from './bar-colors'
import {
  isoDateForTimestamp,
  extractGanttSavedView,
  mergeGanttSavedView,
  type GanttSavedViewOptions
} from './gantt-view-options'

/**
 * W10-D2 seam 5 — pure builders + comparators for saved Gantt views.
 *
 * The Huly client wrappers (createDoc / update / showPopup) stay in the
 * component because they capture the workspace context and the
 * `selectedFilterStore`. The pure mapping ("current Gantt state" ->
 * `viewOptions` blob, and "saved blob vs. current state" -> dirty
 * boolean) lives here so it stays unit-testable.
 */

/** Snapshot of the component-side reactive state that feeds the
 *  build/comparator helpers. */
export interface GanttSavedViewSnapshot {
  zoom: ZoomLevel
  barColorBy: BarColorMode
  showPastDueOverlay: boolean
  showBlockedOverlay: boolean
  showSubIssueProgress: boolean
}

/**
 * Build the `viewOptions` blob that `saveCurrentGanttView` /
 * `updateCurrentGanttView` will hand to the FilteredView Tx. Merges the
 * Gantt-specific keys on top of the base ViewOptions blob from the
 * current viewlet (so non-Gantt keys survive untouched).
 *
 * `panAnchor` is supplied only when the caller wants to fix the time
 * window — caller computes the timestamp from `hScrollEl.scrollLeft +
 * timeScale.fromX(...)` and passes it in.
 */
export function buildSavedViewOptionsBlob (
  base: Record<string, unknown> | undefined,
  snap: GanttSavedViewSnapshot,
  panAnchorTimestamp: number | undefined
): Record<string, unknown> {
  const payload: GanttSavedViewOptions = {
    zoomLevel: snap.zoom,
    ganttBarColorBy: snap.barColorBy,
    ganttShowPastDueOverlay: snap.showPastDueOverlay,
    ganttShowBlockedOverlay: snap.showBlockedOverlay,
    ganttShowSubIssueProgress: snap.showSubIssueProgress
  }
  if (panAnchorTimestamp !== undefined) {
    payload.panAnchorDate = isoDateForTimestamp(panAnchorTimestamp)
  }
  return mergeGanttSavedView(base ?? {}, payload)
}

/**
 * True when the current Gantt state diverges from the saved blob.
 * Returns false when no view is selected, when the view belongs to a
 * different viewlet, or when every field matches (including the
 * spec-defined defaults: bar-color=status, past-due=on, blocked=on,
 * sub-issue-progress=off).
 */
export function isCurrentGanttViewModified (
  fv: FilteredView | undefined,
  viewletId: Ref<Viewlet> | undefined,
  snap: GanttSavedViewSnapshot
): boolean {
  if (fv === undefined || fv.viewletId !== viewletId) return false
  const saved = (fv.viewOptions as Record<string, unknown> | undefined) ?? {}
  if (saved.ganttZoomLevel !== snap.zoom) return true
  if ((saved.ganttBarColorBy ?? 'status') !== snap.barColorBy) return true
  if ((saved.ganttShowPastDueOverlay ?? true) !== snap.showPastDueOverlay) return true
  if ((saved.ganttShowBlockedOverlay ?? true) !== snap.showBlockedOverlay) return true
  if ((saved.ganttShowSubIssueProgress ?? false) !== snap.showSubIssueProgress) return true
  return false
}

/**
 * Resolve the desired-state record from a FilteredView's viewOptions
 * blob. The component-side wrapper applies the result to the four
 * stores + zoom + scroll anchor.
 *
 * Defaults match the spec: bar-color=status, past-due=on, blocked=on,
 * sub-issue-progress=off. Defaults must be applied here (not "ignore
 * missing keys") so stale state from a previously loaded view cannot
 * leak into the next load.
 */
export interface ApplyGanttSavedViewResult {
  zoom: ZoomLevel
  barColorBy: BarColorMode
  showPastDueOverlay: boolean
  showBlockedOverlay: boolean
  showSubIssueProgress: boolean
  /** Undefined when the saved view did NOT pin the time window. */
  panAnchorDate: string | undefined
}

const BAR_COLOR_MODES: readonly BarColorMode[] = ['status', 'priority', 'assignee', 'component', 'milestone', 'none']

function isBarColorMode (v: unknown): v is BarColorMode {
  return typeof v === 'string' && (BAR_COLOR_MODES as readonly string[]).includes(v)
}

export function resolveApplyGanttSavedView (raw: Record<string, unknown> | undefined): ApplyGanttSavedViewResult {
  const opts = extractGanttSavedView(raw)
  const mode = raw?.ganttBarColorBy
  return {
    zoom: opts.zoomLevel,
    barColorBy: isBarColorMode(mode) ? mode : 'status',
    showPastDueOverlay: typeof raw?.ganttShowPastDueOverlay === 'boolean'
      ? raw.ganttShowPastDueOverlay
      : true,
    showBlockedOverlay: typeof raw?.ganttShowBlockedOverlay === 'boolean'
      ? raw.ganttShowBlockedOverlay
      : true,
    showSubIssueProgress: typeof raw?.ganttShowSubIssueProgress === 'boolean'
      ? raw.ganttShowSubIssueProgress
      : false,
    panAnchorDate: opts.panAnchorDate
  }
}
