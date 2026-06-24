//
// Copyright © 2026 Hardcore Engineering Inc.
//
// FIX 5 / E8 — preview-gate guard for the "Add to Space" +
// "Remove from Space" buttons in the People bulk-bar. The server
// returns 501 members_bulk_space_mutations_not_wired until the
// workspace TxOperations bulk-edit path through the plugin's
// setSpaceMembers is wired; the client MUST keep those buttons
// hidden in production so SpacePickerModal never opens. This test
// source-greps PeopleBulkBar.svelte to assert:
//   - `previewEnabled('membersBulkSpaceMutations')` is consulted
//   - both bulk-bar buttons are wrapped in `$previewMembersBulkSpace`
//   - `membersBulkSpaceMutations` flag is part of WacCapabilities
//
// Mirror of myAccessMutationsGate.test.ts per Codex E8 recommendation.
//

import * as fs from 'fs'
import * as path from 'path'

const COMPONENT = path.join(
  __dirname, '..', 'components', 'people', 'PeopleBulkBar.svelte'
)
const CAPS_API = path.join(__dirname, '..', 'api', 'capabilitiesApi.ts')

const componentSrc = fs.readFileSync(COMPONENT, 'utf-8')
const capsSrc = fs.readFileSync(CAPS_API, 'utf-8')

describe('FIX 5 — PeopleBulkBar preview-gate for Add/Remove-to-Space buttons', () => {
  it('imports previewEnabled from capabilitiesStore', () => {
    expect(componentSrc).toMatch(/import\s*\{\s*previewEnabled\s*\}\s*from\s*['"][^'"]*capabilitiesStore['"]/)
  })

  it('subscribes to previewEnabled("membersBulkSpaceMutations")', () => {
    expect(componentSrc).toMatch(/previewEnabled\(\s*['"]membersBulkSpaceMutations['"]\s*\)/)
  })

  it('Add-to-Space button is gated behind $previewMembersBulkSpace', () => {
    // The Add-to-Space button dispatches 'addToSpace'. The strict regex
    // requires the {#if $previewMembersBulkSpace} block to wrap the
    // BulkAddToSpace label + on:click handler.
    expect(componentSrc).toMatch(
      /\{#if\s*\$previewMembersBulkSpace\s*\}[\s\S]{0,800}BulkAddToSpace[\s\S]{0,300}dispatch\(['"]addToSpace['"]\)/
    )
  })

  it('Remove-from-Space button is gated behind $previewMembersBulkSpace', () => {
    expect(componentSrc).toMatch(
      /\{#if\s*\$previewMembersBulkSpace\s*\}[\s\S]{0,800}BulkRemoveFromSpace[\s\S]{0,300}dispatch\(['"]removeFromSpace['"]\)/
    )
  })

  it('both buttons live inside the SAME guard block (closed by a single {/if})', () => {
    // Ensure the regex above didn't accidentally allow two separate
    // preview-blocks. Both labels must appear before the next {/if}.
    const guardBlock = componentSrc.match(
      /\{#if\s*\$previewMembersBulkSpace\s*\}([\s\S]*?)\{\/if\}/
    )
    expect(guardBlock).not.toBeNull()
    const inner = guardBlock?.[1] ?? ''
    expect(inner).toMatch(/BulkAddToSpace/)
    expect(inner).toMatch(/BulkRemoveFromSpace/)
  })
})

describe('FIX 5 — WacCapabilities type carries membersBulkSpaceMutations flag', () => {
  it('declares membersBulkSpaceMutations: boolean inside preview', () => {
    expect(capsSrc).toMatch(/preview:\s*\{[\s\S]{0,1200}membersBulkSpaceMutations:\s*boolean/)
  })

  it('DEFAULT_PREVIEW_HIDDEN sets membersBulkSpaceMutations: false', () => {
    expect(capsSrc).toMatch(/membersBulkSpaceMutations:\s*false/)
  })
})
