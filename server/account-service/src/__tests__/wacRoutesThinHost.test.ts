//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// Phase 2A Task 8 — "thin host" source-grep guard.
//
// After Phase 2A, server/account-service/src/index.ts must no longer carry
// inlined pg-query bodies for the WAC read routes — they live in
// server-plugins/workspace-access. This test reads the source file and
// asserts that the SQL fragments that used to be inline are gone, and
// that the new dispatch call sites are in place.
//
// The grep is intentionally narrow: it targets the SQL strings that ONLY
// appeared in the read-route block (not in write routes or the
// account-CSV-export). Write routes stay in the host for Phase 2B and
// are out of scope here.

import * as fs from 'fs'
import * as path from 'path'

describe('WAC routes — account-service is a thin host (Phase 2A)', () => {
  const indexSrc = fs.readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf-8')

  // ------------------------------------------------------------------
  // 1. No inline read-route SQL remains.
  // ------------------------------------------------------------------

  it('does not embed the workspace_audit_log read SELECT', () => {
    // Read-route SQL — distinct from the audit write INSERT and from
    // the CSV-export SELECT (which now lives in the plugin).
    expect(indexSrc).not.toMatch(/SELECT\s+id,\s+ts::text\s+AS\s+ts,\s+action[\s\S]+?FROM\s+workspace_audit_log[\s\S]+?ORDER BY ts DESC[\s\S]+?LIMIT\s+100/i)
  })

  it('does not embed the audit CSV export SELECT (LIMIT 5000)', () => {
    expect(indexSrc).not.toMatch(/FROM\s+workspace_audit_log[\s\S]+?LIMIT\s+5000/i)
  })

  it('does not embed the spaces list SELECT against `collaborator`', () => {
    // The spaces-list query joined `space s` with an inline `collaborator`
    // members_count sub-select. The only mentions of FROM/collaborator
    // that may remain are inside write routes (which still live here in
    // Phase 2A), so we pin the read-side projection that's unique to the
    // list query.
    expect(indexSrc).not.toMatch(/SELECT\s+s\."_id",\s+s\."_class"[\s\S]+?FROM\s+space\s+s\s+WHERE\s+s\."workspaceId"=\$1/i)
  })

  it('does not embed the members-list person/email/last_activity sub-queries', () => {
    expect(indexSrc).not.toMatch(/SELECT\s+first_name,\s+last_name\s+FROM\s+global_account\.person\s+WHERE\s+uuid=\$1/i)
    expect(indexSrc).not.toMatch(/SELECT\s+last_activity_at\s+FROM\s+global_account\.account/i)
  })

  it('does not embed the invites / owners-count / grants reads', () => {
    expect(indexSrc).not.toMatch(/FROM\s+global_account\.invite\s+WHERE\s+workspace_uuid=\$1/i)
    // Wave 5 / Task C2 — the old `role IN ('OWNER','MAINTAINER')` query
    // is gone; handleOwnersCount uses AccountDB.getWorkspaceMembers and
    // counts AccountRole.Owner only.
    expect(indexSrc).not.toMatch(/FROM\s+global_account\.workspace_members\s+WHERE\s+workspace_uuid=\$1\s+AND\s+role\s+IN/i)
    expect(indexSrc).not.toMatch(/SELECT\s+c\."_id"\s+AS\s+resource_id[\s\S]+?FROM\s+collaborator\s+c/i)
    expect(indexSrc).not.toMatch(/SELECT\s+count\(\*\)\s+AS\s+c\s+FROM\s+collaborator\s+WHERE\s+"workspaceId"=\$1/i)
  })

  it('does not embed the my-access JSONB membership query', () => {
    expect(indexSrc).not.toMatch(/data->'members'\s+\?\s+\$2\s+OR\s+data->'owners'\s+\?\s+\$2/i)
  })

  it('does not embed the activityBucket bucketing ternary', () => {
    // The chained ternary was a tell-tale of inline bodies; the bucketize
    // helper now lives in the plugin's readRouter module.
    expect(indexSrc).not.toMatch(/activityBucket:\s*lastAct\s*==\s*null/)
  })

  // ------------------------------------------------------------------
  // 2. Dispatch wiring is in place.
  // ------------------------------------------------------------------

  it('imports createWacReadHandlers from the server plugin', () => {
    expect(indexSrc).toMatch(/from '@hcengineering\/server-workspace-access'/)
    expect(indexSrc).toMatch(/createWacReadHandlers/)
  })

  it('wires wacReadDeps + builds wacReadHandlers', () => {
    expect(indexSrc).toMatch(/const\s+wacReadDeps:\s*WacReadDeps/)
    expect(indexSrc).toMatch(/const\s+wacReadHandlers\s*=\s*createWacReadHandlers\(wacReadDeps\)/)
  })

  it('dispatches every read route + CSV-export to the plugin', () => {
    expect(indexSrc).toMatch(/wacReadHandlers\.handleMembers\(/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleSpaces\(/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleSpaceDetail\(/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleAudit\(/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleMyAccess\(/)
    // Wave 5 / Task C2 — hard-rename to /owners/count. The /admins/count
    // route literal MUST be gone; the new /owners/count dispatch must be
    // wired in. Clean diff for the eventual upstream PR (WAC isn't
    // upstream yet so no backwards-compat shim is needed).
    expect(indexSrc).not.toMatch(/handleAdminsCount/)
    expect(indexSrc).not.toMatch(/'admins\/count'/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleOwnersCount\(/)
    expect(indexSrc).toMatch(/'owners\/count'/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleInvites\(/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleGrants\(/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleGrantsCount\(/)
    expect(indexSrc).toMatch(/wacReadHandlers\.handleAuditCsvExport\(/)
  })

  // ------------------------------------------------------------------
  // 3. Auth gates were not moved (the host still owns them).
  // ------------------------------------------------------------------

  it('still gates all WAC reads via authenticateWac', () => {
    // We expect at least two authenticateWac call sites in the read +
    // CSV-export middlewares plus the existing write middleware. The
    // exact count is allowed to drift, so we only assert >= 3.
    const matches = indexSrc.match(/authenticateWac\(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  // ------------------------------------------------------------------
  // 4. Phase 2B — write routes are now thin too.
  // ------------------------------------------------------------------

  it('does not embed any write-path SQL (jsonb_set / UPDATE space / data->...)', () => {
    // Write block previously held: jsonb_set(data, '{members|owners|private|autoJoin|archived}', ...)
    expect(indexSrc).not.toMatch(/jsonb_set\(data,\s*'\{members\}'/i)
    expect(indexSrc).not.toMatch(/jsonb_set\(data,\s*'\{owners\}'/i)
    expect(indexSrc).not.toMatch(/jsonb_set\(data,\s*'\{private\}'/i)
    expect(indexSrc).not.toMatch(/jsonb_set\(data,\s*'\{autoJoin\}'/i)
    expect(indexSrc).not.toMatch(/jsonb_set\(data,\s*'\{archived\}'/i)
    expect(indexSrc).not.toMatch(/UPDATE\s+space\s+SET\s+data/i)
    expect(indexSrc).not.toMatch(/UPDATE\s+global_account\.workspace_members\s+SET\s+role/i)
  })

  it('does not retain the fetchSpaceDetailRaw helper', () => {
    expect(indexSrc).not.toMatch(/async function fetchSpaceDetailRaw/i)
  })

  it('imports createWacWriteHandlers + WacWriteDeps from the server plugin', () => {
    expect(indexSrc).toMatch(/createWacWriteHandlers/)
    expect(indexSrc).toMatch(/WacWriteDeps/)
  })

  it('wires wacWriteDeps with the wacTxClient + builds wacWriteHandlers', () => {
    expect(indexSrc).toMatch(/const\s+wacWriteDeps:\s*WacWriteDeps/)
    expect(indexSrc).toMatch(/txClient:\s*wacTxClient/)
    expect(indexSrc).toMatch(/const\s+wacWriteHandlers\s*=\s*createWacWriteHandlers\(wacWriteDeps\)/)
  })

  it('dispatches every write route to the plugin', () => {
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleSpaceMembers\(/)
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleSpaceOwners\(/)
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleSpacePrivacy\(/)
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleSpaceAutoJoin\(/)
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleSpaceArchived\(/)
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleMemberRole\(/)
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleBulkMemberRole\(/)
    expect(indexSrc).toMatch(/wacWriteHandlers\.handleGrantRevoke\(/)
  })
})
