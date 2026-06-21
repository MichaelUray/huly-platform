//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { computeCriticalPath } from '../critical-path'
import type { Issue, IssueRelation } from '@hcengineering/tracker'
import type { Ref } from '@hcengineering/core'

// Mirror of the helpers in critical-path.test.ts — minimal shape needed
// for ScheduledIssue narrowing in critical-path.ts (startDate + dueDate).
function issue (id: string, start?: number, due?: number): Issue {
  return {
    _id: id as Ref<Issue>,
    _class: 'tracker:class:Issue' as any,
    space: 'space:default' as any,
    modifiedOn: 0,
    modifiedBy: 'me' as any,
    createdOn: 0,
    createdBy: 'me' as any,
    startDate: start ?? null,
    dueDate: due ?? null,
    parents: []
  } as unknown as Issue
}

function rel (
  source: string,
  target: string,
  kind: 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish' = 'finish-to-start',
  lag = 0,
  idSuffix = ''
): IssueRelation {
  return {
    _id: `rel:${source}->${target}${idSuffix}` as any,
    _class: 'tracker:class:IssueRelation' as any,
    space: 'space:default' as any,
    attachedTo: source as Ref<Issue>,
    target: target as Ref<Issue>,
    kind,
    lag,
    modifiedOn: 0,
    modifiedBy: 'me' as any,
    createdOn: 0,
    createdBy: 'me' as any
  } as unknown as IssueRelation
}

// Mulberry32 — small deterministic PRNG so perf timing is reproducible
// across runs without pulling in seedrandom as a dep.
function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('computeCriticalPath — performance', () => {
  // The bug this guards against: forward/backward/clamp/critical-relation
  // loops used `scheduled.find(...)` which is O(V) per relation, giving
  // O(V*E) overall. For 1000 nodes / 5000 edges that is ~5M comparisons;
  // measured at multi-second on dev laptops before the Map-lookup fix.
  // After the fix this runs in single-digit milliseconds.
  it('1000 nodes / 5000 edges completes well under 100ms', () => {
    const N = 1000
    const E = 5000
    const day = 86_400_000
    const epoch = Date.UTC(2026, 0, 1)

    const issues: Issue[] = []
    for (let i = 0; i < N; i++) {
      issues.push(issue('issue-' + i, epoch + i * day, epoch + (i + 1) * day))
    }

    // Generate edges from earlier->later index only, to guarantee acyclicity
    // (computeCriticalPath bails on cycles, which would skirt the hot path).
    const rand = mulberry32(0xC0FFEE)
    const relations: IssueRelation[] = []
    let attempts = 0
    while (relations.length < E && attempts < E * 10) {
      attempts++
      const from = Math.floor(rand() * (N - 1))
      const to = from + 1 + Math.floor(rand() * (N - from - 1))
      if (to >= N) continue
      relations.push(rel('issue-' + from, 'issue-' + to, 'finish-to-start', 0, ':' + relations.length))
    }

    const start = process.hrtime.bigint()
    const result = computeCriticalPath(issues, relations)
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000

    expect(result.cycle).toBe(false)
    expect(result.slack.size).toBe(N)
    // 100ms is generous: the Map-lookup variant lands <10ms on dev hardware;
    // the old find-in-loop variant blew past 1s. Keeping the bar at 100ms
    // gives headroom for slower CI runners while still catching regressions.
    expect(elapsedMs).toBeLessThan(100)
  })
})
