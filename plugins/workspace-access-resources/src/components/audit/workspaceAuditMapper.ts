//
// Copyright © 2026 Hardcore Engineering Inc.
//

import type { AuditMapper } from '@hcengineering/access-management-ui/src/types/AuditEntry'
import type { AuditRow } from '../../types'

// 2026-06-25 M15 surface-sweep fix — audit table pre-fix rendered
// `e.ts` raw, e.g. `2026-06-19 14:13:00.885415+00`. That's a postgres
// ::text cast of a timestamptz and reads as noise in a 160px column.
//
// Helper normalises the postgres wire format (space → 'T') so
// Date.parse hits the ISO-8601 path consistently across browsers,
// then renders as locale-friendly `YYYY-MM-DD HH:MM`. Falls through
// to the raw string when parsing fails so a malformed-but-meaningful
// timestamp is still visible.
export function fmtAuditTimestamp (v: unknown): string {
  if (v == null) return '—'
  const s = String(v)
  if (s === '') return '—'
  // Postgres ::text on timestamptz yields `YYYY-MM-DD HH:MM:SS.ffff+TZ`
  // where TZ is often the short two-digit offset (`+00`, `-05`). Node's
  // Date.parse only accepts ISO-8601 offsets (`+00:00` / `Z`). Normalise:
  //   1. space → 'T' so the date/time separator is ISO-8601;
  //   2. dangling two-digit timezone → four-digit (`+00` → `+00:00`).
  let isoish = s.includes('T') ? s : s.replace(' ', 'T')
  isoish = isoish.replace(/([+-])(\d{2})$/, '$1$2:00')
  const t = Date.parse(isoish)
  if (!Number.isFinite(t)) return s
  const d = new Date(t)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const workspaceAuditMapper: AuditMapper<AuditRow> = (e) => ({
  actor: e.actor_pseudonym ?? e.actor ?? 'system',
  when: fmtAuditTimestamp(e.ts),
  what: e.action,
  metadata: {
    batch_id: e.metadata?.batch_id,
    impersonation_ref: e.metadata?.impersonation_ref,
    target_account: e.target_account,
    target_space: e.target_space
  }
})
