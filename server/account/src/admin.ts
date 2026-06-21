//
// Copyright © 2025 Hardcore Engineering Inc.
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

interface AdminEmailsLogger {
  warn?: (msg: string, attrs?: Record<string, unknown>) => void
}

/**
 * Parse the ADMIN_EMAILS env value into a normalized Set.
 *
 * - split on ','
 * - trim() each entry
 * - toLowerCase() each entry
 * - drop empty entries
 * - entries without '@' are ignored with a warning (Codex Optional:
 *   warn-don't-reject — keep latent hardening fix non-disruptive).
 */
export function parseAdminEmails (
  envValue: string | undefined,
  logger?: AdminEmailsLogger
): Set<string> {
  if (envValue == null || envValue === '') return new Set()
  const entries = envValue
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  const valid: string[] = []
  const invalid: string[] = []
  for (const entry of entries) {
    if (entry.includes('@')) valid.push(entry)
    else invalid.push(entry)
  }
  if (invalid.length > 0) {
    const warn = logger?.warn ?? ((msg: string, attrs?: Record<string, unknown>) => {
      // eslint-disable-next-line no-console
      console.warn(msg, attrs)
    })
    warn('ADMIN_EMAILS contains entries without "@" (ignored)', { invalid })
  }
  return new Set(valid)
}

const ADMIN_EMAILS = parseAdminEmails(process.env.ADMIN_EMAILS)

export function isAdminEmail (email: string | null | undefined): boolean {
  if (email == null || email === '') return false
  return ADMIN_EMAILS.has(email.trim().toLowerCase())
}
