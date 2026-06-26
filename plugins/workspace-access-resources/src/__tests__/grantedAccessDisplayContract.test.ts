//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 M11 + M12 — surface-sweep findings for the
// People > Granted access tab.
//
// M11 — "GRANTED BY" column rendered raw values that the server-side
//       name resolution couldn't map: 'core:account:System' for the
//       system actor and numeric account IDs for legacy / pre-Wave-1
//       accounts whose person row was never created.
//
// M12 — "GRANTED AT" column rendered the raw postgres ::text cast
//       of a timestamptz (e.g. `2026-06-19 14:13:00.885415+00`).
//       Unscannable for a column 160px wide.
//
// The fix is two display-layer helpers in GrantedAccessTab.svelte:
//   • fmtGranterName  — sentinel mapping + numeric-ID diagnostic.
//   • fmtGrantedAt    — postgres-timestamptz → ISO date-only.
//

import fs from 'fs'
import path from 'path'

const SVELTE_PATH = path.join(
  __dirname,
  '..',
  'components',
  'people',
  'GrantedAccessTab.svelte'
)

function read (): string {
  return fs.readFileSync(SVELTE_PATH, 'utf-8')
}

describe('GrantedAccessTab — M11 + M12 display-layer formatters', () => {
  it('defines fmtGranterName and fmtGrantedAt', () => {
    const src = read()
    expect(src).toMatch(/function fmtGranterName\s*\(/)
    expect(src).toMatch(/function fmtGrantedAt\s*\(/)
  })

  it('M11 maps the core:account:System sentinel to a humane label', () => {
    const src = read()
    expect(src).toContain("'core:account:System'")
    // The label should mention System
    expect(src).toMatch(/return 'System'/)
  })

  it('M11 detects long numeric account IDs and surfaces a diagnostic label', () => {
    // Numeric IDs >= 15 digits → no person row → tag as Unknown(…tail).
    const src = read()
    expect(src).toMatch(/\\d\{15,\}/)
    expect(src).toContain('Unknown')
  })

  it('M12 parses postgres timestamptz text via Date.parse + slices to ISO date', () => {
    const src = read()
    // Detect the space→T normalisation that postgres ::text needs.
    expect(src).toMatch(/replace\(' ', 'T'\)/)
    expect(src).toMatch(/slice\(0, 10\)/)
  })

  it('M12 follow-up — also handles bigint epoch-ms strings (Huly createdOn shape)', () => {
    // Surface-sweep r14 re-verify (2026-06-26) showed GRANTED AT still
    // rendered raw `1782315313814`. Huly's `createdOn` column is bigint
    // (epoch-ms), so the server's `::text` cast yields a numeric string
    // rather than a Postgres timestamptz. The fix detects 10+ digit
    // strings and treats them as epoch-ms before falling back to the
    // timestamptz path.
    const src = read()
    expect(src).toMatch(/\^-\?\\d\{10,\}\$/)
    expect(src).toMatch(/new Date\(n\)/)
  })

  it('cell slot wires the granterName + grantedAt columns to the helpers', () => {
    const src = read()
    expect(src).toContain('fmtGranterName(item.granterName, item.granterUuid)')
    expect(src).toContain('fmtGrantedAt(item.grantedAt)')
  })
})
