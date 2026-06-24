//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { LayoutRow, SummaryRange } from './types'
import type { IssueRelation } from '@hcengineering/tracker'
import type { TimeScale } from './time-scale'
import { exportGanttDataToPdf, exportGanttDataToPng } from './exporter'

/**
 * W10-D2 seam 6 — pure snapshot builder + exporter wrappers for the
 * Gantt export menu.
 *
 * `openMoreActionsMenu` uses Huly's `showPopup` + `eventToHTMLElement`
 * — these stay in the component because they touch the DOM event
 * directly. What we extract:
 *
 * 1. The `ExportSnapshot` shape — the bag of reactive values the
 *    exporter functions need.
 * 2. `runExportToPng(snap, stamp)` / `runExportToPdf(snap, stamp)` —
 *    thin async wrappers that build the title and call the exporter.
 *    Returning a Promise<Error | null> instead of throwing keeps the
 *    component-side error handling explicit (toast on failure).
 * 3. `defaultExportStamp(now)` — the date-stamp filename helper.
 */

export interface ExportSnapshot {
  rows: LayoutRow[]
  relations: IssueRelation[]
  summaryRanges: Map<string, SummaryRange>
  timeScale: TimeScale
  dateRange: { from: number, to: number }
  totalCanvasWidth: number
}

/** Format helper used by the Gantt header range subtitle + export title. */
export function formatRangeLabel (ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** ISO-date-stamped filename root for PNG / PDF exports. */
export function defaultExportStamp (now: Date = new Date()): string {
  return `gantt-${now.toISOString().slice(0, 10)}`
}

function buildExportArgs (snap: ExportSnapshot): Parameters<typeof exportGanttDataToPng>[0] {
  return {
    rows: snap.rows,
    relations: snap.relations,
    summaryRanges: snap.summaryRanges,
    timeScale: snap.timeScale,
    range: [snap.dateRange.from, snap.dateRange.to],
    chartWidth: snap.totalCanvasWidth,
    title: `${formatRangeLabel(snap.dateRange.from)} – ${formatRangeLabel(snap.dateRange.to)}`
  }
}

/**
 * Run a PNG export against the supplied snapshot. Returns the error
 * the exporter rejected with (null on success). Caller surfaces a
 * notification toast for non-null returns.
 */
export async function runExportToPng (snap: ExportSnapshot, stamp: string): Promise<Error | null> {
  try {
    await exportGanttDataToPng(buildExportArgs(snap), stamp)
    return null
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

/** PDF counterpart to `runExportToPng`. Identical semantics. */
export async function runExportToPdf (snap: ExportSnapshot, stamp: string): Promise<Error | null> {
  try {
    await exportGanttDataToPdf(buildExportArgs(snap), stamp)
    return null
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}
