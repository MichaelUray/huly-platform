//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
//

import { DOMAIN_TASK } from '@hcengineering/model-task'
import tracker from '@hcengineering/tracker'

import { DOMAIN_TRACKER } from '../types'
import { migrateAddStartDate } from '../migration'

// Subset of Issue subclasses we want to assert against in the test.
// Note: tracker.class.IssueTemplate is NOT a true Issue descendant
// (extends core.class.Doc, lives in DOMAIN_TRACKER) — Codex A1
// blocker amendment requires we negative-assert its exclusion.
const FAKE_SUBCLASS = 'test:class:FakeIssueSubclass' as any

describe('migrateAddStartDate', () => {
  function makeClient (descendants: any[]): { update: jest.Mock, getDescendants: jest.Mock } {
    const update = jest.fn().mockResolvedValue(undefined)
    const getDescendants = jest.fn().mockImplementation((cls: any) => {
      if (cls === tracker.class.Issue) {
        return descendants
      }
      return []
    })
    return { update, getDescendants }
  }

  it('uses hierarchy.getDescendants(tracker.class.Issue) for the Issue update', async () => {
    const descendants = [tracker.class.Issue, FAKE_SUBCLASS]
    const { update, getDescendants } = makeClient(descendants)
    const client: any = { update, hierarchy: { getDescendants } }

    await migrateAddStartDate(client)

    expect(getDescendants).toHaveBeenCalledWith(tracker.class.Issue)
  })

  it('issues the DOMAIN_TASK update with _class: { $in: descendants }', async () => {
    const descendants = [tracker.class.Issue, FAKE_SUBCLASS]
    const { update, getDescendants } = makeClient(descendants)
    const client: any = { update, hierarchy: { getDescendants } }

    await migrateAddStartDate(client)

    expect(update).toHaveBeenCalledWith(
      DOMAIN_TASK,
      { _class: { $in: descendants }, startDate: { $exists: false } },
      { startDate: null }
    )
  })

  it('includes tracker.class.Issue itself in the $in set (root class covered)', async () => {
    const descendants = [tracker.class.Issue, FAKE_SUBCLASS]
    const { update, getDescendants } = makeClient(descendants)
    const client: any = { update, hierarchy: { getDescendants } }

    await migrateAddStartDate(client)

    const taskCall = update.mock.calls.find((c) => c[0] === DOMAIN_TASK)
    expect(taskCall).toBeDefined()
    const filterIn: any[] = (taskCall as any[])[1]._class.$in
    expect(filterIn).toContain(tracker.class.Issue)
  })

  it('does NOT include tracker.class.IssueTemplate (not an Issue descendant — Codex A1)', async () => {
    // Realistic hierarchy: getDescendants(Issue) never returns IssueTemplate
    // because IssueTemplate extends core.class.Doc, not Issue. The mock
    // mirrors that — and the test pins the contract so a future regression
    // (someone wiring IssueTemplate under Issue) breaks visibly.
    const descendants = [tracker.class.Issue, FAKE_SUBCLASS]
    const { update, getDescendants } = makeClient(descendants)
    const client: any = { update, hierarchy: { getDescendants } }

    await migrateAddStartDate(client)

    const taskCall = update.mock.calls.find((c) => c[0] === DOMAIN_TASK)
    expect(taskCall).toBeDefined()
    const filterIn: any[] = (taskCall as any[])[1]._class.$in
    expect(filterIn).not.toContain(tracker.class.IssueTemplate)
  })

  it('sets startDate=null on every Milestone lacking the field (DOMAIN_TRACKER)', async () => {
    const { update, getDescendants } = makeClient([tracker.class.Issue])
    const client: any = { update, hierarchy: { getDescendants } }

    await migrateAddStartDate(client)

    expect(update).toHaveBeenCalledWith(
      DOMAIN_TRACKER,
      { _class: tracker.class.Milestone, startDate: { $exists: false } },
      { startDate: null }
    )
  })

  it('issues exactly two update calls (one per domain)', async () => {
    const { update, getDescendants } = makeClient([tracker.class.Issue])
    const client: any = { update, hierarchy: { getDescendants } }

    await migrateAddStartDate(client)

    expect(update).toHaveBeenCalledTimes(2)
  })
})
