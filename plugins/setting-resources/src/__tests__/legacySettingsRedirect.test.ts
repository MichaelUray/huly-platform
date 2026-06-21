//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
//
// Phase 2 T1 guard tests. Three legacy Settings entries (`Workspace
// Members`, `Guests`, `Global Space Admins`) have been folded into
// Access Center. Per user decision Q-P2-T1 = (b)+hidden the legacy
// routes must KEEP working (deep-link compatibility), but the entries
// must NOT appear in the sidebar.
//
// These tests are source-grep style — we deliberately keep them away
// from the Svelte component-mount stack (which would pull in the entire
// presentation/UI runtime). The contract they pin:
//   1. each legacy component (Members / Spaces / GuestPermissionsSettings)
//      mounts AccessCenterPage, i.e. the shim is in place
//   2. each shim passes an `initialTab` so the right Access Center
//      surface lands on first paint
//   3. the WorkspaceSettings sidebar filter excludes `hidden: true`
//      categories
//   4. the legacy WorkspaceSettingCategory registrations in
//      models/setting/src/index.ts still exist and carry `hidden: true`
//      (proves the deep-link continues to resolve while staying off
//      the sidebar)
//

import fs from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const SETTING_RESOURCES = path.join(REPO_ROOT, 'plugins', 'setting-resources', 'src', 'components')
const MODELS_SETTING_INDEX = path.join(REPO_ROOT, 'models', 'setting', 'src', 'index.ts')
const WORKSPACE_SETTINGS_SVELTE = path.join(SETTING_RESOURCES, 'WorkspaceSettings.svelte')

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('Phase 2 T1 — legacy Settings shims', () => {
  describe('compat-shim components mount AccessCenterPage', () => {
    it('Members.svelte mounts AccessCenterPage with initialTab="people"', () => {
      const src = read(path.join(SETTING_RESOURCES, 'Members.svelte'))
      expect(src).toMatch(/import\s+AccessCenterPage\s+from\s+['"]\.\/AccessCenterPage\.svelte['"]/)
      expect(src).toMatch(/<AccessCenterPage[^/]*initialTab=["']people["']/)
    })

    it('Members.svelte selects the People → All sub-tab', () => {
      const src = read(path.join(SETTING_RESOURCES, 'Members.svelte'))
      expect(src).toMatch(/initialSub=["']all["']/)
    })

    it('Spaces.svelte keeps the legacy AccountArrayEditor + per-role table (B2 revert)', () => {
      // E4 amendment (B2): Codex blocked the Phase 2 shim because the
      // Access Center → Resources tab does NOT expose role assignments
      // on `core.space.Space`. The original editor lives on; the
      // category is hidden in the sidebar via `hidden: true` so the
      // deep-link stays as the only entry point.
      const src = read(path.join(SETTING_RESOURCES, 'Spaces.svelte'))
      expect(src).toMatch(/AccountArrayEditor/)
      expect(src).toMatch(/updateMixin\s*\(/)
      expect(src).not.toMatch(/import\s+AccessCenterPage\s+from\s+['"]\.\/AccessCenterPage\.svelte['"]/)
    })

    it('GuestPermissionsSettings.svelte mounts AccessCenterPage with initialTab="guest-settings"', () => {
      // Phase 2.5 — the shim now lands on the WAC 5th tab that hosts
      // the extracted per-application guest-permission editor, rather
      // than People → By role (which is just a member browser).
      const src = read(path.join(SETTING_RESOURCES, 'GuestPermissionsSettings.svelte'))
      expect(src).toMatch(/import\s+AccessCenterPage\s+from\s+['"]\.\/AccessCenterPage\.svelte['"]/)
      expect(src).toMatch(/<AccessCenterPage[^/]*initialTab=["']guest-settings["']/)
    })

    it('GuestPermissionsSettings.svelte no longer routes through People → By Role', () => {
      // Phase 2.5 — the previous (Phase 2) wiring is obsolete; pin its
      // absence so a future refactor doesn't accidentally restore it.
      const src = read(path.join(SETTING_RESOURCES, 'GuestPermissionsSettings.svelte'))
      expect(src).not.toMatch(/initialSub=["']by-role["']/)
    })
  })

  describe('sidebar filter excludes hidden categories', () => {
    it('WorkspaceSettings.svelte filters out `hidden: true` categories', () => {
      const src = read(WORKSPACE_SETTINGS_SVELTE)
      // The {#each} block must explicitly exclude hidden categories
      // before rendering NavItem entries.
      expect(src).toMatch(/categories\.filter\(\(c\)\s*=>\s*c\.hidden\s*!==\s*true\)/)
    })
  })

  describe('legacy WorkspaceSettingCategory registrations retained with hidden: true', () => {
    const modelSrc = read(MODELS_SETTING_INDEX)

    it('keeps the `owners` (Workspace Members) category registered with hidden: true', () => {
      // Pin both: name field present AND hidden: true within the same
      // createDoc block. Easiest way that survives reordering is to
      // assert both substrings appear and that the snippet between
      // them references the right name.
      const ownersBlock = matchCreateDocBlock(modelSrc, "name: 'owners'")
      expect(ownersBlock).not.toBeNull()
      expect(ownersBlock as string).toMatch(/hidden:\s*true/)
    })

    it('keeps the `guestPermissions` category registered with hidden: true', () => {
      const guestsBlock = matchCreateDocBlock(modelSrc, "name: 'guestPermissions'")
      expect(guestsBlock).not.toBeNull()
      expect(guestsBlock as string).toMatch(/hidden:\s*true/)
    })

    it('keeps the `allSpaces` (Global Space Admins) category registered with hidden: true', () => {
      const spacesBlock = matchCreateDocBlock(modelSrc, "name: 'allSpaces'")
      expect(spacesBlock).not.toBeNull()
      expect(spacesBlock as string).toMatch(/hidden:\s*true/)
    })

    it('Access Center itself is NOT hidden (sanity)', () => {
      const accBlock = matchCreateDocBlock(modelSrc, "name: 'accessCenter'")
      expect(accBlock).not.toBeNull()
      expect(accBlock as string).not.toMatch(/hidden:\s*true/)
    })
  })
})

/**
 * Returns the smallest `{ ... }` createDoc options block in `src` that
 * contains the given marker substring, or null if not found.
 * Walks brace-depth so nested objects are handled correctly.
 */
function matchCreateDocBlock (src: string, marker: string): string | null {
  const markerIdx = src.indexOf(marker)
  if (markerIdx === -1) return null
  // Walk backwards from the marker to the nearest unbalanced `{` (the
  // start of the options-object literal).
  let depth = 0
  let start = -1
  for (let i = markerIdx; i >= 0; i--) {
    const ch = src.charAt(i)
    if (ch === '}') depth++
    else if (ch === '{') {
      if (depth === 0) { start = i; break }
      depth--
    }
  }
  if (start === -1) return null
  // Walk forward to the matching `}`.
  depth = 0
  let end = -1
  for (let i = start; i < src.length; i++) {
    const ch = src.charAt(i)
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null
  return src.slice(start, end + 1)
}
