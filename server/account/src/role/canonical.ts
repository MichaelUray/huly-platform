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
// ---------------------------------------------------------------------------
// Canonical role conversion at the AccountDB boundary.
//
// THREE FORMS — never confuse them, never use string casts to bridge them:
//
//   Wire (REST):    'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
//                 | 'READONLY_GUEST' | 'DOC_GUEST' | 'ADMIN'
//
//   Canonical (TS): AccountRole enum from @hcengineering/core.
//                   AccountRole.ReadOnlyGuest === 'READONLYGUEST'
//                   AccountRole.DocGuest      === 'DocGuest'   (mixed-case!)
//                   AccountRole.Admin         === 'ADMIN'
//
//   DB (Postgres enum / Mongo string):
//                   'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
//                 | 'READONLYGUEST' | 'DOCGUEST' | 'ADMIN'
//
// The bug we are fixing: WAC was writing wire-form ('READONLY_GUEST',
// 'DOC_GUEST') straight to workspace_members.role via `role as any`. The
// DB enum only accepts the DB form, so round-trips broke. The durable
// fix is at the AccountDB persistence boundary: every read converts
// DB→canonical, every write converts canonical→DB.
//
// AccountRole.Admin is included for completeness — the DB enum currently
// has no ADMIN value (`workspace_role` enum lacks it), so attempting to
// persist an Admin role will fail at the DB level. canonicalToDb still
// returns 'ADMIN' for forward-compat: when the enum is extended, no
// helper change is required.
// ---------------------------------------------------------------------------

import { AccountRole } from '@hcengineering/core'

export type WireRole =
  | 'OWNER'
  | 'MAINTAINER'
  | 'USER'
  | 'GUEST'
  | 'READONLY_GUEST'
  | 'DOC_GUEST'
  | 'ADMIN'

export type DbRole =
  | 'OWNER'
  | 'MAINTAINER'
  | 'USER'
  | 'GUEST'
  | 'READONLYGUEST'
  | 'DOCGUEST'
  | 'ADMIN'

/**
 * Convert REST wire form → TS canonical AccountRole.
 * Returns null for invalid / mis-cased input. Callers MUST treat null as
 * 400 bad_role at the HTTP boundary; never silently fall through.
 */
export function wireToCanonical (wire: string): AccountRole | null {
  switch (wire) {
    case 'OWNER':
      return AccountRole.Owner
    case 'MAINTAINER':
      return AccountRole.Maintainer
    case 'USER':
      return AccountRole.User
    case 'GUEST':
      return AccountRole.Guest
    case 'READONLY_GUEST':
      return AccountRole.ReadOnlyGuest
    case 'DOC_GUEST':
      return AccountRole.DocGuest
    case 'ADMIN':
      return AccountRole.Admin
    default:
      return null
  }
}

/** Convert TS canonical AccountRole → REST wire form. Total over the enum. */
export function canonicalToWire (canonical: AccountRole): WireRole {
  switch (canonical) {
    case AccountRole.Owner:
      return 'OWNER'
    case AccountRole.Maintainer:
      return 'MAINTAINER'
    case AccountRole.User:
      return 'USER'
    case AccountRole.Guest:
      return 'GUEST'
    case AccountRole.ReadOnlyGuest:
      return 'READONLY_GUEST'
    case AccountRole.DocGuest:
      return 'DOC_GUEST'
    case AccountRole.Admin:
      return 'ADMIN'
    default: {
      // Exhaustiveness check — if AccountRole gains a new variant the
      // compiler will surface this branch.
      const _exhaustive: never = canonical
      throw new Error(`canonicalToWire: unhandled AccountRole ${String(_exhaustive)}`)
    }
  }
}

/** Convert TS canonical AccountRole → DB enum form. Total over the enum. */
export function canonicalToDb (canonical: AccountRole): DbRole {
  switch (canonical) {
    case AccountRole.Owner:
      return 'OWNER'
    case AccountRole.Maintainer:
      return 'MAINTAINER'
    case AccountRole.User:
      return 'USER'
    case AccountRole.Guest:
      return 'GUEST'
    case AccountRole.ReadOnlyGuest:
      return 'READONLYGUEST'
    case AccountRole.DocGuest:
      return 'DOCGUEST'
    case AccountRole.Admin:
      return 'ADMIN'
    default: {
      const _exhaustive: never = canonical
      throw new Error(`canonicalToDb: unhandled AccountRole ${String(_exhaustive)}`)
    }
  }
}

/**
 * Convert DB enum form → TS canonical AccountRole.
 * Returns null for invalid input (= corrupted row written by a buggy
 * pre-canonicalization caller). Backends MUST log loudly and skip the
 * row instead of crashing.
 */
export function dbToCanonical (db: string): AccountRole | null {
  switch (db) {
    case 'OWNER':
      return AccountRole.Owner
    case 'MAINTAINER':
      return AccountRole.Maintainer
    case 'USER':
      return AccountRole.User
    case 'GUEST':
      return AccountRole.Guest
    case 'READONLYGUEST':
      return AccountRole.ReadOnlyGuest
    case 'DOCGUEST':
      return AccountRole.DocGuest
    case 'ADMIN':
      return AccountRole.Admin
    default:
      return null
  }
}
