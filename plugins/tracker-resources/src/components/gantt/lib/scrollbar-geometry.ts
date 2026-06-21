//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/**
 * W10-D2 seam 7 — pure scrollbar thumb geometry.
 *
 * GanttView renders custom horizontal + vertical scrollbars (Huly
 * globally hides the native bars). The thumb size + position is derived
 * from three numbers: the visible viewport length, the total scrollable
 * length, and the current scroll offset. The math is identical for both
 * axes; only the variable names differ. The `$:` reactive blocks in
 * GanttView used to inline six derivations per axis. Collapsing each
 * axis to one `computeThumbGeometry(...)` call removes 12 lines of
 * inline math (and the inevitable copy-paste drift between the H and V
 * branches).
 */

export interface ThumbGeometry {
  /** Where the thumb sits along the track, in pixels from the start. */
  thumbStart: number
  /** Length of the thumb in pixels. */
  thumbLength: number
  /** Maximum scroll offset the content can take. Used by the drag handler
   *  to map mouse-delta to scrollLeft/scrollTop. */
  scrollMax: number
  /** True when the content does NOT fit in the viewport (i.e. there is
   *  something to scroll). The toolbar suppresses the thumb when false. */
  hasOverflow: boolean
  /** Maximum position the thumb can take. Equal to `track - thumbLength`. */
  thumbMax: number
}

const MIN_THUMB_LENGTH = 40

/**
 * Compute the thumb geometry for one scrollbar.
 *
 * - `trackLength` is the visible viewport in the scroll direction
 *   (canvasViewportWidth for H, viewportHeight for V). Treated as 1
 *   when non-positive so we never divide by zero.
 * - `totalLength` is the total scrollable content extent.
 * - `scrollOffset` is the current scrollLeft / scrollTop.
 *
 * Matches the inline math in GanttView line-for-line:
 *
 *   thumbLength = max(40, track * track / total)
 *   thumbMax    = max(0, track - thumbLength)
 *   scrollMax   = max(1, total - track)
 *   thumbStart  = offset <= 0 ? 0 : (offset / scrollMax) * thumbMax
 *   hasOverflow = total > track + 1
 */
export function computeThumbGeometry (
  trackLength: number,
  totalLength: number,
  scrollOffset: number
): ThumbGeometry {
  const track = trackLength > 0 ? trackLength : 1
  const thumbLength = totalLength > 0
    ? Math.max(MIN_THUMB_LENGTH, (track * track) / totalLength)
    : track
  const thumbMax = Math.max(0, track - thumbLength)
  const scrollMax = Math.max(1, totalLength - track)
  const thumbStart = scrollOffset <= 0 ? 0 : (scrollOffset / scrollMax) * thumbMax
  const hasOverflow = totalLength > track + 1
  return { thumbStart, thumbLength, scrollMax, hasOverflow, thumbMax }
}
