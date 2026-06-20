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

## v1 Scope (User-Decision D4)

The v1 surface manages the following resources:

- **Workspace Members** — list + role edit (OWNER / MAINTAINER / USER / GUEST + Guest sub-roles)
- **Space-derived resources** (7 classes whitelisted in `handleSpaces`):
  - `tracker:class:Project`
  - `document:class:Teamspace`
  - `drive:class:Drive`
  - `card:class:CardSpace`
  - `lead:class:Funnel`
  - `recruit:class:Vacancy`
  - `recruit:class:JobFunnel`
- **Audit log** (read + CSV export)
- **My Access** (per-caller self-view + grants received/given)
- **Mention-grants** (Collaborator records exposed as "Granted access")
- **Impersonation** (dual-audited admin drill-down)

### Out of v1 — v2 candidates (D4: codeseitig raus statt halb-flagged)

The following were deliberately excluded from the v1 code base. They are
surfaced as **placeholder rows** in the Capability-Matrix (`handleSpaces`)
with `capabilities.v2NotYet=true` so the UI can show "not managed here yet"
badges and deep-link to the underlying Huly app for now:

- **Chat Channels** (`chunter:class:ChannelSpace`) — channel-level membership UI
- **Office Rooms** (`love:class:*`) — room ACL editor
- **Guest Links** — invite-link generation + revocation surface
- **Per-Space-Type roles** — currently only workspace-level roles are editable
- **Inherited visibility** for issues/docs/cards/files (per-resource grants beyond Collaborator)
- **Per-guest-sub-role capability matrix** — Guest / ReadOnlyGuest / DocGuest are
  *reported* by `handleMembers` (v1) but all three currently collapse to the same
  capability set ("locked out of read/edit, my-access only"). Finer gating is v2.

## Capability-Matrix per resource row

Each row returned by `handleSpaces` carries a `capabilities` block so the
UI can render edit/read-only/open-in-app affordances without hardcoding
class-to-route mappings:

```ts
capabilities: {
  editableHere: boolean,        // can WAC edit this row's members/owners/flags?
  openInApp: string | null,     // deep-link path, e.g. "/workbench/<ws>/tracker/<id>"
  v2NotYet: boolean             // true for synthetic placeholder rows (Chat/Office/Guest-Links)
}
```

`handleSpaces` appends 3 synthetic placeholder rows (`chunter.placeholder.v2`,
`love.placeholder.v2`, `guest.placeholder.v2`) after the real query so the UI
shows a consistent "v2 coming soon" surface for the deliberately-excluded
resource types.

## What this package does NOT do

- HTTP layer (Express/Fastify routes) — that's the wiring PR
- DB connection pool — backend abstractions are dependency-injected
- WebSocket session management — `disconnectWebSocketsByToken` is a hook

This keeps the audit + RBAC + impersonation logic centralized and unit-testable independent of the runtime.
