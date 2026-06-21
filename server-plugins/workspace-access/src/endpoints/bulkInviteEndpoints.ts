//
// Copyright © 2026 Hardcore Engineering Inc.
//
// CSV Bulk-Invite — workspace OWNER (or IMPERSONATING_ADMIN) uploads
// a CSV with `email,role,addToSpaces` rows; server validates per-row
// and either returns a dry-run preview or fires invite-emails.
//
// DSGVO-cleanup contract:
//
//   * Upload file is NEVER persisted — parsed in-memory and discarded
//     after the response returns.
//   * Audit-log row carries only aggregate counts; the per-row email
//     list never leaves this function. Per-row e-mail hashes (sha256)
//     are passed back to the route so the dispatch step can match a
//     send-result back to a row without re-introducing plaintext.
//   * Same hash-only treatment for resend/retry workflows in future
//     iterations.
//

import {
  assertWorkspaceContext,
  getEffectiveRole,
  WRITE_ALLOWED_ROLES,
  Forbidden,
  type RoleCtx,
  type ImpersonationCtx
} from '@hcengineering/access-management-server'
import { createHash } from 'crypto'

export type RowStatus = 'ok' | 'invalid_email' | 'invalid_role' | 'space_not_found' | 'invalid_csv'

export interface BulkInviteRow {
  line: number
  email: string
  /** sha256 hex digest — used for audit/log without plaintext leakage. */
  emailHash: string
  role: string
  addToSpaces: string[]
  status: RowStatus
  detail?: string
}

export interface BulkInviteSummary {
  total: number
  valid: number
  invalid: number
  byStatus: Record<string, number>
}

export interface BulkInvitePreview {
  rows: BulkInviteRow[]
  summary: BulkInviteSummary
}

export interface BulkInviteCtx extends RoleCtx, ImpersonationCtx {
  token: { audience?: string; workspace?: string }
}

export interface BulkInviteOptions {
  workspace: string
  /** Raw CSV bytes (or string) — must be ≤ MAX_CSV_BYTES. */
  csv: string
  dryRun: boolean
  /** Server-known set of valid roles for this workspace. */
  validRoles: ReadonlyArray<string>
  /** Returns true iff the space exists inside the target workspace. */
  spaceExists: (workspace: string, space: string) => Promise<boolean>
}

export interface BulkInviteResult {
  preview: BulkInvitePreview
  /** Set only when dryRun === false: ids the route should call sendInvite for. */
  toSend?: BulkInviteRow[]
  /**
   * DSGVO-cleansed metadata for the audit log. Carries only counts +
   * the actor; the per-row payload (emails) is never exposed here.
   */
  auditMetadata: {
    count: number
    valid: number
    invalid: number
    byStatus: Record<string, number>
  }
}

export const MAX_CSV_BYTES = 1024 * 1024 // 1 MiB cap (multipart enforced by Koa middleware too)
export const MAX_CSV_ROWS = 1000

/** RFC 5322-lite — strict enough to reject obvious garbage. */
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

class BulkInviteError extends Error {
  readonly code: string
  readonly status: number
  constructor (code: string, message: string, status = 400) {
    super(`${code}: ${message}`)
    this.code = code
    this.status = status
  }
}

export { BulkInviteError }

async function gate (ctx: BulkInviteCtx, workspace: string): Promise<void> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== workspace) throw new Forbidden('workspace mismatch')
  const role = await getEffectiveRole(ctx, workspace)
  if (!WRITE_ALLOWED_ROLES.includes(role)) {
    throw new Forbidden(`bulk_invite_not_allowed:${role}`)
  }
}

