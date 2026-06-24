//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref, Space } from '@hcengineering/core'
import type { Issue, IssueRelation, Milestone } from '@hcengineering/tracker'
import type { CascadeShift, DragState, PrimaryEdit } from '../types'
import {
  buildDateUndoEntry,
  relationSatisfied,
  commitCascadeBatch,
  commitPrimariesBypass,
  countAltBypassViolations,
  commitIssueDragLeaf,
  commitMilestoneDragLeaf,
  type CascadeCommitClient
} from '../cascade-commit'

const SPACE = 'space-1' as Ref<Space>
const TODAY = 1700000000000

function issue (id: string, start: number | null = TODAY, due: number | null = TODAY + 86400000): Issue {
  return {
    _id: id as unknown as Ref<Issue>,
    space: SPACE,
    startDate: start,
    dueDate: due
  } as unknown as Issue
}

function pe (i: Issue, dStart = 86400000, dDue = 86400000): PrimaryEdit {
  return {
    issue: i,
    newStart: (i.startDate as number) + dStart,
    newDue: (i.dueDate as number) + dDue
  }
}

function shift (i: Issue, triggeredById: string = 'trigger'): CascadeShift {
  return {
    issue: i,
    oldStart: i.startDate as number,
    oldDue: i.dueDate as number,
    newStart: (i.startDate as number) + 86400000,
    newDue: (i.dueDate as number) + 86400000,
    reason: 'push-successor',
    triggeredBy: triggeredById as unknown as Ref<Issue>
  }
}

describe('buildDateUndoEntry', () => {
  it('returns null on empty input', () => {
    expect(buildDateUndoEntry([], [])).toBeNull()
  })

  it('returns a date-change frame for a single primary edit', () => {
    const i = issue('A')
    const entry = buildDateUndoEntry([pe(i)], [])
    expect(entry).not.toBeNull()
    expect(entry!.kind).toBe('date-change')
    if (entry!.kind === 'date-change') {
      expect(entry!.issueId).toBe('A')
      expect(entry!.before.startDate).toBe(TODAY)
      expect(entry!.after.startDate).toBe(TODAY + 86400000)
    }
  })

  it('returns a date-batch frame for multi-issue edits', () => {
    const a = issue('A')
    const b = issue('B')
    const entry = buildDateUndoEntry([pe(a)], [shift(b)])
    expect(entry).not.toBeNull()
    expect(entry!.kind).toBe('date-batch')
    if (entry!.kind === 'date-batch') {
      expect(entry!.changes).toHaveLength(2)
    }
  })

  it('records null-before for issues without prior dates', () => {
    const i = issue('A', null, null)
    const edited: PrimaryEdit = { issue: i, newStart: TODAY, newDue: TODAY + 86400000 }
    const entry = buildDateUndoEntry([edited], [])
    expect(entry).not.toBeNull()
    if (entry!.kind === 'date-change') {
      expect(entry!.before).toEqual({ startDate: null, dueDate: null })
    }
  })
})

describe('relationSatisfied', () => {
  const pred = issue('P', TODAY, TODAY + 86400000) // due at +1d
  const succ = issue('S', TODAY + 2 * 86400000, TODAY + 3 * 86400000) // start at +2d
  const fsRel: IssueRelation = {
    _id: 'r1' as unknown as Ref<IssueRelation>,
    attachedTo: pred._id,
    target: succ._id,
    kind: 'finish-to-start',
    lag: 0
  } as unknown as IssueRelation

  it('FS is satisfied when predDue <= succStart', () => {
    const edit: PrimaryEdit = { issue: pred, newStart: TODAY, newDue: TODAY + 86400000 }
    expect(relationSatisfied(fsRel, edit, succ, undefined)).toBe(true)
  })

  it('FS is unsatisfied when predDue > succStart', () => {
    const edit: PrimaryEdit = { issue: pred, newStart: TODAY, newDue: TODAY + 5 * 86400000 }
    expect(relationSatisfied(fsRel, edit, succ, undefined)).toBe(false)
  })

  it('honors the lag', () => {
    const lagRel = { ...fsRel, lag: 5 } as IssueRelation
    const edit: PrimaryEdit = { issue: pred, newStart: TODAY, newDue: TODAY + 86400000 }
    // pred dueDate +1d + 5d lag = +6d > succ start +2d → unsatisfied
    expect(relationSatisfied(lagRel, edit, succ, undefined)).toBe(false)
  })

  it('handles incoming direction (pe.issue is the successor)', () => {
    const edit: PrimaryEdit = { issue: succ, newStart: TODAY + 2 * 86400000, newDue: TODAY + 3 * 86400000 }
    expect(relationSatisfied(fsRel, edit, pred, undefined)).toBe(true)
  })
})

