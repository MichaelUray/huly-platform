//
// Copyright © 2026 Hardcore Engineering Inc.
//
// E7 — WAC route-contract matrix test (Codex E6 recommendation; FIX 3
// expansion to cover every client API URL).
//
// Codex pointed out that grep-based "every plugin export must have a
// host route" rules are brittle (plugin packages also export pure
// helpers, types, tests). The right shape is a CONTRACT MATRIX:
//
//   visible-client-api-route   →  host dispatch exists
//   hidden-preview-api-route   →  host returns authenticated 501
//   no-visible-UI may call an unmounted route
//   presets `/presets*` is mounted
//
// We assert the contract by source-grepping account-service/src/index.ts
// for the route patterns we care about, plus the client API modules for
// the URL-builder strings, then cross-referencing the two sides.
//
// FIX 3 expanded the matrix from 10 to a per-route inventory of every
// `getDefaultWacClient().get/post/put/delete(...)` URL found across
// `plugins/workspace-access-resources/src/api/*.ts`. The five webhook
// shapes each have their own contract row (no more single regex that
// "matches one shape" by accident), and audit/export.csv / owners-count
// / invites / grants writes are pinned. `my-access` POST mutations are
// added in FIX 4 alongside their honest-501 routes (CONTRACTS row is
// added in that same commit so the matrix stays green per-commit).
//

import fs from 'fs'
import path from 'path'

const INDEX_TS = path.join(__dirname, '..', 'index.ts')
const WAC_RESOURCES = path.resolve(
  __dirname, '..', '..', '..', '..',
  'plugins', 'workspace-access-resources', 'src'
)

const hostSrc = fs.readFileSync(INDEX_TS, 'utf-8')

/** Read all .ts files under wac-resources/src/api/. */
function readClientApi (): string {
  const apiDir = path.join(WAC_RESOURCES, 'api')
  if (!fs.existsSync(apiDir)) return ''
  return fs.readdirSync(apiDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => fs.readFileSync(path.join(apiDir, f), 'utf-8'))
    .join('\n---\n')
}

const clientSrc = readClientApi()

interface Contract {
  /** Display name used in failure messages. */
  name: string
  /** Regex that should match the client's URL-builder string for this route. */
  clientUrl: RegExp
  /**
   * Acceptable host shapes:
   *  - 'mounted'        → host has a wacReadHandlers / wacWriteHandlers / wacPresetsHandlers call OR
   *                       a router.get/post for the path that DOES NOT return 501
   *  - 'preview-501'    → host MUST go through authenticateWac + return 501 not_implemented
   */
  expect: 'mounted' | 'preview-501'
  /**
   * Regex matched against the host source. The match means the route
   * is wired the expected way.
   */
  hostMatch: RegExp
}

