//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// E7 FIX 1 — CSV bulk-invite dry-run parser source-grep contract.
//
// Pre-E7 the host's dry-run loop ran `for (let i = 0; i < rawLines.length;
// i++)`, i.e. it parsed the `email,role,addToSpaces` header row as a
// data row and surfaced `invalid_email`/`invalid_role` for it. It also
// lacked header-flexible column order, byte/row caps, missing-header
// detection, and duplicate-email detection — all of which live in the
// plugin's `processBulkInviteCsv` and now in the shared
// `previewBulkInviteCsv`.
//
// Behavioural assertions on the parser itself live in the plugin's
// `bulkInviteEndpoints.test.ts` (header-only CSV → zero rows, byte/row
// caps, duplicate detection, etc.). Here we source-grep the host route
// to assert it goes through the plugin parser instead of an inline
// loop.
//

import * as fs from 'fs'
import * as path from 'path'

const INDEX_TS = path.resolve(__dirname, '..', 'index.ts')
const hostSrc = fs.readFileSync(INDEX_TS, 'utf-8')

describe('E7 FIX 1 — CSV bulk-invite dry-run uses plugin parser', () => {
  it('host route calls previewBulkInviteCsv (plugin)', () => {
    expect(hostSrc).toMatch(/previewBulkInviteCsv\(/)
  })

  it('host route no longer carries the inline header-bug loop', () => {
    expect(hostSrc).not.toMatch(/for \(let i = 0; i < rawLines\.length; i\+\+\)/)
  })

  it('host route no longer carries the inline _EMAIL_RE per-row validator', () => {
    // The pre-E7 inline regex used `_EMAIL_RE.test(email)`; the plugin
    // owns email validation now.
    expect(hostSrc).not.toMatch(/const\s+_EMAIL_RE\s*=/)
  })

  it('host route surfaces BulkInviteError code/status (not silent 500)', () => {
    // Verify the route maps plugin BulkInviteError.code/status to the
    // HTTP response rather than swallowing every throw as 500.
    const csvBlock = hostSrc.slice(
      hostSrc.indexOf("'/api/wac/:workspace/invites/bulk-csv'"),
      hostSrc.indexOf('// ── End WAC CSV bulk-invite')
    )
    expect(csvBlock).toMatch(/e\.code|typeof e\.code === 'string'/)
    expect(csvBlock).toMatch(/e\.status/)
  })
})