export function hashEmail (email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/**
 * Split a CSV line honouring double-quoted fields with embedded commas
 * + escaped double-quotes. Intentionally minimal — the spec only
 * requires `email,role,addToSpaces` so we don't need a full RFC 4180
 * parser, just enough to survive the addToSpaces=";"-separated
 * convention living inside a quoted field.
 */
export function splitCsvLine (line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let i = 0
  let inQ = false
  while (i < line.length) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQ = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      inQ = true
      i++
      continue
    }
    if (ch === ',') {
      fields.push(cur)
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  fields.push(cur)
  return fields
}

export function stripBom (s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function normHeader (h: string): string {
  return h.trim().toLowerCase()
}

/**
 * Pure parse-and-validate. Does NOT call sendInvite; the route layer
 * iterates `result.toSend` for that step (when dryRun=false).
 */
export async function processBulkInviteCsv (
  ctx: BulkInviteCtx,
  opts: BulkInviteOptions
): Promise<BulkInviteResult> {
  await gate(ctx, opts.workspace)
  if (opts.csv == null || opts.csv === '') {
    throw new BulkInviteError('empty_csv', 'CSV payload is empty')
  }
  // Byte-size cap (UTF-8). The route enforces multipart limit too,
  // but keep the helper self-contained for unit-tests.
  const byteLength = Buffer.byteLength(opts.csv, 'utf8')
  if (byteLength > MAX_CSV_BYTES) {
    throw new BulkInviteError('csv_too_large', `CSV exceeds ${MAX_CSV_BYTES} bytes`, 413)
  }

  const text = stripBom(opts.csv)
  // Accept CRLF + LF + CR. Drop any trailing empty line so the row
  // count matches the human-visible row count.
  const rawLines = text.split(/\r\n|\r|\n/)
  while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') rawLines.pop()
  if (rawLines.length === 0) {
    throw new BulkInviteError('empty_csv', 'CSV has no rows')
  }
  if (rawLines.length - 1 > MAX_CSV_ROWS) {
    throw new BulkInviteError('too_many_rows', `CSV exceeds ${MAX_CSV_ROWS} data rows`, 413)
  }

  const headerFields = splitCsvLine(rawLines[0]).map(normHeader)
  const emailIdx = headerFields.indexOf('email')
  const roleIdx = headerFields.indexOf('role')
  const spacesIdx = headerFields.indexOf('addtospaces')
  if (emailIdx < 0 || roleIdx < 0) {
    throw new BulkInviteError('missing_header', 'CSV header must contain at least "email" and "role" columns')
  }

  const rows: BulkInviteRow[] = []
  const seenEmails = new Set<string>()
  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (line.trim() === '') continue
    const fields = splitCsvLine(line)
    const emailRaw = (fields[emailIdx] ?? '').trim()
    const roleRaw = (fields[roleIdx] ?? '').trim()
    const spacesRaw = spacesIdx >= 0 ? (fields[spacesIdx] ?? '').trim() : ''

    const emailHash = hashEmail(emailRaw)
    const addToSpaces = spacesRaw === ''
      ? []
      : spacesRaw.split(';').map((s) => s.trim()).filter((s) => s !== '')

    let status: RowStatus = 'ok'
    let detail: string | undefined

    if (emailRaw === '' || !EMAIL_RX.test(emailRaw)) {
      status = 'invalid_email'
      detail = 'email does not match the expected pattern'
    } else if (seenEmails.has(emailRaw.toLowerCase())) {
      status = 'invalid_csv'
      detail = 'duplicate email in CSV'
    } else if (!opts.validRoles.includes(roleRaw)) {
      status = 'invalid_role'
      detail = `role "${roleRaw}" not in allowed set`
    } else {
      seenEmails.add(emailRaw.toLowerCase())
      // Verify spaces exist. We treat the first missing space as the
      // error reason; subsequent rows still get the same treatment.
      for (const sp of addToSpaces) {
        if (!(await opts.spaceExists(opts.workspace, sp))) {
          status = 'space_not_found'
          detail = `space "${sp}" not found in workspace`
          break
        }
      }
    }

    rows.push({
      line: i + 1, // 1-based, header is line 1
      email: emailRaw,
      emailHash,
      role: roleRaw,
      addToSpaces,
      status,
      detail
    })
  }

  const byStatus: Record<string, number> = {}
  let valid = 0
  let invalid = 0
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    if (r.status === 'ok') valid++
    else invalid++
  }

  const summary: BulkInviteSummary = {
    total: rows.length,
    valid,
    invalid,
    byStatus
  }

  const result: BulkInviteResult = {
    preview: { rows, summary },
    auditMetadata: {
      count: summary.total,
      valid: summary.valid,
      invalid: summary.invalid,
      byStatus
    }
  }

  if (!opts.dryRun) {
    if (invalid > 0) {
      throw new BulkInviteError('invalid_rows_present', 'Refusing to dispatch — fix the invalid rows first', 422)
    }
    result.toSend = rows.filter((r) => r.status === 'ok')
  }
  return result
}

/**
 * Build the DSGVO-cleansed view of a row that's safe to surface in a
 * response body (e.g. JSON preview the API user receives back). It
 * carries the original `email` field because the user MUST be able
 * to read what they uploaded; but the audit log + log lines should
 * use `emailHash` only.
 */
export function previewRowForResponse (r: BulkInviteRow): {
  line: number
  email: string
  role: string
  addToSpaces: string[]
  status: RowStatus
  detail?: string
} {
  return {
    line: r.line,
    email: r.email,
    role: r.role,
    addToSpaces: r.addToSpaces,
    status: r.status,
    detail: r.detail
  }
}
