//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 M16 surface-sweep finding.
//
// PresetsView's Create-Form pre-fix exposed a raw comma-separated
// UUID textarea for "Add to spaces" — the operator had to grep
// space-IDs out of the URL bar and paste them by hand. The fix swaps
// the textarea for a chip-list + "+ Add space" button that opens the
// shared SpacePickerModal (same modal PeopleView + PeopleBulkBar use
// for Add/Remove-to-Space).
//
// This contract pins the chip-list rendering, the SpacePickerModal
// wiring, and the locale strings that drive the new UI so the bug
// cannot regress to a raw textarea silently.
//

import fs from 'fs'
import path from 'path'

const PRESETS_VIEW = path.join(
  __dirname,
  '..',
  'components',
  'presets',
  'PresetsView.svelte'
)

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('PresetsView — M16 space-picker chip UI', () => {
  const src = read(PRESETS_VIEW)

  it('imports the shared SpacePickerModal from people/', () => {
    expect(src).toMatch(/import SpacePickerModal from '\.\.\/people\/SpacePickerModal\.svelte'/)
  })

  it('drops the comma-separated raw-UUID textarea', () => {
    // The previous binding (`formSpacesText`) and the corresponding
    // <textarea> for the spaces field must both be gone.
    expect(src).not.toMatch(/formSpacesText/)
    expect(src).not.toMatch(/bind:value=\{formSpacesText\}/)
  })

  it('holds the addToSpaces field as a string[] (formSpaces)', () => {
    expect(src).toMatch(/let formSpaces:\s*string\[\]\s*=\s*\[\]/)
    // Submit must spread that array into the API shape.
    expect(src).toMatch(/addToSpaces:\s*\[\.\.\.formSpaces\]/)
  })

  it('opens SpacePickerModal via showPopup on the +Add-space button', () => {
    expect(src).toMatch(/showPopup\(SpacePickerModal,\s*\{[\s\S]*?mode:\s*'add'/)
    expect(src).toMatch(/<Button[\s\S]*?label=\{wac\.string\.PresetAddSpace\}/)
  })

  it('renders one chip per UUID and a remove-handle each', () => {
    expect(src).toMatch(/\{#each formSpaces as id/)
    expect(src).toMatch(/<span class="chip">/)
    expect(src).toMatch(/<button[\s\S]*?class="chip-remove"/)
  })

  it('de-dupes IDs returned by the picker', () => {
    expect(src).toMatch(/if\s*\(!formSpaces\.includes\(spaceId\)\)/)
  })
})

describe('PresetAddSpace IntlString is wired and translated', () => {
  it('appears in plugin.ts as an IntlString stub', () => {
    const pluginSrc = fs.readFileSync(
      path.join(__dirname, '..', 'plugin.ts'),
      'utf-8'
    )
    expect(pluginSrc).toMatch(/PresetAddSpace:\s*''\s*as\s*IntlString/)
  })

  it('lands in every shipped locale (en + de canonical check)', () => {
    const en = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', '..', 'lang', 'en.json'),
        'utf-8'
      )
    )
    const de = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', '..', 'lang', 'de.json'),
        'utf-8'
      )
    )
    expect(en.string.PresetAddSpace).toBeDefined()
    expect(en.string.PresetAddSpace.length).toBeGreaterThan(0)
    expect(de.string.PresetAddSpace).toBeDefined()
    expect(de.string.PresetAddSpace.length).toBeGreaterThan(0)
  })
})
