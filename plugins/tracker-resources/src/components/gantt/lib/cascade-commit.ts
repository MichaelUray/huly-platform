//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ApplyOperations, Ref, Space, TxOperations } from '@hcengineering/core'
import type { Issue, IssueRelation, Milestone, Project, WorkingDaysConfig } from '@hcengineering/tracker'
import type { CascadeShift, DragState, PrimaryEdit } from './types'
import type { UndoEntry } from './undo-manager'
import { newCascadeToken } from './cascade-token'
import { fsAnchor, ssAnchor, ffAnchor, sfAnchor } from './working-days'
import { descendantsWithDates } from './scheduler'

/**
 * W10-D2 seam 2 — pure cascade-commit helpers extracted from GanttView.
 *
 * The orchestrator (`commitWithCascade`) stays in the component because
 * it owns popups (ConfirmCascadePopup / GanttConfirmCommitPopup) and
 * routes through the `setConfirming` gate. Pulling these inner pieces
 * out keeps the simulator + Tx commit + undo-frame construction
 * unit-testable.
 */

/**
 * Build a single UndoEntry describing the primary edit + cascade shift
 * batch. Returns `null` when there is nothing to record. Mirrors the
 * cascade-token semantics: a single change becomes a `date-change`
 * frame, anything larger collapses into a `date-batch`.
 */
export function buildDateUndoEntry (primary: PrimaryEdit[], shifts: CascadeShift[]): UndoEntry | null {
  const changes: Array<{
    issueId: Ref<Issue>
    issueSpace: Ref<Space>
    before: { startDate: number | null, dueDate: number | null }
    after: { startDate: number | null, dueDate: number | null }
  }> = []
  for (const pe of primary) {
    changes.push({
      issueId: pe.issue._id,
      issueSpace: pe.issue.space,
      before: { startDate: pe.issue.startDate ?? null, dueDate: pe.issue.dueDate ?? null },
      after: { startDate: pe.newStart, dueDate: pe.newDue }
    })
  }
  for (const sh of shifts) {
    changes.push({
      issueId: sh.issue._id,
      issueSpace: sh.issue.space,
      before: { startDate: sh.oldStart, dueDate: sh.oldDue },
      after: { startDate: sh.newStart, dueDate: sh.newDue }
    })
  }
  if (changes.length === 0) return null
  if (changes.length === 1) {
    const c = changes[0]
    return {
      kind: 'date-change',
      issueId: c.issueId,
      issueSpace: c.issueSpace,
      before: c.before,
      after: c.after,
      description: `Move ${String(c.issueId)}`
    }
  }
  return {
    kind: 'date-batch',
    changes,
    description: `Cascade: ${changes.length} issues shifted`
  }
}

/**
 * Returns true iff the relation `r` is satisfied given the proposed
 * primary edit `pe` and the current dates of the other side. Used for
 * the Alt-bypass violation count only. Routes through the same anchor
 * helpers as the scheduler so violation counts agree with cascade
 * decisions in both legacy and working-days mode.
 */
export function relationSatisfied (
  r: IssueRelation,
  pe: PrimaryEdit,
  otherIssue: Issue,
  workingDaysCfg: WorkingDaysConfig | undefined
): boolean {
  const isOutgoing = String(r.attachedTo) === String(pe.issue._id)
  const predStart = isOutgoing ? pe.newStart : (otherIssue.startDate as number)
  const predDue = isOutgoing ? pe.newDue : (otherIssue.dueDate as number)
  const succStart = isOutgoing ? (otherIssue.startDate as number) : pe.newStart
  const succDue = isOutgoing ? (otherIssue.dueDate as number) : pe.newDue
  const lag = r.lag ?? 0
  switch (r.kind) {
    case 'finish-to-start': return fsAnchor(predDue, lag, workingDaysCfg) <= succStart
    case 'start-to-start': return ssAnchor(predStart, lag, workingDaysCfg) <= succStart
    case 'finish-to-finish': return ffAnchor(predDue, lag, workingDaysCfg) <= succDue
    case 'start-to-finish': return sfAnchor(predStart, lag, workingDaysCfg) <= succDue
  }
}

