//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wave 5 Task B6 — legacy admin read RPCs enforce verifyTokenVersion.
//
// Codex High flagged that listWorkspaces / listAccounts and similar admin
// read RPCs only validated decoded.extras — a revoked admin token (token
// version bumped via password reset or admin demote) could still fetch
// admin data. These tests pin the new behaviour and confirm that service
// tokens (system / tool / backup / github) still pass because
// verifyTokenVersion skips non-UUID principals via its special-account
// skip-list.
//

import { MeasureContext } from '@hcengineering/core'

const ADMIN_TOKEN = 'admin-token'
const STALE_ADMIN_TOKEN = 'stale-admin-token'
const SYSTEM_TOKEN = 'system-token'
const TOOL_TOKEN = 'tool-token'
const BACKUP_TOKEN = 'backup-token'
const GITHUB_TOKEN = 'github-token'

const ADMIN_UUID = 'a1111111-1111-4111-9111-111111111111'
const SYSTEM_UUID = '1749089e-22e6-48de-af4e-165e18fbd2f9' // packages/core systemAccountUuid

// Fake server-token: each token decodes to a different (account, extra) shape.
// The skip-list in verifyTokenVersion (utils.ts) treats non-UUID principals as
// service tokens and short-circuits — that is what we cover for tool/backup/github.
jest.mock('@hcengineering/server-token', () => ({
  decodeTokenVerbose: (_ctx: any, token: string) => {
    switch (token) {
      case ADMIN_TOKEN:
        return { account: ADMIN_UUID, extra: { admin: 'true', token_version: '3' }, workspace: 'ws-x' }
      case STALE_ADMIN_TOKEN:
        return { account: ADMIN_UUID, extra: { admin: 'true', token_version: '2' }, workspace: 'ws-x' }
      case SYSTEM_TOKEN:
        // Use the real systemAccountUuid; verifyTokenVersion has an early-return
        // for this UUID. The admin: 'true' claim then lets the admin-gate pass.
        return { account: SYSTEM_UUID, extra: { admin: 'true' }, workspace: 'ws-x' }
      case TOOL_TOKEN:
        return { account: 'tool', extra: { service: 'tool' }, workspace: 'ws-x' }
      case BACKUP_TOKEN:
        return { account: 'backup', extra: { service: 'backup' }, workspace: 'ws-x' }
      case GITHUB_TOKEN:
        return { account: 'github', extra: { service: 'github' }, workspace: 'ws-x' }
      default:
        throw new Error('bad token')
    }
  },
  // Use a real Error subclass so `instanceof` checks still work for callers.
  TokenError: class extends Error {}
}))

// IMPORTANT: do NOT mock verifyTokenVersion here — we want the real one so that
// (a) admin tokens with matching token_version succeed,
// (b) stale-version admin tokens get rejected, and
// (c) service-account principals (system/tool/backup/github) hit the skip-list.

import { TokenError } from '@hcengineering/server-token'
import { PlatformError } from '@hcengineering/platform'

import { listWorkspaces, listAccounts, performWorkspaceOperation } from '../serviceOperations'
import type { AccountDB } from '../types'

const ctx = {
  newChild: () => ctx,
  info: () => {},
  warn: () => {},
  error: () => {}
} as unknown as MeasureContext

// Helper: build a db stub for the admin uuid with a given current tokenVersion.
function buildDb (currentTokenVersion: number, disabledAt: number | null = null): AccountDB {
  return {
    account: {
      findOne: async (q: any) => {
        if (q.uuid === ADMIN_UUID) {
          return { uuid: ADMIN_UUID, tokenVersion: currentTokenVersion, disabledAt }
        }
        // Service accounts (string identifiers, not UUIDs) never resolve here
        // because verifyTokenVersion's UUID_REGEX guard returns earlier.
        return null
      }
    },
    listAccounts: async () => [],
    workspace: {
      find: async () => []
    },
    workspaceStatus: {
      find: async () => [],
      update: async () => undefined,
      findOne: async () => ({ workspaceUuid: 'ws1', mode: 'active', processingAttempts: 0 })
    },
    adminAuditLog: { insert: async () => undefined }
  } as unknown as AccountDB
}