describe('commitCascadeBatch', () => {
  function mockClient (commitResult: boolean): { client: CascadeCommitClient, updates: any[][], scopes: string[] } {
    const updates: any[][] = []
    const scopes: string[] = []
    const client: CascadeCommitClient = {
      apply: (_id: undefined, scope: string) => {
        scopes.push(scope)
        return {
          update: async (...args: any[]) => {
            updates.push(args)
          },
          commit: async () => ({ result: commitResult })
        } as any
      }
    }
    return { client, updates, scopes }
  }

  it('routes one ops.update per primary + shift', async () => {
    const { client, updates } = mockClient(true)
    const a = issue('A')
    const b = issue('B')
    const result = await commitCascadeBatch(client, [pe(a)], [shift(b)])
    expect(result.ok).toBe(true)
    expect(result.undoEntry).not.toBeNull()
    expect(updates).toHaveLength(2)
  })

  it('returns ok=false when commit fails', async () => {
    const { client } = mockClient(false)
    const result = await commitCascadeBatch(client, [pe(issue('A'))], [])
    expect(result.ok).toBe(false)
  })

  it('passes through cascadeScope to apply()', async () => {
    const { client, scopes } = mockClient(true)
    await commitCascadeBatch(client, [pe(issue('A'))], [], 'custom-scope')
    expect(scopes[0].startsWith('custom-scope')).toBe(true)
  })
})

describe('commitPrimariesBypass', () => {
  it('updates primaries only, skipping shifts', async () => {
    const updates: any[][] = []
    const client: CascadeCommitClient = {
      apply: () => ({
        update: async (...args: any[]) => { updates.push(args) },
        commit: async () => ({ result: true })
      } as any)
    }
    const a = issue('A')
    const result = await commitPrimariesBypass(client, [pe(a)])
    expect(result.ok).toBe(true)
    expect(updates).toHaveLength(1)
  })
})

describe('countAltBypassViolations', () => {
  it('returns zero for satisfied relations', () => {
    const pred = issue('P', TODAY, TODAY + 86400000)
    const succ = issue('S', TODAY + 5 * 86400000, TODAY + 6 * 86400000)
    const rel: IssueRelation = {
      _id: 'r' as unknown as Ref<IssueRelation>,
      attachedTo: pred._id,
      target: succ._id,
      kind: 'finish-to-start',
      lag: 0
    } as unknown as IssueRelation
    const allByRef = new Map([[succ._id, succ]])
    const v = countAltBypassViolations([pe(pred, 0, 0)], [rel], allByRef, undefined)
    expect(v).toBe(0)
  })

  it('counts violations', () => {
    const pred = issue('P', TODAY, TODAY + 86400000)
    const succ = issue('S', TODAY + 86400000, TODAY + 2 * 86400000) // starts day after pred-due
    const rel: IssueRelation = {
      _id: 'r' as unknown as Ref<IssueRelation>,
      attachedTo: pred._id,
      target: succ._id,
      kind: 'finish-to-start',
      lag: 0
    } as unknown as IssueRelation
    const allByRef = new Map([[succ._id, succ]])
    // Move pred 5 days right → pred due now sits past succ start → violation.
    const edit: PrimaryEdit = { issue: pred, newStart: TODAY, newDue: TODAY + 5 * 86400000 }
    const v = countAltBypassViolations([edit], [rel], allByRef, undefined)
    expect(v).toBe(1)
  })

  it('skips relations whose other side is also in the primary set', () => {
    const a = issue('A', TODAY, TODAY + 86400000)
    const b = issue('B', TODAY + 86400000, TODAY + 2 * 86400000)
    const rel: IssueRelation = {
      _id: 'r' as unknown as Ref<IssueRelation>,
      attachedTo: a._id,
      target: b._id,
      kind: 'finish-to-start',
      lag: 0
    } as unknown as IssueRelation
    const allByRef = new Map([[a._id, a], [b._id, b]])
    // Both A and B are in the primary set — relation is internal, not counted.
    const edit1: PrimaryEdit = { issue: a, newStart: TODAY, newDue: TODAY + 10 * 86400000 }
    const edit2: PrimaryEdit = { issue: b, newStart: TODAY + 10 * 86400000, newDue: TODAY + 11 * 86400000 }
    const v = countAltBypassViolations([edit1, edit2], [rel], allByRef, undefined)
    expect(v).toBe(0)
  })
})