export interface CascadeCommitClient {
  apply: (id: undefined, scope: string) => ApplyOperations
}

/**
 * Tx orchestration for a cascade-commit batch. Pushes one Tx group via
 * the supplied client (carrying a fresh cascadeToken), commits, and
 * returns whether the commit succeeded plus the undo-entry to push.
 *
 * Failure handling (notification + activeDrag reset) stays in the
 * caller — we surface only the success/failure boolean so the
 * orchestrator can decide on UX side-effects.
 */
export interface CascadeCommitResult {
  ok: boolean
  undoEntry: UndoEntry | null
  cascadeToken: string
}

export async function commitCascadeBatch (
  client: CascadeCommitClient,
  primary: PrimaryEdit[],
  shifts: CascadeShift[],
  cascadeScope: string = 'gantt-cascade-commit'
): Promise<CascadeCommitResult> {
  const cascadeToken = newCascadeToken(cascadeScope)
  const ops = client.apply(undefined, cascadeToken)
  for (const pe of primary) {
    await ops.update(pe.issue, { startDate: pe.newStart, dueDate: pe.newDue })
  }
  for (const sh of shifts) {
    await ops.update(sh.issue, { startDate: sh.newStart, dueDate: sh.newDue })
  }
  const undoEntry = buildDateUndoEntry(primary, shifts)
  const r = await ops.commit()
  return { ok: r.result === true, undoEntry, cascadeToken }
}

/**
 * Alt-bypass branch: commit only the primary edits, skipping cascade
 * shifts entirely. Caller is responsible for the violation-count
 * computation + warning toast.
 */
export async function commitPrimariesBypass (
  client: CascadeCommitClient,
  primary: PrimaryEdit[],
  cascadeScope?: string
): Promise<CascadeCommitResult> {
  const cascadeToken = newCascadeToken(cascadeScope ?? 'gantt-cascade-bypass')
  const ops = client.apply(undefined, cascadeToken)
  for (const pe of primary) {
    await ops.update(pe.issue, { startDate: pe.newStart, dueDate: pe.newDue })
  }
  const undoEntry = buildDateUndoEntry(primary, [])
  const r = await ops.commit()
  return { ok: r.result === true, undoEntry, cascadeToken }
}

/**
 * Count violations of the supplied relations against the proposed
 * primary edits — used by the Alt-bypass branch to show a warning toast
 * AFTER the commit succeeded.
 *
 * `allByRef` provides current dates for the other side of every
 * relation; relations between two primary-edited issues are skipped
 * (those are by construction satisfied by the new dates, not the old).
 */
export function countAltBypassViolations (
  primary: PrimaryEdit[],
  relations: IssueRelation[],
  allByRef: Map<Ref<Issue>, Issue>,
  workingDaysCfg: WorkingDaysConfig | undefined
): number {
  let violations = 0
  const primarySet = new Set(primary.map((p) => String(p.issue._id)))
  for (const pe of primary) {
    for (const r of relations) {
      const involvesPrimary = String(r.attachedTo) === String(pe.issue._id) || String(r.target) === String(pe.issue._id)
      if (!involvesPrimary) continue
      const otherRef = String(r.attachedTo) === String(pe.issue._id) ? r.target : r.attachedTo
      if (primarySet.has(String(otherRef))) continue
      const otherIssue = allByRef.get(otherRef as Ref<Issue>)
      if (otherIssue === undefined || otherIssue.startDate == null || otherIssue.dueDate == null) continue
      if (!relationSatisfied(r, pe, otherIssue, workingDaysCfg)) violations++
    }
  }
  return violations
}

// `TxOperations` is exported only so the production caller can satisfy
// CascadeCommitClient's structural shape without unsafe casts. Not
// otherwise used by this module.
export type { TxOperations }

/**
 * W10-D2 seam 3 — leaf commit helpers for Issue / Milestone drags.
 *
 * The original implementations called `getClient()` directly mid-function
 * for the parent-cascade lookup. The lib versions take an explicit
 * `findAllInSpace` callback so they stay testable.
 */