// ---------- listWorkspaces ----------
describe('listWorkspaces — verifyTokenVersion gating (Wave 5 B6)', () => {
  it('valid admin token (matching token_version) succeeds', async () => {
    const db = buildDb(3) // matches ADMIN_TOKEN's token_version=3
    // listWorkspaces calls getWorkspaces(db, false, region, mode); stub minimal
    ;(db as any).workspace = { find: async () => [] }
    ;(db as any).getWorkspaces = async () => []
    // The real getWorkspaces (in utils) hits db.workspace.find — we already stub it
    await expect(
      listWorkspaces(ctx, db, null, ADMIN_TOKEN, { region: null, mode: null })
    ).resolves.toBeDefined()
  })

  it('stale-version admin token is rejected by verifyTokenVersion', async () => {
    const db = buildDb(5) // current is 5, STALE_ADMIN_TOKEN claims version=2 → reject
    await expect(
      listWorkspaces(ctx, db, null, STALE_ADMIN_TOKEN, { region: null, mode: null })
    ).rejects.toThrow(TokenError)
  })

  it('system service token passes the skip-list (admin-by-virtue of system)', async () => {
    const db = buildDb(0)
    ;(db as any).workspace = { find: async () => [] }
    await expect(
      listWorkspaces(ctx, db, null, SYSTEM_TOKEN, { region: null, mode: null })
    ).resolves.toBeDefined()
  })

  it.each([
    ['tool', TOOL_TOKEN],
    ['backup', BACKUP_TOKEN],
    ['github', GITHUB_TOKEN]
  ])('%s service token passes the skip-list (non-UUID principal)', async (_label, token) => {
    const db = buildDb(0)
    ;(db as any).workspace = { find: async () => [] }
    await expect(
      listWorkspaces(ctx, db, null, token, { region: null, mode: null })
    ).resolves.toBeDefined()
  })
})

// ---------- listAccounts ----------
describe('listAccounts — verifyTokenVersion gating (Wave 5 B6)', () => {
  it('valid admin token succeeds', async () => {
    const db = buildDb(3)
    await expect(
      listAccounts(ctx, db, null, ADMIN_TOKEN, { skip: 0, limit: 10 })
    ).resolves.toEqual([])
  })

  it('stale-version admin token is rejected', async () => {
    const db = buildDb(5)
    await expect(
      listAccounts(ctx, db, null, STALE_ADMIN_TOKEN, { skip: 0, limit: 10 })
    ).rejects.toThrow(TokenError)
  })

  it('system service token passes verifyTokenVersion (skip-list) then admin-claim check', async () => {
    const db = buildDb(0)
    // system token carries admin: 'true' in extra — should reach db.listAccounts.
    await expect(
      listAccounts(ctx, db, null, SYSTEM_TOKEN, { skip: 0, limit: 10 })
    ).resolves.toEqual([])
  })

  it('tool service token (no admin: true) still passes verifyTokenVersion but fails the admin gate', async () => {
    // This pins: verifyTokenVersion does NOT enforce admin-claim — it only checks
    // token freshness. The downstream `if (!isAdmin) throw Forbidden` still applies.
    const db = buildDb(0)
    await expect(
      listAccounts(ctx, db, null, TOOL_TOKEN, { skip: 0, limit: 10 })
    ).rejects.toThrow(PlatformError)
  })

  it('disabled admin account is rejected even with matching token version', async () => {
    const db = buildDb(3, /* disabledAt */ 1700000000000)
    await expect(
      listAccounts(ctx, db, null, ADMIN_TOKEN, { skip: 0, limit: 10 })
    ).rejects.toThrow(TokenError)
  })
})

// ---------- performWorkspaceOperation ----------
describe('performWorkspaceOperation — verifyTokenVersion gating (Wave 5 B6)', () => {
  // Build a db stub that supports the workspace mutation path.
  function buildOpsDb (currentTokenVersion: number): AccountDB {
    return {
      account: {
        findOne: async (q: any) =>
          q.uuid === ADMIN_UUID
            ? { uuid: ADMIN_UUID, tokenVersion: currentTokenVersion, disabledAt: null }
            : null
      },
      socialId: { find: async () => [] },
      workspace: {
        findOne: async () => ({ uuid: 'ws1', name: 'n1', url: 'u1' }),
        find: async () => [{ uuid: 'ws1', name: 'n1', url: 'u1' }]
      },
      workspaceStatus: {
        findOne: async () => ({ workspaceUuid: 'ws1', mode: 'active', processingAttempts: 0 }),
        find: async () => [{ workspaceUuid: 'ws1', mode: 'active', processingAttempts: 0 }],
        update: async () => undefined
      },
      adminAuditLog: { insert: async () => undefined }
    } as unknown as AccountDB
  }

  it('valid admin token can perform workspace ops', async () => {
    const db = buildOpsDb(3)
    await expect(
      performWorkspaceOperation(ctx, db, null, ADMIN_TOKEN, {
        workspaceId: 'ws1' as any,
        event: 'archive',
        params: []
      })
    ).resolves.toBeDefined()
  })

  it('stale-version admin token is rejected before any mutation', async () => {
    const db = buildOpsDb(5)
    await expect(
      performWorkspaceOperation(ctx, db, null, STALE_ADMIN_TOKEN, {
        workspaceId: 'ws1' as any,
        event: 'archive',
        params: []
      })
    ).rejects.toThrow(TokenError)
  })
})
