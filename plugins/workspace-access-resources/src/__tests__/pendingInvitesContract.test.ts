//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 H9 + M13 — surface-sweep findings for the
// People > Pending Invites tab.
//
// The wire payload from /api/wac/<ws>/invites is:
//   { email: 'unknown' | <addr>, invitedBy: 'system' | <uuid>,
//     invitedAt: null,            expiresAt: <epoch-ms-as-string> }
//
// The EntityTable default cell renderer would render the raw value of
// each `col.key`, which produces:
//   • literal 'unknown' in the Email column (because the SQL fallback
//     hardcodes 'unknown' when global_account.invite.email is NULL),
//   • an empty Sent column (invitedAt is always null today — the
//     schema doesn't track creation time, see V1 migration),
//   • a raw epoch-ms string in the Expires column (postgres ::text
//     cast on bigint).
//
// This test pins the `<svelte:fragment slot="cell" ...>` shape in
// PendingInvitesTab.svelte so a future refactor that drops the cell
// slot reverts the UX to the silent-bad-data state.
//

import fs from 'fs'
import path from 'path'

const SVELTE_PATH = path.join(
  __dirname,
  '..',
  'components',
  'people',
  'PendingInvitesTab.svelte'
)

function read (): string {
  return fs.readFileSync(SVELTE_PATH, 'utf-8')
}

describe('PendingInvitesTab — H9 + M13 cell-mapping fix', () => {
  it('defines fmtEmail + fmtDateMs helpers', () => {
    const src = read()
    expect(src).toMatch(/function fmtEmail\s*\(/)
    expect(src).toMatch(/function fmtDateMs\s*\(/)
  })

  it('maps the literal "unknown" email fallback to an em-dash', () => {
    const src = read()
    // Look for the conditional that catches the SQL fallback string.
    expect(src).toMatch(/s === 'unknown'/)
  })

  it('formats invitedAt + expiresAt via the date helper (not raw value)', () => {
    const src = read()
    // Match the slot wiring: each of the three columns hands its
    // value to a helper rather than spilling the raw payload.
    expect(src).toContain('fmtEmail(item.email)')
    expect(src).toContain('fmtDateMs(item.invitedAt)')
    expect(src).toContain('fmtDateMs(item.expiresAt)')
  })

  it('keeps the documented column order email / invitedBy / invitedAt / expiresAt', () => {
    // Pin the column array so a swap of invitedAt <-> expiresAt
    // (the exact surface-sweep finding) breaks the test loudly.
    const src = read()
    const colsBlock = src.match(/const columns:[\s\S]*?]\s*\n/)?.[0] ?? ''
    expect(colsBlock).not.toBe('')
    const emailIdx = colsBlock.indexOf("'email'")
    const invitedByIdx = colsBlock.indexOf("'invitedBy'")
    const invitedAtIdx = colsBlock.indexOf("'invitedAt'")
    const expiresAtIdx = colsBlock.indexOf("'expiresAt'")
    expect(emailIdx).toBeGreaterThanOrEqual(0)
    expect(invitedByIdx).toBeGreaterThan(emailIdx)
    expect(invitedAtIdx).toBeGreaterThan(invitedByIdx)
    expect(expiresAtIdx).toBeGreaterThan(invitedAtIdx)
  })
})
