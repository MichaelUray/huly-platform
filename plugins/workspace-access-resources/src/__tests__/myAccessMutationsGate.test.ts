//
// Copyright © 2026 Hardcore Engineering Inc.
//
// FIX 4 — preview-gate guard for the "Leave space" + "Decline grant"
// buttons in MyAccessView. The server returns 501
// my_access_mutations_not_wired until the per-caller mutation backend
// (collaborator DELETE + grant DELETE) lands; the client MUST keep the
// buttons hidden in production. This test source-greps the Svelte
// component to assert:
//   - `previewEnabled('myAccessMutations')` is consulted
//   - both buttons are wrapped in an `$myAccessMutationsEnabled` guard
//   - `myAccessMutations` flag is part of the WacCapabilities type
//

import * as fs from 'fs'
import * as path from 'path'

const COMPONENT = path.join(
  __dirname, '..', 'components', 'my-access', 'MyAccessView.svelte'
)
const CAPS_API = path.join(__dirname, '..', 'api', 'capabilitiesApi.ts')

const componentSrc = fs.readFileSync(COMPONENT, 'utf-8')
const capsSrc = fs.readFileSync(CAPS_API, 'utf-8')

describe('FIX 4 — MyAccessView preview-gate for leave/decline buttons', () => {
  it('imports previewEnabled from capabilitiesStore', () => {
    expect(componentSrc).toMatch(/import\s*\{\s*previewEnabled\s*\}\s*from\s*['"][^'"]*capabilitiesStore['"]/)
  })

  it('subscribes to previewEnabled("myAccessMutations")', () => {
    expect(componentSrc).toMatch(/previewEnabled\(\s*['"]myAccessMutations['"]\s*\)/)
  })

  it('Leave button is gated behind $myAccessMutationsEnabled', () => {
    // Match `{#if ... $myAccessMutationsEnabled ...} ... Leave</button> ... {/if}`
    // on one line of the Svelte file. The closing `{/if}` may follow
    // the button immediately (single-line) or be on the next line.
    expect(componentSrc).toMatch(/\{#if[^\n]*\$myAccessMutationsEnabled[^\n]*Leave<\/button>[^\n]*\{\/if\}/)
  })

  it('Decline button is gated behind $myAccessMutationsEnabled', () => {
    expect(componentSrc).toMatch(/\{#if[^\n]*\$myAccessMutationsEnabled[^\n]*Decline<\/button>[^\n]*\{\/if\}/)
  })
})

describe('FIX 4 — WacCapabilities type carries myAccessMutations flag', () => {
  it('declares myAccessMutations: boolean inside preview', () => {
    // Match the preview block + flag declaration. The strip-comments
    // pass keeps the docstring above the flag from matching the regex
    // below.
    expect(capsSrc).toMatch(/preview:\s*\{[\s\S]{0,800}myAccessMutations:\s*boolean/)
  })

  it('DEFAULT_PREVIEW_HIDDEN sets myAccessMutations: false', () => {
    expect(capsSrc).toMatch(/myAccessMutations:\s*false/)
  })
})
