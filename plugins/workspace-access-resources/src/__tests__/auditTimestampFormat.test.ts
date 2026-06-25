//
// Copyright © 2026 Hardcore Engineering Inc.
//
// 2026-06-25 M14 + M15 surface-sweep findings.
//
// M14 — DatePicker popup label leaked "Due date — Needs to be completed
// by this date" copy into the audit time-range filter. Pinned via the
// AuditView source asserting that DatePresenter is rendered directly
// (not DatePicker, which can't override label/detail) and that the
// audit-appropriate IntlStrings are passed.
//
// M15 — audit table column rendered the raw postgres timestamptz cast
// (e.g. `2026-06-19 14:13:00.885415+00`). The fmtAuditTimestamp helper
// normalises that wire format and emits `YYYY-MM-DD HH:MM` so the 160px
// column fits.
//

import fs from 'fs'
import path from 'path'

import { fmtAuditTimestamp, workspaceAuditMapper } from '../components/audit/workspaceAuditMapper'

const AUDIT_VIEW = path.join(
  __dirname,
  '..',
  'components',
  'audit',
  'AuditView.svelte'
)

function read (p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

describe('AuditView — M14 DatePresenter override (no Due-date copy)', () => {
  const src = read(AUDIT_VIEW)

  it('does not import or render the upstream DatePicker', () => {
    // The import statement carries the canonical "import …, DatePicker"
    // shape; matching on that catches both styles (named import + the
    // <DatePicker> tag) while ignoring the explanatory comment block.
    expect(src).not.toMatch(/<DatePicker[\s>]/)
    expect(src).not.toMatch(/,\s*DatePicker[,\s}]/)
  })

  it('renders DatePresenter directly with audit-appropriate label + detail', () => {
    // Two pickers (From + To); both must override label + detail.
    const occurrences = (src.match(/<DatePresenter/g) ?? []).length
    expect(occurrences).toBe(2)
    expect(src).toMatch(/label=\{wac\.string\.AuditFilterFrom\}/)
    expect(src).toMatch(/label=\{wac\.string\.AuditFilterTo\}/)
    expect(src).toMatch(/detail=\{ui\.string\.SelectDate\}/)
  })
})

describe('fmtAuditTimestamp — M15 postgres-timestamp normaliser', () => {
  it('renders postgres-shaped timestamps as YYYY-MM-DD HH:MM', () => {
    const got = fmtAuditTimestamp('2026-06-19 14:13:00.885415+00')
    // Local-TZ rendering — we only pin the date-half + the colon
    // separator since the time-half depends on the test host's TZ.
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('passes already-ISO inputs through to the same format', () => {
    const got = fmtAuditTimestamp('2026-06-19T14:13:00.885Z')
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('handles null / empty as em-dash', () => {
    expect(fmtAuditTimestamp(null)).toBe('—')
    expect(fmtAuditTimestamp(undefined)).toBe('—')
    expect(fmtAuditTimestamp('')).toBe('—')
  })

  it('falls back to the raw string on unparseable input', () => {
    expect(fmtAuditTimestamp('not-a-date')).toBe('not-a-date')
  })
})

describe('workspaceAuditMapper — M15 wires the timestamp formatter', () => {
  it('passes e.ts through fmtAuditTimestamp before exposing it as row.when', () => {
    const e = {
      ts: '2026-06-19 14:13:00.885415+00',
      actor: 'alice',
      action: 'role_changed'
    }
    const row = workspaceAuditMapper(e as any)
    expect(row.when).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(row.when).not.toContain('885415')
    expect(row.when).not.toContain('+00')
  })
})
