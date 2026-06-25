//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 L19 + L20 surface-sweep findings.
//
// L19 — PersonDrawer 'Effective permissions' caret stayed '▸' even
// when the section was expanded (the CSS rotate(90deg) didn't
// survive every font / line-height stack). Fix renders the glyph
// reactively so the character itself encodes the state.
//
// L20 — ResourcesView panel missed the data-active-sub attribute
// that PeopleView already exposes, so smoke-tests / Playwright
// assertions couldn't pin the active sub-tab without scraping
// TabList internals.
//

import fs from 'fs'
import path from 'path'

const PERSON_DRAWER = path.join(
  __dirname,
  '..',
  'components',
  'people',
  'PersonDrawer.svelte'
)
const RESOURCES_VIEW = path.join(
  __dirname,
  '..',
  'components',
  'resources',
  'ResourcesView.svelte'
)

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('PersonDrawer — L19 reactive caret glyph', () => {
  it('renders a ternary glyph driven by epOpen', () => {
    const src = read(PERSON_DRAWER)
    expect(src).toMatch(/\{epOpen \?\s*'▾'\s*:\s*'▸'\}/)
  })
})

describe('ResourcesView — L20 data-active-sub attribute parity', () => {
  it('exposes data-active-sub={sub} on the panel root', () => {
    const src = read(RESOURCES_VIEW)
    expect(src).toMatch(/data-active-sub=\{sub\}/)
  })
})
