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
// 2026-06-26 follow-up — the original fix used $$restProps to
// forward `aria-labelledby` to the outer <label>, but ARIA attrs on
// the wrapping label are NOT announced when the input is focused —
// screen readers look for accName on the input itself (then fall
// back to a wrapping label that has text content; this label has
// only the styled span). Toggle.svelte now exposes a dedicated
// `ariaLabelledBy` prop that binds the attribute to the <input>.
// The contract test asserts the editor uses the new prop name so a
// future refactor doesn't drift back to the broken kebab form.
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
const TOGGLE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'ui',
  'src',
  'components',
  'Toggle.svelte'
)

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('GuestPermissionsEditor — M17 + L21 Toggle a11y wiring', () => {
  const src = read(EDITOR)

  it('labels the readonly-guests toggle via ariaLabelledBy prop', () => {
    expect(src).toMatch(/id="gpe-row-readonly-guests"[\s\S]*?<Toggle[\s\S]*?ariaLabelledBy="gpe-row-readonly-guests"/)
  })

  it('labels the guest-sign-up toggle via ariaLabelledBy prop', () => {
    expect(src).toMatch(/id="gpe-row-guest-signup"[\s\S]*?<Toggle[\s\S]*?ariaLabelledBy="gpe-row-guest-signup"/)
  })

  it('labels each per-application module Toggle via ariaLabelledBy prop', () => {
    expect(src).toMatch(/id=\{`gpe-module-\$\{group\._id\}`\}/)
    expect(src).toMatch(/<Toggle[\s\S]*?ariaLabelledBy=\{`gpe-module-\$\{group\._id\}`\}/)
  })

  it('labels each per-permission Toggle via ariaLabelledBy prop', () => {
    expect(src).toMatch(/id=\{`gpe-perm-\$\{group\._id\}-\$\{permissionId\}`\}/)
    expect(src).toMatch(/<Toggle[\s\S]*?ariaLabelledBy=\{`gpe-perm-\$\{group\._id\}-\$\{permissionId\}`\}/)
  })

  it('uses the explicit ariaLabelledBy prop, never the $$restProps kebab attribute', () => {
    // Regression guard: kebab-case attribute lands on the outer
    // <label> (per Toggle's $$restProps spread), which is NOT what
    // screen readers consult for the focused checkbox input.
    expect(src).not.toMatch(/<Toggle[\s\S]{0,400}?aria-labelledby/)
  })

  it('Toggle.svelte binds the aria-* props to the <input>, not the outer <label>', () => {
    const toggle = read(TOGGLE)
    // The dedicated props exist.
    expect(toggle).toMatch(/export let ariaLabelledBy/)
    expect(toggle).toMatch(/export let ariaLabel/)
    expect(toggle).toMatch(/export let ariaDescribedBy/)
    // And they are bound on the <input>, not on the wrapping <label>.
    // We assert by ordering: the <input ... /> block contains the
    // aria-labelledby={ariaLabelledBy} binding.
    expect(toggle).toMatch(
      /<input[\s\S]*?aria-label=\{ariaLabel\}[\s\S]*?aria-labelledby=\{ariaLabelledBy\}[\s\S]*?aria-describedby=\{ariaDescribedBy\}/
    )
  })
})
