//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

import * as fs from 'fs'
import * as path from 'path'

// Phase 0 Task 4 — No-Stubs rule D8.
//
// Every WAC read route in src/index.ts previously returned hard-coded
// fixtures with HTTP 200 when the workspace could not be resolved or pg
// threw. That masked production errors as valid responses; my-access in
// particular returned role=OWNER which is a privilege-escalation vector.
//
// This test is a source-level grep guard: it asserts none of the legacy
// demo strings remain in the WAC route block. It is intentionally
// pessimistic so any reintroduction of fixture data trips CI.
describe('WAC routes — No-Stubs rule (no demo/fixture fallbacks)', () => {
  const indexSrc = fs.readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf-8')

  const bannedLiterals = [
    'Alice Owner',
    'Bob Maintainer',
    'Carol User',
    'alice@demo.test',
    'bob@demo.test',
    'carol@demo.test',
    'Demo Project',
    'Demo Teamspace',
    'Demo Space',
    'demo-space-1',
    'demo-space-2',
    "uuid: 'demo-1'",
    "uuid: 'demo-2'",
    "uuid: 'demo-3'"
  ]

  for (const literal of bannedLiterals) {
    it(`does not contain the banned fixture literal ${JSON.stringify(literal)}`, () => {
      expect(indexSrc.includes(literal)).toBe(false)
    })
  }

  it('my-access fallback does not return role: \'OWNER\' unconditionally', () => {
    // The pre-fix code ended my-access with a 200 response containing
    //   role: 'OWNER', spacesMemberOf: [], spacesOwned: [], grantsReceived: [], grantsGiven: []
    // as a privilege-escalation fallback. Catch any literal that pairs
    // a hardcoded OWNER role with empty grant arrays in the same line.
    const offending = indexSrc.match(/role:\s*'OWNER'[^\n]*grantsReceived/i)
    expect(offending).toBeNull()
  })

  it('replaces fallback patterns with proper error responses', () => {
    // Sanity-check that the new error contract is wired up. We expect at
    // least one workspace_not_found 404 and one wac_read_failed 500 to
    // appear in the WAC routes block.
    expect(indexSrc).toMatch(/workspace_not_found/)
    expect(indexSrc).toMatch(/wac_read_failed/)
  })

  it('no longer logs "fallback to fixtures" or "fallback to empty"', () => {
    // Old warn() lines indicated silent error swallowing. Removed.
    expect(indexSrc).not.toMatch(/fallback to fixtures/)
    expect(indexSrc).not.toMatch(/fallback to fixture/)
    expect(indexSrc).not.toMatch(/fallback to empty/)
  })
})
