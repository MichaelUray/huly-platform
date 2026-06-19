# @hcengineering/server-workspace-access

WAC server module — endpoints, migrations, impersonation lifecycle. Designed to be plugged into Huly's transactor / account-server in a thin wiring layer.

## Migrations

`migrations` is a `ReadonlyArray<Migration>` exposing V31-V33 in order:

```ts
import { migrations } from '@hcengineering/server-workspace-access'

for (const m of migrations) {
  await db.tx(async (tx) => {
    await tx.query(m.sql)
  })
}
```

All three are forward-only with `IF NOT EXISTS` guards; a re-run is a no-op.

## Endpoints

All endpoints take a `ctx` (with `token`, `account`, `membership`, `isImpersonating`) plus parameters plus a backend interface for the DB-level operation. They handle:

- **assertWorkspaceContext** — token audience + workspace claim guard
- **getEffectiveRole** — multi-role resolver (most-permissive-wins)
- **WRITE_ALLOWED_ROLES / READ_ALLOWED_ROLES** — constant gate sets
- **withImpersonationAudit** — dual-write to `workspace_audit_log` and
  `admin_audit_log` when impersonating

```ts
import {
  listWorkspaceMembers,
  setSpaceMembers,
  startImpersonation,
  assertImpersonationToken,
  revokeGrant
} from '@hcengineering/server-workspace-access'

app.get('/api/wac/:workspace/members', async (req, res) => {
  const result = await listWorkspaceMembers(
    buildCtx(req),
    { workspace: req.params.workspace, ...readListOpts(req) },
    membersBackend
  )
  res.json(result)
})
```

## Impersonation

The token is JWT (audience='wac', 30 min TTL). All 8 claims validated per request:

1. `jti` (revocation tracking)
2. `sub` (admin UUID)
3. `workspace` (anchor for IDOR check)
4. `audience='wac'` (rejects admin-audience tokens)
5. `exp` (TTL)
6. `extra.impersonation=true`
7. `extra.impersonation_ref` (joins admin and workspace audit rows)
8. `extra.actor_admin` (audit trail)

Rate limits:
- 10 starts/hour per admin
- 5 starts/hour per workspace

IDOR and replay attempts both write `impersonation_idor_attempt` and `impersonation_replay_attempt` to `admin_audit_log`.

## Backfill

`v33BackfillWorkspace(deps, workspace)` walks the workspace's current state and writes synthetic audit rows. Idempotent via the V32 unique index `idx_wal_backfill_unique`. Supports pause/resume + 3-retry give-up.

## Mention-Grants

`listGrants` / `countGrants` / `revokeGrant` expose the existing Collaborator records as WAC's "Granted access" sub-tab. Owner can revoke any grant; the grant's creator can revoke their own (used by My-Access → Granted by Me).

## What this package does NOT do

- HTTP layer (Express/Fastify routes) — that's the wiring PR
- DB connection pool — backend abstractions are dependency-injected
- WebSocket session management — `disconnectWebSocketsByToken` is a hook

This keeps the audit + RBAC + impersonation logic centralized and unit-testable independent of the runtime.
