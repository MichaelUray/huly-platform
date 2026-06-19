//
// Copyright © 2026 Hardcore Engineering Inc.
//
// CSV helpers. The primitive escape + line builders are re-exported from
// `@hcengineering/account-client` to preserve the single source-of-truth
// already used by login-resources. We layer two additional helpers on top
// for callers that want full-document building (a list of rows + the
// BOM that Excel-on-Windows needs to interpret UTF-8 correctly).
//

export { csvEscape, csvLine } from '@hcengineering/account-client'
import { csvLine } from '@hcengineering/account-client'

/**
 * Build a complete CSV document body from a 2-D array of values. Each
 * row terminates with CRLF per RFC 4180. Does NOT prepend a BOM — call
 * sites that need Excel-on-Windows compatibility should prepend
 * `csvBomPrefix` separately so streaming endpoints can interleave it
 * with the first chunk.
 */
export function csvRows (rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  let out = ''
  for (const row of rows) out += csvLine(row)
  return out
}

/**
 * UTF-8 byte-order mark as a string (`﻿`). Prepending this to a CSV
 * download is what tells Excel-on-Windows to read the document as UTF-8
 * instead of code-page-1252. The character is one Unicode code point;
 * when the response body is sent as UTF-8, it serializes to the canonical
 * three bytes `0xEF 0xBB 0xBF`.
 */
export const csvBomPrefix = '﻿'
