//
// Copyright © 2026 Hardcore Engineering Inc.
//
// C5 guard test — source-grep across src/components/**/*.svelte for
// `getEmbeddedLabel(...)` usage. Hardcoded strings prevent translators
// from contributing without editing .svelte sources.
//
// Two legitimate dynamic-fallback uses are allowlisted (see ALLOWLIST
// below). Every other occurrence is a regression.
//

import fs from 'fs'
import path from 'path'

const COMPONENTS_DIR = path.join(__dirname, '..', 'components')
const PROJECT_ROOT = path.join(__dirname, '..', '..')

interface Hit { file: string; line: number; snippet: string }

function walk (dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.svelte')) out.push(full)
  }
  return out
}

function scan (): Hit[] {
  const hits: Hit[] = []
  for (const file of walk(COMPONENTS_DIR)) {
    const text = fs.readFileSync(file, 'utf-8')
    text.split('\n').forEach((line: string, i: number) => {
      // Match getEmbeddedLabel( regardless of whitespace; ignore SCSS
      // comment-only lines (the leading `//` or `/*` strip is naive but
      // adequate for the call-site shapes we have).
      const trimmed = line.replace(/^\s*\/\/.*$/, '')
      if (/getEmbeddedLabel\s*\(/.test(trimmed)) {
        hits.push({
          file: path.relative(PROJECT_ROOT, file),
          line: i + 1,
          snippet: line.trim()
        })
      }
    })
  }
  return hits
}

// Allowlist: each entry is a `file:line` of a legitimate dynamic-label
// fallback. Bump the line number if the file is edited; bump the list
// itself only when adding a NEW dynamic fallback (rare).
const ALLOWLIST = new Set<string>([
  // AccessCenter — falls back to the raw tab id when a new tab id is
  // introduced without a registered IntlString. Allows the tabs list to
  // grow without breaking the UI.
  'src/components/AccessCenter.svelte:88',
  // MemberPickerInput — `placeholder` is a caller-supplied raw string;
  // each caller is responsible for keying its own copy. Removing this
  // would force MemberPickerInput to accept an IntlString instead,
  // which is a wider refactor than C5's scope.
  'src/components/shared/MemberPickerInput.svelte:84'
])

describe('no hardcoded strings (getEmbeddedLabel sweep)', () => {
  const hits = scan()

  it('reports only allowlisted dynamic-fallback uses', () => {
    const offenders = hits.filter((h) => !ALLOWLIST.has(`${h.file}:${h.line}`))
    if (offenders.length > 0) {
      const msg = offenders.map((h) => `  - ${h.file}:${h.line}  ${h.snippet}`).join('\n')
      throw new Error(
        `Found ${offenders.length} hardcoded getEmbeddedLabel call(s) outside the allowlist:\n${msg}\n\n` +
          `Replace each with an IntlString from plugin.ts, or extend ALLOWLIST in this test ` +
          `if the use is genuinely dynamic (and document why).`
      )
    }
  })

  it('total getEmbeddedLabel call-sites match the documented allowlist size', () => {
    // Tripwire: if total count ever drifts from ALLOWLIST.size, either
    // a regression slipped through or someone removed a fallback
    // without updating the allowlist.
    expect(hits.length).toBe(ALLOWLIST.size)
  })
})
