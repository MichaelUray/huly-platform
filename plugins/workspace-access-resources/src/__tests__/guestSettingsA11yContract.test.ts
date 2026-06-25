//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 M17 + L21 surface-sweep finding.
//
// The Guest Settings editor (mounted as the WAC 5th tab and via the
// legacy `/setting/guestPermissions` shim) renders its access /
// permission toggles via the @hcengineering/ui Toggle component,
// which is a <label> wrapping an <input type="checkbox"> with NO
// text content. Pre-fix the visible row label sat in a sibling div
// with no programmatic association, so axe / NVDA reported every
// toggle as an anonymous checkbox.
//
// Fix gives every row-label a stable id and threads it back through
// aria-labelledby on the corresponding Toggle. Toggle already
// forwards $$restProps to the wrapping <label>, so aria-labelledby
// lands on the parent of the <input> and is announced by SR when the
// input is focused.
//

import fs from 'fs'
import path from 'path'

const EDITOR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'setting-resources',
  'src',
  'components',
  'GuestPermissionsEditor.svelte'
)

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('GuestPermissionsEditor — M17 + L21 Toggle a11y wiring', () => {
  const src = read(EDITOR)

  it('labels the readonly-guests toggle via aria-labelledby', () => {
    expect(src).toMatch(/id="gpe-row-readonly-guests"[\s\S]*?<Toggle[\s\S]*?aria-labelledby="gpe-row-readonly-guests"/)
  })

  it('labels the guest-sign-up toggle via aria-labelledby', () => {
    expect(src).toMatch(/id="gpe-row-guest-signup"[\s\S]*?<Toggle[\s\S]*?aria-labelledby="gpe-row-guest-signup"/)
  })

  it('labels each per-application module Toggle via aria-labelledby', () => {
    expect(src).toMatch(/id=\{`gpe-module-\$\{group\._id\}`\}/)
    expect(src).toMatch(/<Toggle[\s\S]*?aria-labelledby=\{`gpe-module-\$\{group\._id\}`\}/)
  })

  it('labels each per-permission Toggle via aria-labelledby', () => {
    expect(src).toMatch(/id=\{`gpe-perm-\$\{group\._id\}-\$\{permissionId\}`\}/)
    expect(src).toMatch(/<Toggle[\s\S]*?aria-labelledby=\{`gpe-perm-\$\{group\._id\}-\$\{permissionId\}`\}/)
  })
})
