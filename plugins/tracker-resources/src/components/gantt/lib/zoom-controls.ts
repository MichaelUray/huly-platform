//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ZoomLevel } from './types'
import {
  applyWheelZoom,
  cursorAnchoredScrollLeft,
  MIN_PPD,
  ZOOM_PX_PER_DAY
} from './zoom'
import { MIN_VISIBLE_DAYS, pxPerDayFromVisibleDays } from './zoom-dropdown'

/**
 * W10-D2 seam 4 — pure state-transform helpers for the zoom controls.
 *
 * The underlying math (wheel-zoom curve, cursor-anchored scroll, preset
 * px/day table, days<->px conversion) lives in `lib/zoom.ts` and
 * `lib/zoom-dropdown.ts`. This module is the glue layer that the
 * component used to inline: given the current zoom state + an action,
 * compute the desired-next-state record. The component then writes the
 * record back to the reactive variables and schedules `syncViewport`.
 *
 * DOM gating (preventDefault, ctrlKey-check, element refs) stays in the
 * component — these helpers only describe the state transition.
 */

export interface ZoomSnapshot {
  /** Active preset level — source of truth for header tick granularity. */
  zoom: ZoomLevel
  /** Wheel-zoom override; `null` means "follow preset". */
  userPxPerDay: number | null
  /** Live viewport width in pixels (canvas-area, not page). */
  canvasViewportWidth: number
  /** Dynamic zoom-out floor (5% pad each side). */
  dynamicMinPpd: number
  /** Current horizontal scroller scrollLeft. */
  scrollLeft: number
}

/**
 * The shape returned by every state-transform. `userPxPerDay` carries
 * `null` to mean "clear the override and follow the preset"; `undefined`
 * means "no change" (preserve whatever the caller already has). Same for
 * `zoom` — `undefined` = no change. `scrollLeft` is the new scroll position
 * the component should apply via `hScrollEl.scrollLeft = ...`.
 */
export interface ZoomTransition {
  zoom?: ZoomLevel
  userPxPerDay?: number | null
  scrollLeft?: number
}

/**
 * Preset-button click. Resets `userPxPerDay` to null and snaps the
 * horizontal scroller back to 0. Component still calls
 * `queueMicrotask(syncViewport)` afterward.
 */
export function nextStateForSetZoom (z: ZoomLevel): ZoomTransition {
  return {
    zoom: z,
    userPxPerDay: null,
    scrollLeft: 0
  }
}

/**
 * Visible-days input. The user typed a number into the EditBox; map
 * back through pxPerDayFromVisibleDays + clamp against the dynamic
 * floor.
 *
 * Returns `null` when the input was invalid OR the viewport width is
 * non-positive — the component should re-sync the input from the
 * derived `visibleDays` so the user sees the actual value snap back.
 */
export function nextStateForVisibleDaysInput (
  snap: ZoomSnapshot,
  rawDays: number
): ZoomTransition | null {
  if (!Number.isFinite(rawDays) || rawDays < MIN_VISIBLE_DAYS) return null
  if (snap.canvasViewportWidth <= 0) return null
  const rawPpd = pxPerDayFromVisibleDays(snap.canvasViewportWidth, rawDays)
  const nextPpd = Math.max(rawPpd, snap.dynamicMinPpd)
  // Visible-days input puts the toolbar in Custom state — set
  // userPxPerDay directly. The reactive selection mapper snaps back to
  // a preset only if the value happens to round to one.
  return { userPxPerDay: nextPpd }
}

/**
 * +/- cycle through the four ZoomLevel presets. Returns null when the
 * cycle would no-op (already at edge AND no preset change).
 */
export function nextStateForCycleZoom (
  snap: ZoomSnapshot,
  delta: number
): ZoomTransition | null {
  const levels: ZoomLevel[] = ['day', 'week', 'month', 'quarter']
  const idx = levels.indexOf(snap.zoom)
  const next = levels[Math.min(levels.length - 1, Math.max(0, idx + delta))]
  if (next === snap.zoom) return null
  return nextStateForSetZoom(next)
}

/**
 * Continuous wheel-zoom transition. The caller has already gated for
 * `e.ctrlKey || e.metaKey` and computed `cursorX` relative to the
 * scrolling element. We return the next user-pxPerDay AND the next
 * scrollLeft that keeps the date under the cursor anchored.
 *
 * Returns `null` when the zoom would no-op (e.g. already at floor /
 * ceiling and the math collapses to the same px/day).
 */
export interface WheelZoomInput {
  /** WheelEvent.deltaY — positive zooms out, negative zooms in. */
  deltaY: number
  /** Cursor X relative to the bounding-rect of the scrolling element. */
  cursorX: number
  /**
   * True when the horizontal scroller exists (i.e. `hScrollEl != null`).
   * Without overflow there is nothing to scroll, so the caller should
   * still apply the new px/day but skip the scrollLeft write.
   */
  hasHScroller: boolean
}

export function nextStateForWheelZoom (
  snap: ZoomSnapshot,
  input: WheelZoomInput
): ZoomTransition | null {
  // effective current px/day uses userPxPerDay override when set,
  // otherwise the preset table (matches GanttView's effectivePxPerDay
  // derivation).
  const oldPpd = snap.userPxPerDay !== null ? snap.userPxPerDay : ZOOM_PX_PER_DAY[snap.zoom]
  // factor=undefined lets adaptiveWheelFactor pick a per-density value:
  // 0.012 for ppd<4 (month/quarter), 0.006 for ppd>=4 (week/day).
  const rawPpd = applyWheelZoom(oldPpd, input.deltaY)
  // Honour the dynamic zoom-out floor: bars must stay at least
  // BAR_COVERAGE_MIN of the viewport.
  const newPpd = Math.max(rawPpd, snap.dynamicMinPpd)
  if (newPpd === oldPpd) return null
  const transition: ZoomTransition = { userPxPerDay: newPpd }
  if (input.hasHScroller) {
    transition.scrollLeft = cursorAnchoredScrollLeft(
      input.cursorX,
      snap.scrollLeft,
      oldPpd,
      newPpd
    )
  }
  return transition
}

/**
 * Re-clamp helper for the reactive guard `$: if (userPxPerDay !== null
 * && userPxPerDay < dynamicMinPpd) userPxPerDay = dynamicMinPpd`. Pure
 * version that returns the clamped value (or the original if no clamp
 * was needed).
 */
export function reclampUserPpdToFloor (userPxPerDay: number | null, dynamicMinPpd: number): number | null {
  if (userPxPerDay === null) return null
  if (userPxPerDay < dynamicMinPpd) return Math.max(MIN_PPD, dynamicMinPpd)
  return userPxPerDay
}
