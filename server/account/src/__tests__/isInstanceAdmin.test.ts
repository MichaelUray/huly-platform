//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// A3 — coverage for the two AccountDB.isInstanceAdmin implementations.
//
// Source of truth: `process.env.ADMIN_EMAILS` (comma-separated, case-
// insensitive). Same derivation as the existing `isAdmin` column in
// `listAccountsAdminPg` (line ~200) and `getAccountInfoAdmin` in
// serviceOperations (line ~274).
//

import type { AccountUuid, PersonUuid } from '@hcengineering/core'

const ADMIN_UUID = '11111111-1111-4111-8111-111111111111'
const NON_ADMIN_UUID = '22222222-2222-4222-8222-222222222222'
const UNKNOWN_UUID = '33333333-3333-4333-8333-333333333333'

describe('AccountDB.isInstanceAdmin — Postgres', () => {
  const originalEnv = process.env.ADMIN_EMAILS

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@example.com,Other@Example.com'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = originalEnv
  })

  function makeDb (rowsByQuery: Map<string, any[]>): any {
    const calls: any[] = []
    const client = {
      unsafe: async (sql: string, args: any[]) => {
        calls.push({ sql, args })
        // Key the response by uuid only — there's exactly one query shape
        // in this code path.
        const uuid = String(args[0])
        return rowsByQuery.get(uuid) ?? []
      }
    }
    // Mimic the constructed PostgresAccountDB shape.
    const { PostgresAccountDB } = require('../collections/postgres/postgres')
    const db = Object.create(PostgresAccountDB.prototype)
    db.client = client
    db.ns = 'global_account'
    return { db, calls }
  }

  it('returns true for admin whose verified email matches (case-insensitive)', async () => {
    // Row presence = match in SQL; the test mocks the SQL response, the
    // LOWER(value) = ANY(...) match is enforced by the actual query.
    const { db } = makeDb(new Map([[ADMIN_UUID, [{ /* SELECT 1 */ }]]]))
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(true)
  })

  it('returns false for account with no matching admin email', async () => {
    const { db } = makeDb(new Map([[NON_ADMIN_UUID, []]]))
    expect(await db.isInstanceAdmin(NON_ADMIN_UUID as AccountUuid)).toBe(false)
  })

  it('returns false for unknown uuid (no row)', async () => {
    const { db } = makeDb(new Map())
    expect(await db.isInstanceAdmin(UNKNOWN_UUID as AccountUuid)).toBe(false)
  })

  it('returns false (skips DB) when ADMIN_EMAILS env is empty', async () => {
    process.env.ADMIN_EMAILS = ''
    const { db, calls } = makeDb(new Map([[ADMIN_UUID, [{}]]]))
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(false)
    expect(calls.length).toBe(0)
  })

  it('lower-cases env allowlist before querying', async () => {
    process.env.ADMIN_EMAILS = ' Admin@Example.COM '
    const { db, calls } = makeDb(new Map([[ADMIN_UUID, [{}]]]))
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(true)
    expect(calls[0].args[1]).toEqual(['admin@example.com'])
  })
})

describe('AccountDB.isInstanceAdmin — Mongo', () => {
  const originalEnv = process.env.ADMIN_EMAILS

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@example.com'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = originalEnv
  })

  function makeDb (socialIds: Array<{ personUuid: PersonUuid, type: string, value: string, verifiedOn?: number }>): any {
    const { MongoAccountDB } = require('../collections/mongo')
    const db = Object.create(MongoAccountDB.prototype)
    db.socialId = {
      find: async (q: any) => {
        return socialIds.filter((s) =>
          String(s.personUuid) === String(q.personUuid) &&
          (q.verifiedOn == null || (s.verifiedOn ?? 0) > 0)
        )
      }
    }
    return db
  }

  it('returns true for admin whose verified email matches', async () => {
    const db = makeDb([
      { personUuid: ADMIN_UUID as unknown as PersonUuid, type: 'email', value: 'admin@example.com', verifiedOn: 1 }
    ])
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(true)
  })

  it('returns false when email is not verified', async () => {
    const db = makeDb([
      { personUuid: ADMIN_UUID as unknown as PersonUuid, type: 'email', value: 'admin@example.com', verifiedOn: 0 }
    ])
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(false)
  })

  it('returns false for non-admin (different email)', async () => {
    const db = makeDb([
      { personUuid: NON_ADMIN_UUID as unknown as PersonUuid, type: 'email', value: 'user@example.com', verifiedOn: 1 }
    ])
    expect(await db.isInstanceAdmin(NON_ADMIN_UUID as AccountUuid)).toBe(false)
  })

  it('returns false for unknown uuid', async () => {
    const db = makeDb([])
    expect(await db.isInstanceAdmin(UNKNOWN_UUID as AccountUuid)).toBe(false)
  })

  it('returns false when ADMIN_EMAILS env is empty', async () => {
    process.env.ADMIN_EMAILS = ''
    const db = makeDb([
      { personUuid: ADMIN_UUID as unknown as PersonUuid, type: 'email', value: 'admin@example.com', verifiedOn: 1 }
    ])
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(false)
  })

  it('case-insensitive email match', async () => {
    process.env.ADMIN_EMAILS = 'Admin@Example.com'
    const db = makeDb([
      { personUuid: ADMIN_UUID as unknown as PersonUuid, type: 'email', value: 'ADMIN@example.com', verifiedOn: 1 }
    ])
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(true)
  })

  it('ignores non-email social_ids', async () => {
    const db = makeDb([
      { personUuid: ADMIN_UUID as unknown as PersonUuid, type: 'github', value: 'admin@example.com', verifiedOn: 1 }
    ])
    expect(await db.isInstanceAdmin(ADMIN_UUID as AccountUuid)).toBe(false)
  })
})
