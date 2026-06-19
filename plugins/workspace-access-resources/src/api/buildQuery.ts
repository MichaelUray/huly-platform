//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Shared query-string builder for all WAC API modules. Filter objects
// MUST be encoded via `encodeFilterParam` (base64-JSON, validated
// server-side) — never as `JSON.stringify` directly in a URL param or
// as `new URLSearchParams(obj as any)`. Imports the helper from the
// lib's TS source (not main entry) so Jest doesn't have to evaluate
// the lib's Svelte components when running unit tests in this package.
//

import { encodeFilterParam } from '@hcengineering/access-management-ui/src/utils/filterParam'

export interface ListOpts {
  cursor?: string
  sort?: string
  filter?: Record<string, unknown>
  limit?: number
}

export function buildQuery (opts?: ListOpts): string {
  if (opts == null) return ''
  const q = new URLSearchParams()
  if (opts.cursor != null && opts.cursor !== '') q.set('cursor', opts.cursor)
  if (opts.sort != null && opts.sort !== '') q.set('sort', opts.sort)
  if (opts.limit != null) q.set('limit', String(opts.limit))
  if (opts.filter != null && Object.keys(opts.filter).length > 0) {
    q.set('filter', encodeFilterParam(opts.filter))
  }
  const s = q.toString()
  return s === '' ? '' : '?' + s
}
