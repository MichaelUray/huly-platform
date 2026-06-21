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
// Round-trip + negative tests for the wire ↔ canonical ↔ DB converters.
// If these fail the AccountDB persistence boundary is misaligned with
// either the REST surface or the workspace_role enum schema.
//

import { AccountRole } from '@hcengineering/core'
import {
  wireToCanonical,
  canonicalToWire,
  canonicalToDb,
  dbToCanonical,
  type WireRole,
  type DbRole
} from '../role/canonical'

const ALL_CANONICAL: AccountRole[] = [
  AccountRole.Owner,
  AccountRole.Maintainer,
  AccountRole.User,
  AccountRole.Guest,
  AccountRole.ReadOnlyGuest,
  AccountRole.DocGuest,
  AccountRole.Admin
]

const ALL_WIRE: WireRole[] = [
  'OWNER',
  'MAINTAINER',
  'USER',
  'GUEST',
  'READONLY_GUEST',
  'DOC_GUEST',
  'ADMIN'
]

const ALL_DB: DbRole[] = [
  'OWNER',
  'MAINTAINER',
  'USER',
  'GUEST',
  'READONLYGUEST',
  'DOCGUEST',
  'ADMIN'
]

describe('role/canonical round-trip', () => {
  it.each(ALL_CANONICAL)('canonical → wire → canonical preserves %s', (c) => {
    expect(wireToCanonical(canonicalToWire(c))).toBe(c)
  })

  it.each(ALL_CANONICAL)('canonical → db → canonical preserves %s', (c) => {
    expect(dbToCanonical(canonicalToDb(c))).toBe(c)
  })

  it.each(ALL_WIRE)('wire → canonical → wire preserves %s', (w) => {
    const c = wireToCanonical(w)
    expect(c).not.toBeNull()
    expect(canonicalToWire(c as AccountRole)).toBe(w)
  })

  it.each(ALL_DB)('db → canonical → db preserves %s', (d) => {
    const c = dbToCanonical(d)
    expect(c).not.toBeNull()
    expect(canonicalToDb(c as AccountRole)).toBe(d)
  })
})

describe('role/canonical guest-variant pins', () => {
  // These are the values WAC was getting wrong via `role as any`.
  // Pin them explicitly so a future refactor cannot silently regress.
  it('ReadOnlyGuest canonical → DB is READONLYGUEST (no underscore)', () => {
    expect(canonicalToDb(AccountRole.ReadOnlyGuest)).toBe('READONLYGUEST')
  })

  it('DocGuest canonical → DB is DOCGUEST (all uppercase)', () => {
    expect(canonicalToDb(AccountRole.DocGuest)).toBe('DOCGUEST')
  })

  it('ReadOnlyGuest canonical → wire is READONLY_GUEST', () => {
    expect(canonicalToWire(AccountRole.ReadOnlyGuest)).toBe('READONLY_GUEST')
  })

  it('DocGuest canonical → wire is DOC_GUEST', () => {
    expect(canonicalToWire(AccountRole.DocGuest)).toBe('DOC_GUEST')
  })

  it('canonical AccountRole.ReadOnlyGuest equals literal READONLYGUEST per core enum', () => {
    expect(AccountRole.ReadOnlyGuest as string).toBe('READONLYGUEST')
  })

  it('canonical AccountRole.DocGuest equals literal DocGuest per core enum (mixed-case)', () => {
    expect(AccountRole.DocGuest as string).toBe('DocGuest')
  })
})

describe('role/canonical invalid input', () => {
  it('wireToCanonical("garbage") is null', () => {
    expect(wireToCanonical('garbage')).toBeNull()
  })

  it('wireToCanonical("") is null', () => {
    expect(wireToCanonical('')).toBeNull()
  })

  it('wireToCanonical("ReadOnlyGuest") (mixed-case) is null — wire is screaming-snake-case only', () => {
    expect(wireToCanonical('ReadOnlyGuest')).toBeNull()
  })

  it('wireToCanonical("READONLYGUEST") (DB form) is null — wire uses the underscore variant', () => {
    expect(wireToCanonical('READONLYGUEST')).toBeNull()
  })

  it('dbToCanonical("READONLY_GUEST") is null — this is the bug shape we are fixing', () => {
    expect(dbToCanonical('READONLY_GUEST')).toBeNull()
  })

  it('dbToCanonical("ReadOnlyGuest") is null — TS-form inside DB column is also corrupt', () => {
    expect(dbToCanonical('ReadOnlyGuest')).toBeNull()
  })

  it('dbToCanonical("DOC_GUEST") is null — corrupted variant', () => {
    expect(dbToCanonical('DOC_GUEST')).toBeNull()
  })

  it('dbToCanonical("") is null', () => {
    expect(dbToCanonical('')).toBeNull()
  })
})