export interface LeafCommitDeps {
  // Production caller passes `(space) => getClient().findAll(...)`.
  // `Issue.space` is typed as `Ref<Project>` in @hcengineering/tracker;
  // FindResult<T> = `WithLookup<T>[] & { total, lookupMap? }` is
  // assignable to `Issue[]` (only iteration is used).
  findAllInSpace: (space: Ref<Project>) => Promise<Issue[]>
}

/**
 * Commit a drag for an Issue target. Mirrors the PR3 commit path; the
 * cascade walks descendant issues (parent -> children shift by delta).
 */
export async function commitIssueDragLeaf (
  deps: LeafCommitDeps,
  state: DragState,
  target: { kind: 'issue', doc: Issue },
  ops: ApplyOperations
): Promise<void> {
  if (state.kind === 'dragging-body') {
    await ops.update(target.doc, { startDate: state.previewStart, dueDate: state.previewEnd })
    const delta = state.previewStart - state.originStart
    if (delta !== 0) {
      // Fetch the full space's issues here rather than reusing the
      // view-filtered `issues` array - otherwise children hidden by an
      // active Tracker filter wouldn't shift with the parent and the
      // tree would drift out of sync.
      const allInSpace = await deps.findAllInSpace(target.doc.space)
      for (const child of descendantsWithDates(target.doc, allInSpace)) {
        await ops.update(child, {
          startDate: (child.startDate as number) + delta,
          dueDate: (child.dueDate as number) + delta
        })
      }
    }
  } else if (state.kind === 'dragging-unscheduled') {
    // Unscheduled-drag only schedules the parent issue. originStart is the
    // synthetic "today" anchor - using its delta to shift existing scheduled
    // descendants would move them by a wildly unrelated amount.
    // Descendants stay put; the user can drag the
    // (now-scheduled) parent again to do a coordinated shift.
    await ops.update(target.doc, { startDate: state.previewStart, dueDate: state.previewEnd })
  } else if (state.kind === 'resizing-left') {
    await ops.update(target.doc, { startDate: state.previewStart })
  } else if (state.kind === 'resizing-right') {
    await ops.update(target.doc, { dueDate: state.previewEnd })
  }
}

/**
 * Commit a drag for a Milestone target.
 * Field mapping: Issue.dueDate <-> Milestone.targetDate; startDate is shared.
 * Cascade: when the milestone moves, all issues assigned to it shift by the
 * same delta along with their descendants. No cascade for resize.
 */
export async function commitMilestoneDragLeaf (
  deps: LeafCommitDeps,
  state: DragState,
  target: { kind: 'milestone', doc: Milestone },
  ops: ApplyOperations
): Promise<void> {
  if (state.kind === 'dragging-body') {
    await ops.update(target.doc, { startDate: state.previewStart, targetDate: state.previewEnd })
    const delta = state.previewStart - state.originStart
    if (delta !== 0) {
      const allInSpace = await deps.findAllInSpace(target.doc.space)
      const assigned = allInSpace.filter((i) =>
        (i as unknown as { milestone?: string | null }).milestone === target.doc._id
      )
      // Shift assigned issues + their descendants. Same dedup logic as
      // descendantsWithDates: only issues with both dates set get shifted.
      const shiftRoots = new Set<string>()
      const toShift: Issue[] = []
      for (const a of assigned) {
        if (a.startDate == null || a.dueDate == null) continue
        if (!shiftRoots.has(String(a._id))) {
          shiftRoots.add(String(a._id))
          toShift.push(a)
        }
        for (const child of descendantsWithDates(a, allInSpace)) {
          if (!shiftRoots.has(String(child._id))) {
            shiftRoots.add(String(child._id))
            toShift.push(child)
          }
        }
      }
      for (const i of toShift) {
        await ops.update(i, {
          startDate: (i.startDate as number) + delta,
          dueDate: (i.dueDate as number) + delta
        })
      }
    }
  } else if (state.kind === 'resizing-left') {
    await ops.update(target.doc, { startDate: state.previewStart })
  } else if (state.kind === 'resizing-right') {
    await ops.update(target.doc, { targetDate: state.previewEnd })
  }
  // Milestones can't enter dragging-unscheduled (no drag-grip in the
  // sidebar for them), so that branch is unreachable.
}

