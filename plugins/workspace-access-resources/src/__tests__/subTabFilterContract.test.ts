//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 H1 + H2/H3/H4/H5 + H6 surface-sweep findings.
//
// All five Resources sub-tabs (Private only / Public only / Archived
// / Auto-join) and People > Inactive (90d+) showed every workspace
// row regardless of the active filter, because the sub-tab preset
// was sent to the server but `handleSpaces` / `handleMembers`
// ignored the `?filter=…` query param. HTTP 200, JSON well-formed,
// data wrong — the same silent-bug family as the /invites
// `created_on` regression fixed earlier.
//
// The fix is client-side filtering (`matchesPreset` in AllSpacesTab,
// `applyPresetFilter` in AllMembersTab) so the table never spills
// un-filtered rows into a sub-tab. The keys + values match what the
// server filter would consume so a future backend-filter landing
// stays a drop-in.
//
// H6 also pins the v2-placeholder rows behind the search predicate
// so typing `zzz_no_match_test` no longer leaves Chat Channels,
// Office Rooms, Guest Links visible.
//

import fs from 'fs'
import path from 'path'

const ALL_SPACES = path.join(
  __dirname,
  '..',
  'components',
  'resources',
  'AllSpacesTab.svelte'
)
const ALL_MEMBERS = path.join(
  __dirname,
  '..',
  'components',
  'people',
  'AllMembersTab.svelte'
)

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('Resources AllSpacesTab — H2/H3/H4/H5 + H6 filter propagation', () => {
  it('defines a client-side preset matcher used by filteredSpaces', () => {
    const src = read(ALL_SPACES)
    expect(src).toMatch(/function matchesPreset\s*\(s:\s*SpaceRow\)/)
    // Used in the reactive filter chain
    expect(src).toContain('matchesPreset(s) && matchesSearch(s)')
  })

  it('only emits the v2-placeholder rows when there is no preset AND no search', () => {
    // H6 — placeholders pre-fix bypassed the search predicate, so
    // typing `zzz_no_match_test` left Chat Channels / Office Rooms /
    // Guest Links visible. The placeholders are now sticky ONLY in
    // the default view.
    const src = read(ALL_SPACES)
    expect(src).toMatch(/Object\.keys\(preset\)\.length === 0[\s\S]*?q === ''/)
    expect(src).toContain('showPlaceholders ? [...real, ...v2Placeholders] : real')
  })
})

describe('People AllMembersTab — H1 filter propagation', () => {
  it('defines applyPresetFilter and uses it in both refresh and loadNext', () => {
    const src = read(ALL_MEMBERS)
    expect(src).toMatch(/function applyPresetFilter\s*\(rows:\s*MemberRow\[\]\)/)
    // refresh() should consume the filter
    expect(src).toMatch(/items = applyPresetFilter\(res\.items\)/)
    // loadNext() too, otherwise the paginated tail leaks un-filtered rows
    expect(src).toMatch(/\[\.\.\.items, \.\.\.applyPresetFilter\(res\.items\)\]/)
  })

  it('handles activityBucketIn as an array containment check (Inactive 90d+ shape)', () => {
    const src = read(ALL_MEMBERS)
    expect(src).toMatch(/activityBucketIn[\s\S]*?Array\.isArray\(want\)[\s\S]*?want\.includes\(r\.activityBucket\)/)
  })
})
