//
// Copyright © 2026 Hardcore Engineering Inc.
//
// E7 — WAC route-contract matrix test (Codex E6 recommendation).
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
  {
    name: 'capabilities (E7)',
    clientUrl: /\/capabilities/,
    expect: 'mounted',
    hostMatch: /sub === 'capabilities'[\s\S]{0,500}handleCapabilities/
  },
  {
    name: 'presets list',
    clientUrl: /\/\$\{workspace\}\/presets/,
    expect: 'mounted',
    hostMatch: /sub === 'presets'[\s\S]{0,200}wacPresetsHandlers\.handleList/
  },
  {
    name: 'presets create',
    clientUrl: /\/\$\{workspace\}\/presets/,
    expect: 'mounted',
    hostMatch: /sub === 'presets'[\s\S]{0,300}wacPresetsHandlers\.handleCreate/
  },
  {
    name: 'webhooks (preview)',
    clientUrl: /\/\$\{workspace\}\/webhooks/,
    expect: 'preview-501',
    // Auth via authenticateWac + return _webhookNotWired
    hostMatch: /\/api\/wac\/:workspace\/webhooks['\s\S]{0,400}authenticateWac\([\s\S]{0,200}_webhookNotWired/
  },
  {
    name: 'grant-expiry (preview)',
    clientUrl: /\/expiry/,
    expect: 'preview-501',
    hostMatch: /\/grants\/:grantId\/expiry[\s\S]{0,1500}authenticateWac\([\s\S]{0,1500}grant_expiry_not_wired/
  },
  {
    name: 'effective-permissions (preview)',
    clientUrl: /\/effective-permissions/,
    expect: 'preview-501',
    hostMatch: /sub === 'effective-permissions'[\s\S]{0,1500}effective_permissions_not_wired/
  },
  {
    name: 'csv bulk-invite (dry-run real, send preview)',
    clientUrl: /\/invites\/bulk-csv/,
    expect: 'preview-501',
    // dry_run=true is real validate; dry_run=false returns 501
    hostMatch: /\/invites\/bulk-csv['\s\S]{0,800}csv_dispatch_not_wired/
  },
  {
    name: 'audit list',
    clientUrl: /\/audit/,
    expect: 'mounted',
    hostMatch: /sub === 'audit'[\s\S]{0,800}handleAudit/
  },
  {
    name: 'members list',
    clientUrl: /\/members/,
    expect: 'mounted',
    hostMatch: /sub === 'members'[\s\S]{0,300}handleMembers/
  },
  {
    name: 'spaces list',
    clientUrl: /\/spaces/,
    expect: 'mounted',
    hostMatch: /sub === 'spaces'[\s\S]{0,300}handleSpaces/
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
})
