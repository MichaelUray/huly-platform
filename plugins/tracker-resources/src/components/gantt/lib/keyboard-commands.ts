//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ZoomLevel } from './types'

/**
 * W10-D2 — Pure keyboard command mapping for GanttView.
 *
 * The component's `onKey(e: KeyboardEvent)` handler used to be a ~100-line
 * `if`-cascade dispatching to undo/redo/move-focus/shift/zoom/select-all/etc.
 * The MAPPING from key+modifier to command name is pure logic that doesn't
 * touch DOM, store, or component state. Pulling it into this lib lets us
 * unit-test every shortcut combination in isolation.
 *
 * The COMMAND IMPLEMENTATIONS (handleUndo, moveFocus, exportToPng, ...)
 * stay in the component because they touch reactive variables, popups,
 * and the Huly client. The component-side switch on `Command.type` is a
 * trivial dispatcher — no state-smearing risk.
 */

/** Inputs the mapping needs to gate certain shortcuts. */
export interface KeyCommandContext {
  /** True when an editable control owns focus — gates most shortcuts off so
   *  the user can type freely in CreateIssue / inline cells / DependencyEditor. */
  isTextInputFocused: boolean
  /** True when an interactive drag is in flight — Esc cancels it first. */
  isDragActive: boolean
  /** True when there is at least one row in the multi-selection. */
  hasMultiSelection: boolean
  /** True when document.activeElement is inside the Gantt container — the
   *  outer guard so global Tab / arrow keys don't get hijacked when the
   *  Gantt is mounted but unfocused. */
  containsActiveElement: boolean
}

export type KeyCommand =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'moveFocus', dir: 1 | -1 }
  | { type: 'shift', days: number }
  | { type: 'cancelDrag' }
  | { type: 'clearSelection' }
  | { type: 'selectAll' }
  | { type: 'cycleZoom', delta: number }
  | { type: 'jumpToToday' }
  | { type: 'setZoom', zoom: ZoomLevel }
  | { type: 'showHelp' }
  | { type: 'exportPng' }

/**
 * Map a KeyboardEvent to a Gantt command, or null when no shortcut matches.
 *
 * The function is pure: it reads only `e.key` / `e.metaKey` / `e.ctrlKey` /
 * `e.shiftKey` / `e.altKey` from the event and the four flags from `ctx`.
 * It never calls `preventDefault()` — that stays in the component (we don't
 * want to swallow events we didn't handle).
 *
 * The ordering of branches matches the original `onKey` cascade:
 *   1. Cmd/Ctrl+Z (undo/redo) — wins against +/- zoom keys.
 *   2. (outer guard: containsActiveElement) — Tab / arrows / Esc / Cmd-A.
 *   3. +/- zoom cycle.
 *   4. Bare-key shortcuts T/D/W/M/Q/?/E — only when no modifier is held
 *      AND no editable owns focus.
 *
 * Returning `null` means "the component should not preventDefault — let the
 * event bubble". The component's switch on the returned command's `type`
 * still calls preventDefault.
 */
export function keyEventToCommand (
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  ctx: KeyCommandContext
): KeyCommand | null {
  // (1) Cmd/Ctrl + Z — undo/redo. Checked FIRST so they win against the
  // +/-/Tab/Arrow keyspace below.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    if (ctx.isTextInputFocused) return null
    if (!ctx.containsActiveElement) return null
    return e.shiftKey ? { type: 'redo' } : { type: 'undo' }
  }

  // Outer guard: anything below requires focus inside the Gantt root.
  if (!ctx.containsActiveElement) return null

  if (e.key === 'Tab') {
    return { type: 'moveFocus', dir: e.shiftKey ? -1 : 1 }
  }
  if (e.key === 'ArrowRight') {
    return { type: 'shift', days: e.shiftKey ? 7 : 1 }
  }
  if (e.key === 'ArrowLeft') {
    return { type: 'shift', days: e.shiftKey ? -7 : -1 }
  }
  if (e.key === 'Escape' && ctx.isDragActive) {
    return { type: 'cancelDrag' }
  }
  // Esc clears multi-selection only when no drag is in flight — sits AFTER
  // the cancelDrag branch so the user's first Esc still cancels the drag.
  if (e.key === 'Escape' && ctx.hasMultiSelection) {
    return { type: 'clearSelection' }
  }
  // Cmd/Ctrl + A — select all visible scheduled issues. Skips text inputs
  // so the browser's native Select-All keeps working in CreateIssue / inline
  // editors.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A') && !e.shiftKey) {
    if (ctx.isTextInputFocused) return null
    return { type: 'selectAll' }
  }

  // +/- cycle through ZOOM_LEVELS.
  if (e.key === '+' || e.key === '=') {
    return { type: 'cycleZoom', delta: 1 }
  }
  if (e.key === '-' || e.key === '_') {
    return { type: 'cycleZoom', delta: -1 }
  }

  // Bare-key shortcuts T/D/W/M/Q/?/E — only when no modifier is held AND no
  // editable target owns focus.
  if (!ctx.isTextInputFocused && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 't' || e.key === 'T') return { type: 'jumpToToday' }
    if (e.key === 'd' || e.key === 'D') return { type: 'setZoom', zoom: 'day' }
    if (e.key === 'w' || e.key === 'W') return { type: 'setZoom', zoom: 'week' }
    if (e.key === 'm' || e.key === 'M') return { type: 'setZoom', zoom: 'month' }
    if (e.key === 'q' || e.key === 'Q') return { type: 'setZoom', zoom: 'quarter' }
  }

  // '?' or Shift+/ — keyboard help overlay.
  if (e.key === '?') {
    return { type: 'showHelp' }
  }
  // 'e' / 'E' — export PNG (gated by isTextInputFocused above? — no, the
  // original code ALSO fires E without the text-input guard. Preserve.)
  if (e.key === 'e' || e.key === 'E') {
    return { type: 'exportPng' }
  }

  return null
}