const CONTRACTS: Contract[] = [
  // ── Capabilities + presets ────────────────────────────────────────────
  {
    name: 'capabilities (E7)',
    clientUrl: /\/capabilities/,
    expect: 'mounted',
    hostMatch: /sub === 'capabilities'[\s\S]{0,500}handleCapabilities/
  },
  {
    name: 'presets list',
    clientUrl: /\/\$\{workspace\}\/presets`/,
    expect: 'mounted',
    hostMatch: /sub === 'presets'[\s\S]{0,200}wacPresetsHandlers\.handleList/
  },
  {
    name: 'presets create',
    clientUrl: /\/\$\{workspace\}\/presets`/,
    expect: 'mounted',
    hostMatch: /sub === 'presets'[\s\S]{0,300}wacPresetsHandlers\.handleCreate/
  },
  {
    name: 'presets update',
    clientUrl: /\/\$\{workspace\}\/presets\/\$\{id\}`/,
    expect: 'mounted',
    hostMatch: /sub\.startsWith\('presets\/'\)[\s\S]{0,300}wacPresetsHandlers\.handleUpdate/
  },
  {
    name: 'presets delete',
    clientUrl: /\/\$\{workspace\}\/presets\/\$\{id\}`/,
    expect: 'mounted',
    hostMatch: /sub\.startsWith\('presets\/'\)[\s\S]{0,400}wacPresetsHandlers\.handleDelete/
  },
  {
    name: 'presets apply',
    clientUrl: /\/\$\{workspace\}\/presets\/\$\{id\}\/apply`/,
    expect: 'mounted',
    hostMatch: /presets\/'\)[\s\S]{0,300}\/apply[\s\S]{0,300}wacPresetsHandlers\.handleApply/
  },
  // ── Webhooks (5 routes, all preview-501) ──────────────────────────────
  // Each shape gets its own contract row so a single overly-broad regex
  // can't satisfy the matrix by accident.
  {
    name: 'webhooks list (GET)',
    clientUrl: /c\.get<\{ items: Webhook\[\] \}>\(`\/\$\{workspace\}\/webhooks`\)/,
    expect: 'preview-501',
    hostMatch: /router\.get\('\/api\/wac\/:workspace\/webhooks'[\s\S]{0,200}authenticateWac[\s\S]{0,200}_webhookNotWired/
  },
  {
    name: 'webhooks create (POST)',
    clientUrl: /c\.post<Webhook>\(`\/\$\{workspace\}\/webhooks`/,
    expect: 'preview-501',
    hostMatch: /router\.post\('\/api\/wac\/:workspace\/webhooks'[\s\S]{0,200}authenticateWac[\s\S]{0,200}_webhookNotWired/
  },
  {
    name: 'webhooks update (PUT)',
    clientUrl: /c\.put<Webhook>\(`\/\$\{workspace\}\/webhooks\/\$\{id\}`/,
    expect: 'preview-501',
    hostMatch: /router\.put\('\/api\/wac\/:workspace\/webhooks\/:id'[\s\S]{0,200}authenticateWac[\s\S]{0,200}_webhookNotWired/
  },
  {
    name: 'webhooks delete (DELETE)',
    clientUrl: /c\.delete<void>\(`\/\$\{workspace\}\/webhooks\/\$\{id\}`/,
    expect: 'preview-501',
    hostMatch: /router\.delete\('\/api\/wac\/:workspace\/webhooks\/:id'[\s\S]{0,200}authenticateWac[\s\S]{0,200}_webhookNotWired/
  },
  {
    name: 'webhooks test (POST .../test)',
    clientUrl: /c\.post<WebhookTestResult>\(`\/\$\{workspace\}\/webhooks\/\$\{id\}\/test`/,
    expect: 'preview-501',
    hostMatch: /router\.post\('\/api\/wac\/:workspace\/webhooks\/:id\/test'[\s\S]{0,200}authenticateWac[\s\S]{0,200}_webhookNotWired/
  },
  // ── Grant-expiry (preview-501) ────────────────────────────────────────
  {
    name: 'grant-expiry (preview)',
    clientUrl: /\/expiry/,
    expect: 'preview-501',
    hostMatch: /\/grants\/:grantId\/expiry[\s\S]{0,1500}authenticateWac\([\s\S]{0,1500}grant_expiry_not_wired/
  },
  // ── Effective-permissions (preview-501) ───────────────────────────────
  {
    name: 'effective-permissions (preview)',
    clientUrl: /\/effective-permissions/,
    expect: 'preview-501',
    hostMatch: /sub === 'effective-permissions'[\s\S]{0,1500}effective_permissions_not_wired/
  },
  // ── CSV bulk-invite (dry-run mounted; send is preview-501) ────────────
  {
    name: 'csv bulk-invite (dry-run real, send preview)',
    clientUrl: /\/invites\/bulk-csv/,
    expect: 'preview-501',
    // dry_run=false returns 501 csv_dispatch_not_wired; dry_run=true
    // uses the plugin's previewBulkInviteCsv (header-aware parser).
    hostMatch: /\/invites\/bulk-csv['\s\S]{0,1500}csv_dispatch_not_wired[\s\S]{0,1500}previewBulkInviteCsv/
  },
  // ── Audit list + CSV export ───────────────────────────────────────────
  {
    name: 'audit list',
    clientUrl: /\/\$\{workspace\}\/audit\$\{buildQuery\(opts\)\}/,
    expect: 'mounted',
    hostMatch: /sub === 'audit'[\s\S]{0,800}handleAudit/
  },
  {
    name: 'audit CSV export (GET .../audit/export.csv)',
    // wacClient.exportAudit composes the export.csv URL inside the
    // helper module, so the client search hits the helper name rather
    // than an inline template literal.
    clientUrl: /audit\/export\.csv|exportAudit/,
    expect: 'mounted',
    hostMatch: /\/audit\\\/export\\\.csv\$\/[\s\S]{0,1500}handleAuditCsvExport/
  },
  // ── People reads ──────────────────────────────────────────────────────
  {
    name: 'members list',
    clientUrl: /\/\$\{workspace\}\/members\$\{buildQuery\(opts\)\}/,
    expect: 'mounted',
    hostMatch: /sub === 'members'[\s\S]{0,300}handleMembers/
  },
  {
    name: 'invites list',
    clientUrl: /\/\$\{workspace\}\/invites\$\{buildQuery\(opts\)\}/,
    expect: 'mounted',
    hostMatch: /sub === 'invites'[\s\S]{0,300}handleInvites/
  },
  {
    name: 'owners count',
    clientUrl: /\/\$\{workspace\}\/owners\/count/,
    expect: 'mounted',
    hostMatch: /sub === 'owners\/count'[\s\S]{0,300}handleOwnersCount/
  },
  // ── People writes (POST) ──────────────────────────────────────────────
  {
    name: 'member role (POST)',
    clientUrl: /\/\$\{workspace\}\/members\/\$\{targetUuid\}\/role/,
    expect: 'mounted',
    // Host source: `sub.match(/^members\/([^/]+)\/role$/)` — note the
    // unescaped `[^/]` since the regex literal lives in a forward-slash
    // delimiter (escaping the slash is unnecessary inside a class).
    hostMatch: /\^members\\\/\(\[\^\/\]\+\)\\\/role\$[\s\S]{0,500}handleMemberRole/
  },
  {
    name: 'member bulk role (POST)',
    clientUrl: /\/\$\{workspace\}\/members\/bulk\/role/,
    expect: 'mounted',
    hostMatch: /sub === 'members\/bulk\/role'[\s\S]{0,300}handleBulkMemberRole/
  },
  // ── Resources (spaces) reads ──────────────────────────────────────────
  {
    name: 'spaces list',
    clientUrl: /\/\$\{workspace\}\/spaces\$\{buildQuery\(opts\)\}/,
    expect: 'mounted',
    hostMatch: /sub === 'spaces'[\s\S]{0,300}handleSpaces/
  },
  {
    name: 'space detail',
    clientUrl: /\/\$\{workspace\}\/spaces\/\$\{spaceId\}`/,
    expect: 'mounted',
    hostMatch: /sub\.startsWith\('spaces\/'\)[\s\S]{0,300}handleSpaceDetail/
  },
  // ── Resources (spaces) writes ─────────────────────────────────────────
  {
    name: 'space members (PUT)',
    clientUrl: /\/\$\{workspace\}\/spaces\/\$\{spaceId\}\/members/,
    expect: 'mounted',
    hostMatch: /spaces\\\/\(\[\^\/\]\+\)\\\/members[\s\S]{0,400}handleSpaceMembers/
  },
  {
    name: 'space owners (PUT)',
    clientUrl: /\/\$\{workspace\}\/spaces\/\$\{spaceId\}\/owners/,
    expect: 'mounted',
    hostMatch: /spaces\\\/\(\[\^\/\]\+\)\\\/owners[\s\S]{0,400}handleSpaceOwners/
  },
  {
    name: 'space privacy (PUT)',
    clientUrl: /\/\$\{workspace\}\/spaces\/\$\{spaceId\}\/privacy/,
    expect: 'mounted',
    hostMatch: /spaces\\\/\(\[\^\/\]\+\)\\\/privacy[\s\S]{0,400}handleSpacePrivacy/
  },
  {
    name: 'space auto-join (PUT)',
    clientUrl: /\/\$\{workspace\}\/spaces\/\$\{spaceId\}\/auto-join/,
    expect: 'mounted',
    hostMatch: /spaces\\\/\(\[\^\/\]\+\)\\\/auto-join[\s\S]{0,400}handleSpaceAutoJoin/
  },
  {
    name: 'space archived (PUT)',
    clientUrl: /\/\$\{workspace\}\/spaces\/\$\{spaceId\}\/archived/,
    expect: 'mounted',
    hostMatch: /spaces\\\/\(\[\^\/\]\+\)\\\/archived[\s\S]{0,400}handleSpaceArchived/
  },
  // ── Resources bulk-bar ────────────────────────────────────────────────
  {
    name: 'bulk archive (POST)',
    clientUrl: /\/\$\{workspace\}\/spaces\/bulk-archive/,
    expect: 'mounted',
    hostMatch: /sub === 'spaces\/bulk-archive'[\s\S]{0,300}handleBulkSpaceArchive/
  },
  {
    name: 'bulk set-private (POST)',
    clientUrl: /\/\$\{workspace\}\/spaces\/bulk-set-private/,
    expect: 'mounted',
    hostMatch: /sub === 'spaces\/bulk-set-private'[\s\S]{0,300}handleBulkSpacePrivacy/
  },
  {
    name: 'bulk add-owner (POST)',
    clientUrl: /\/\$\{workspace\}\/spaces\/bulk-add-owner/,
    expect: 'mounted',
    hostMatch: /sub === 'spaces\/bulk-add-owner'[\s\S]{0,300}handleBulkSpaceAddOwner/
  },
  // ── Granted-access (grants) reads + writes ────────────────────────────
  {
    name: 'grants list',
    clientUrl: /\/\$\{workspace\}\/grants\$\{buildQuery\(opts\)\}/,
    expect: 'mounted',
    hostMatch: /sub === 'grants'[\s\S]{0,300}handleGrants/
  },
  {
    name: 'grants count',
    clientUrl: /\/\$\{workspace\}\/grants\/count/,
    expect: 'mounted',
    hostMatch: /sub === 'grants\/count'[\s\S]{0,300}handleGrantsCount/
  },
  {
    name: 'grant revoke (DELETE)',
    clientUrl: /\/\$\{workspace\}\/grants\/\$\{recipientUuid\}\/\$\{resourceId\}/,
    expect: 'mounted',
    hostMatch: /sub\.startsWith\('grants\/'\)[\s\S]{0,400}handleGrantRevoke/
  },
  // ── My Access ─────────────────────────────────────────────────────────
  {
    name: 'my-access summary (GET)',
    clientUrl: /\/\$\{workspace\}\/my-access`/,
    expect: 'mounted',
    hostMatch: /sub === 'my-access'[\s\S]{0,300}handleMyAccess/
  },
  {
    name: 'my-access leave (POST)',
    // FIX 4: client invokes leaveSpace; host returns honest 501 until
    // the per-caller mutation backend (workspace_collaborator DELETE)
    // is wired. UI is preview-gated via capabilities.preview.myAccessMutations.
    // The 501 + my_access_mutations_not_wired code lives in the shared
    // `_myAccessMutationsNotWired` helper above the routes.
    clientUrl: /\/\$\{workspace\}\/my-access\/leave\/\$\{spaceId\}/,
    expect: 'preview-501',
    hostMatch: /router\.post\('\/api\/wac\/:workspace\/my-access\/leave\/:spaceId'[\s\S]{0,400}authenticateWac[\s\S]{0,400}_myAccessMutationsNotWired/
  },
  {
    name: 'my-access decline-grant (POST)',
    clientUrl: /\/\$\{workspace\}\/my-access\/decline-grant\/\$\{resourceId\}/,
    expect: 'preview-501',
    hostMatch: /router\.post\('\/api\/wac\/:workspace\/my-access\/decline-grant\/:resourceId'[\s\S]{0,400}authenticateWac[\s\S]{0,400}_myAccessMutationsNotWired/
  },
  // ── Members bulk-space mutations (preview-501, FIX 5/E8) ──────────────
  // peopleApi.bulkAddToSpace + bulkRemoveFromSpace post to these. Host
  // returns honest 501 until the workspace TxOperations bulk-edit path
  // through the plugin's setSpaceMembers is wired. PeopleBulkBar gates
  // the Add-to-Space + Remove-from-Space buttons behind
  // capabilities.preview.membersBulkSpaceMutations so SpacePickerModal
  // never opens in production.
  {
    name: 'members bulk-add-to-space (POST)',
    clientUrl: /\/\$\{workspace\}\/members\/bulk\/add-to-space/,
    expect: 'preview-501',
    hostMatch: /router\.post\('\/api\/wac\/:workspace\/members\/bulk\/add-to-space'[\s\S]{0,400}authenticateWac[\s\S]{0,400}_membersBulkSpaceNotWired/
  },
  {
    name: 'members bulk-remove-from-space (POST)',
    clientUrl: /\/\$\{workspace\}\/members\/bulk\/remove-from-space/,
    expect: 'preview-501',
    hostMatch: /router\.post\('\/api\/wac\/:workspace\/members\/bulk\/remove-from-space'[\s\S]{0,400}authenticateWac[\s\S]{0,400}_membersBulkSpaceNotWired/
  }
]

describe('WAC route contract matrix (E7)', () => {
  // 1. Every contract's client URL pattern appears in the client API.
  for (const c of CONTRACTS) {
    it(`client invokes ${c.name}`, () => {
      expect(clientSrc).toMatch(c.clientUrl)
    })
  }

  // 2. Every contract's host shape matches expectation.
  for (const c of CONTRACTS) {
    it(`host has correct shape for ${c.name} (${c.expect})`, () => {
      expect(hostSrc).toMatch(c.hostMatch)
    })
  }

  // 3. Cross-check: webhook CRUD routes don't accidentally call the
  //    plugin's `createWebhook` / `updateWebhook` etc. body. The
  //    preview-501 contract says auth-gate + 501, nothing more.
  it('webhook routes do NOT call _wacRouteCtx fake-context helper', () => {
    expect(hostSrc).not.toMatch(/_wacRouteCtx\s*\(/)
  })

  // 4. The fake _wacRouteCtx, _gateWacAdmin, _wac, _serializeWebhook,
  //    _wacError, _webhookMemBackend in-memory scaffolding from
  //    pre-E7 must be gone (they lied to the plugin's auth gates).
  it('webhook in-memory backend scaffolding is removed', () => {
    expect(hostSrc).not.toMatch(/_webhookMemBackend/)
    expect(hostSrc).not.toMatch(/_webhookMem\b/)
    expect(hostSrc).not.toMatch(/_gateWacAdmin/)
  })

  // 5. Grant-expiry must NOT return the pre-E7 silent 200.
  it('grant-expiry does NOT return changed:true 200 stub', () => {
    expect(hostSrc).not.toMatch(/grants\/:grantId\/expiry[\s\S]{0,1500}changed:\s*true/)
  })

  // 6. CSV bulk-invite dry-run must NOT call processBulkInviteCsv with
  //    a spaceExists-always-true callback (the pre-E7 lie). Strip
  //    comments before matching so the "the spaceExists lie is gone"
  //    docstring doesn't trigger a false-positive.
  it('CSV bulk-invite does NOT use spaceExists always-true callback', () => {
    const noComments = hostSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(noComments).not.toMatch(/spaceExists:\s*async/)
  })

  // 7. CSV bulk-invite dry-run goes through the plugin parser, not the
  //    pre-E7 inline `for (let i = 0; i < rawLines.length; i++)` loop
  //    that fed the header row into per-row validation.
  it('CSV bulk-invite uses previewBulkInviteCsv (plugin parser, not inline loop)', () => {
    expect(hostSrc).toMatch(/previewBulkInviteCsv\(/)
    expect(hostSrc).not.toMatch(/for \(let i = 0; i < rawLines\.length; i\+\+\)/)
  })

  // 8a. FIX 4 — my-access mutations use the per-caller 'read-self' capability,
  //     NOT the workspace-wide 'edit' gate. A USER leaving their OWN space
  //     should not require OWNER.
  it('FIX 4 — my-access POST routes authenticate with read-self (not edit)', () => {
    const block = hostSrc.slice(
      hostSrc.indexOf('// ── WAC my-access mutations (FIX 4)'),
      hostSrc.indexOf('// ── End WAC my-access mutations')
    )
    expect(block).toMatch(/authenticateWac\([^)]*'read-self'[^)]*authDeps\)/)
    expect(block).not.toMatch(/authenticateWac\([^)]*'edit'[^)]*authDeps\)/)
  })

  // 8b. FIX 4 — write middleware lets my-access POSTs fall through to the
  //     router (otherwise the OWNER-only 'edit' gate would 403 a USER).
  it('FIX 4 — write middleware skips my-access/* so router can handle with read-self', () => {
    expect(hostSrc).toMatch(/sub\.startsWith\('my-access\/'\)[\s\S]{0,80}return await next\(\)/)
  })

  // 9. Each individual webhook shape (GET, POST, PUT, DELETE, POST :id/test)
  //    appears in the host as a distinct router.<method> declaration. A
  //    pre-E7 contract that matched all 5 via a single regex would have
  //    let an accidental "DELETE missing" regression slip through.
  it('webhook host declares 5 distinct router methods (get/post/put/delete + test)', () => {
    const webhookBlock = hostSrc.slice(
      hostSrc.indexOf('// ── WAC outbound webhooks'),
      hostSrc.indexOf('// ── End WAC outbound webhooks')
    )
    expect(webhookBlock).toMatch(/router\.get\('\/api\/wac\/:workspace\/webhooks'/)
    expect(webhookBlock).toMatch(/router\.post\('\/api\/wac\/:workspace\/webhooks'/)
    expect(webhookBlock).toMatch(/router\.put\('\/api\/wac\/:workspace\/webhooks\/:id'/)
    expect(webhookBlock).toMatch(/router\.delete\('\/api\/wac\/:workspace\/webhooks\/:id'/)
    expect(webhookBlock).toMatch(/router\.post\('\/api\/wac\/:workspace\/webhooks\/:id\/test'/)
  })
})