describe('commitIssueDragLeaf', () => {
  function mockOps (): { ops: any, updates: any[][] } {
    const updates: any[][] = []
    return {
      updates,
      ops: { update: async (...args: any[]) => { updates.push(args) } }
    }
  }

  it('dragging-body updates target', async () => {
    const { ops, updates } = mockOps()
    const target = issue('A', 100, 200)
    const state: DragState = {
      kind: 'dragging-body',
      target: { kind: 'issue', doc: target },
      originStart: 100,
      originEnd: 200,
      previewStart: 150,
      previewEnd: 250
    } as unknown as DragState
    await commitIssueDragLeaf(
      { findAllInSpace: async () => [] },
      state,
      { kind: 'issue', doc: target },
      ops
    )
    expect(updates).toHaveLength(1)
    expect(updates[0][1]).toEqual({ startDate: 150, dueDate: 250 })
  })

  it('dragging-body cascades to descendants', async () => {
    const { ops, updates } = mockOps()
    const parent = { ...issue('P', 100, 200), parents: [] } as Issue
    const child = { ...issue('C', 100, 200), parents: [{ parentId: parent._id }] } as Issue
    const state: DragState = {
      kind: 'dragging-body',
      target: { kind: 'issue', doc: parent },
      originStart: 100,
      originEnd: 200,
      previewStart: 200, // delta = +100
      previewEnd: 300
    } as unknown as DragState
    await commitIssueDragLeaf(
      { findAllInSpace: async () => [parent, child] },
      state,
      { kind: 'issue', doc: parent },
      ops
    )
    expect(updates).toHaveLength(2) // parent + child
  })

  it('resizing-left updates only startDate', async () => {
    const { ops, updates } = mockOps()
    const target = issue('A', 100, 200)
    const state: DragState = {
      kind: 'resizing-left',
      target: { kind: 'issue', doc: target },
      previewStart: 80,
      previewEnd: 200
    } as unknown as DragState
    await commitIssueDragLeaf(
      { findAllInSpace: async () => [] },
      state,
      { kind: 'issue', doc: target },
      ops
    )
    expect(updates[0][1]).toEqual({ startDate: 80 })
  })

  it('resizing-right updates only dueDate', async () => {
    const { ops, updates } = mockOps()
    const target = issue('A', 100, 200)
    const state: DragState = {
      kind: 'resizing-right',
      target: { kind: 'issue', doc: target },
      previewStart: 100,
      previewEnd: 300
    } as unknown as DragState
    await commitIssueDragLeaf(
      { findAllInSpace: async () => [] },
      state,
      { kind: 'issue', doc: target },
      ops
    )
    expect(updates[0][1]).toEqual({ dueDate: 300 })
  })
})

describe('commitMilestoneDragLeaf', () => {
  function mockOps (): { ops: any, updates: any[][] } {
    const updates: any[][] = []
    return {
      updates,
      ops: { update: async (...args: any[]) => { updates.push(args) } }
    }
  }

  function milestone (id: string): Milestone {
    return { _id: id as unknown as Ref<Milestone>, space: SPACE } as unknown as Milestone
  }

  it('dragging-body updates target with targetDate (not dueDate)', async () => {
    const { ops, updates } = mockOps()
    const m = milestone('M')
    const state: DragState = {
      kind: 'dragging-body',
      target: { kind: 'milestone', doc: m },
      originStart: 100,
      originEnd: 200,
      previewStart: 150,
      previewEnd: 250
    } as unknown as DragState
    await commitMilestoneDragLeaf(
      { findAllInSpace: async () => [] },
      state,
      { kind: 'milestone', doc: m },
      ops
    )
    expect(updates).toHaveLength(1)
    expect(updates[0][1]).toEqual({ startDate: 150, targetDate: 250 })
  })

  it('resizing-right updates targetDate', async () => {
    const { ops, updates } = mockOps()
    const m = milestone('M')
    const state: DragState = {
      kind: 'resizing-right',
      target: { kind: 'milestone', doc: m },
      previewStart: 100,
      previewEnd: 300
    } as unknown as DragState
    await commitMilestoneDragLeaf(
      { findAllInSpace: async () => [] },
      state,
      { kind: 'milestone', doc: m },
      ops
    )
    expect(updates[0][1]).toEqual({ targetDate: 300 })
  })
})
