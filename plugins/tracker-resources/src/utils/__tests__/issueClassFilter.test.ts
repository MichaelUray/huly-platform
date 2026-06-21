//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import tracker from '@hcengineering/tracker'

import { issueClassFilter } from '../issueClassFilter'

describe('issueClassFilter', () => {
  function makeHierarchy (descendants: any[]): any {
    return {
      getDescendants: jest.fn().mockImplementation((cls: any) => {
        if (cls === tracker.class.Issue) return descendants
        return []
      })
    }
  }

  it('returns a { $in: [...] } shape', () => {
    const hierarchy = makeHierarchy([tracker.class.Issue])
    const result = issueClassFilter(hierarchy)
    expect(result).toHaveProperty('$in')
    expect(Array.isArray(result.$in)).toBe(true)
  })

  it('calls hierarchy.getDescendants(tracker.class.Issue)', () => {
    const hierarchy = makeHierarchy([tracker.class.Issue])
    issueClassFilter(hierarchy)
    expect(hierarchy.getDescendants).toHaveBeenCalledWith(tracker.class.Issue)
  })

  it('returns exactly what the hierarchy yields (no filtering or reordering)', () => {
    const fakeSubclass = 'test:class:FakeIssueSubclass' as any
    const descendants = [tracker.class.Issue, fakeSubclass]
    const hierarchy = makeHierarchy(descendants)
    const result = issueClassFilter(hierarchy)
    expect(result.$in).toEqual(descendants)
  })

  it('includes the root tracker.class.Issue', () => {
    const fakeSubclass = 'test:class:FakeIssueSubclass' as any
    const hierarchy = makeHierarchy([tracker.class.Issue, fakeSubclass])
    const result = issueClassFilter(hierarchy)
    expect(result.$in).toContain(tracker.class.Issue)
  })

  it('excludes tracker.class.IssueTemplate (not a true Issue descendant — Codex A1)', () => {
    // Realistic hierarchy never returns IssueTemplate from
    // getDescendants(Issue) — IssueTemplate extends core.class.Doc, not
    // Issue. This test pins the contract so a future regression breaks
    // visibly.
    const hierarchy = makeHierarchy([tracker.class.Issue])
    const result = issueClassFilter(hierarchy)
    expect(result.$in).not.toContain(tracker.class.IssueTemplate)
  })
})
