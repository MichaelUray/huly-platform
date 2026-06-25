//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 M10 surface-sweep finding.
//
// People > By role sub-tab pre-fix rendered a single flat AllMembersTab
// with `{ roleIn: [OWNER, MAINTAINER] }`, defeating the point of the
// tab (no role boundary, no Owner-vs-Maintainer count). The fix renders
// one AllMembersTab per role with a single-role preset; this contract
// pins the per-group rendering so the bug cannot regress to a flat
// list silently.
//

import fs from 'fs'
import path from 'path'

const BY_ROLE = path.join(
  __dirname,
  '..',
  'components',
  'people',
  'ByRoleTab.svelte'
)

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('ByRoleTab — M10 per-role grouping', () => {
  it('iterates over an ordered roles array and renders a section per role', () => {
    const src = read(BY_ROLE)
    expect(src).toMatch(/\{#each orderedRoles as r/)
    expect(src).toMatch(/<section class="role-group"/)
  })

  it('passes a single-role preset to each AllMembersTab instance', () => {
    const src = read(BY_ROLE)
    expect(src).toMatch(/preset=\{\{\s*roleIn:\s*\[r\]\s*\}\}/)
  })

  it('orders rendered groups by the privilege ladder', () => {
    const src = read(BY_ROLE)
    // Owner must come before Maintainer in the ROLE_ORDER literal.
    expect(src).toMatch(/'OWNER'[\s\S]*'MAINTAINER'/)
  })

  it('renders a labelled header above each group', () => {
    const src = read(BY_ROLE)
    expect(src).toMatch(/<header class="group-header">/)
    expect(src).toMatch(/<Label label=\{roleHeaderLabel\(r\)\}/)
  })

  it('merges per-group selection into a single Set before bubbling up', () => {
    const src = read(BY_ROLE)
    expect(src).toMatch(/perGroup\.set\(role,/)
    expect(src).toMatch(/dispatch\('selectionChange',\s*merged\)/)
  })
})
