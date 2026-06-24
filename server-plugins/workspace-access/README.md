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

**M7 — placeholder synthesis moved to the UI.** Pre-fix, `handleSpaces`
appended 3 synthetic placeholder rows after the real query so the UI
could render "v2 coming soon" cards. That polluted the API contract:
every non-UI consumer (CLIs, dashboards, future admin tooling) got the
magic rows whether they wanted them or not. The UI was the only
consumer that knew how to render `v2NotYet=true` rows, so the
synthesis lives there now (`plugins/workspace-access-resources/src/
components/resources/AllSpacesTab.svelte`). The backend response now
contains only real space rows.

## What this package does NOT do

- HTTP layer (Express/Fastify routes) — that's the wiring PR
- DB connection pool — backend abstractions are dependency-injected
- WebSocket session management — `disconnectWebSocketsByToken` is a hook

This keeps the audit + RBAC + impersonation logic centralized and unit-testable independent of the runtime.

## Architecture (Phase 4)

The package follows a tight DI shape so the same handlers can run inside
account-service today and behind a separate process tomorrow. There are
four collaborator surfaces:

| Surface | Purpose | Implemented in (host) |
|--------|---------|-----------------------|
| `WacReadHandlers` (`http/readRouter.ts`) | All GET /api/wac/* business logic | `server/account-service/src/index.ts` mounts via `createWacReadHandlers(deps)` |
| `WacWriteHandlers` (`http/writeRouter.ts`) | POST/PUT/DELETE mutations + audit-row sequencing | Same host, `createWacWriteHandlers(deps)` |
| `WacTxClient` (interface) | Issues TxOperations against the transactor for mutations that must go through the model | `server/account-service/src/wac/transactorClient.ts` (production) / test stubs |
| `WacCacheInvalidator` (interface) | Live notification to the platform when a workspace role changes (so open sessions reload their capability set) | `server/account-service/src/wac/cacheInvalidator.ts` (production) / no-op stub in tests |

Auth + workspace-param resolution happens in the host **before** these
handlers run. The handlers receive the resolved `workspaceUuid` (plus,
where relevant, `callerUuid` + `callerRole`) as positional arguments —
they never re-read the request token. This is what lets the same handler
code be exercised under jest with a plain `KoaCtxLike` stub.

### Atomicity caveat

The write-path is **not transactional across the model + audit log**:

1. `txClient.update(...)` — mutates the workspace state through the
   transactor's TxOperations.
2. `pg.execute('INSERT INTO workspace_audit_log ...')` — writes the
   audit row directly against postgres.

If step 1 succeeds and step 2 fails, the workspace state has changed but
the audit trail is missing the row. The handlers log the failure via
`measureCtx.warn('WAC audit write failed', …)` so an operator can
reconstruct from the transactor's own tx log + the model's `modifiedOn`,
but the loss is **not automatically backfilled**.

### Fail-closed role mapping (M6)

`mapRole(raw)` in `server/account-service/src/wac/auth.ts` collapses
any unknown role string to `'GUEST'` — the most restrictive bucket.
This is **intentional fail-closed behaviour**:

- If upstream adds a new `AccountRole` enum value that WAC's wire-form
  list doesn't yet handle, the new role gets denied access until WAC
  is updated to recognize it explicitly.
- Defaulting to `'USER'` or `'MAINTAINER'` would silently grant
  whatever surface the new role was intended to map to.

When adding a new role:

1. Add the wire-form to `WacRole` in `wac/auth.ts`.
2. Add the case branch in `mapRole(...)`.
3. Add the matching entry to `WacWireRole` + `mapWacRole(...)` in
   `server-plugins/workspace-access/src/http/readRouter.ts`.
4. Add it to `ALLOWED_ROLES` in
   `server-plugins/workspace-access/src/http/writeRouter.ts`.
5. Add the dropdown option in
   `plugins/workspace-access-resources/src/components/people/PersonDrawer.svelte`.
6. Add the IntlString to `plugin.ts` + `lang/en.json` + `lang/de.json`.

### CSV-export rate limit (M3)

`GET /api/wac/<ws>/audit/export.csv` is rate-limited at 5 requests per
minute per bearer-token via a `TokenBucketLimiter` instance separate
from the admin export limiter. Exceeding the limit returns
`HTTP 429` with `Retry-After: 60`.

**Known D7 violation:** the limiter is process-local. account-service
is load-balanced, so the cap is per-pod, not per-user cluster-wide.
The same limitation applies to the admin export route. v2 plan is to
move both limiters behind a shared backend (Redis token-bucket or
equivalent) — out of scope for this hardening pass.

### Observability — `wac_audit_orphan` (M1)

Every audit-INSERT failure post-successful-mutation now increments a
numeric counter via `MeasureContext.measure('wac_audit_orphan', 1)` in
addition to the existing error breadcrumb. Subscribe to that metric on
your observability sidecar (Prometheus, Datadog, etc.) to alert on
audit-row drops without grepping logs.

The matching breadcrumb is still emitted via `measureCtx.error(...)`
with `attrs.breadcrumb = 'wac_audit_orphan'` so existing log-grep
alerting keeps working.

This is the same trade-off the inline implementation made before Phase
2B, kept here intentionally because:

- The transactor doesn't expose a 2-phase commit hook for postgres-side
  writes, so true atomicity would require a sidecar tx-log replay.
- v33 backfill (`backfill/v33BackfillWorkspace`) can synthesize the
  missing rows from the model after the fact, idempotently.

A v2 enhancement would be to write the audit row first as `pending`,
flip it to `committed` after the TxOperations resolves, and have a
reaper sweep `pending` rows older than a few seconds — out of scope for
this PR.

## Deployment

The host (account-service) wires the handlers in `serveAccount(...)`.
The relevant environment variables are:

| Env | Default | Effect |
|-----|---------|--------|
| `WAC_EXTRA_SPACE_CLASSES` | `""` (empty) | Comma-separated list of additional `_class` strings to allow in `handleSpaces`. Tokens must match `<plugin>:class:<Name>`; malformed entries are silently dropped. v1-managed core classes are always included regardless of this env. |
| `WAC_DISABLE_LIVE_CACHE_INVALIDATION` | `false` | When `true`, role-change writes don't fan out to the cache invalidator (used by the test stack on `dev.huly.uray.io`). |
| `ACCOUNTS_URL` | inherited from account-service | Used by the transactor client to call back into the host for the impersonation audience guard. |

### Adding a plugin's Space subclass to WAC

Set `WAC_EXTRA_SPACE_CLASSES=myplugin:class:Foo,other:class:Bar` on the
account-service deployment. After a pod restart the new classes show up
in `/api/wac/<ws>/spaces`. They inherit the default capability block:
`editableHere=true, openInApp=null, v2NotYet=false`. If you need a
custom `openInApp` deep-link, extend `capabilitiesForRealRow(...)` in
`http/readRouter.ts` (a code change, not env-driven).

### Cache-invalidation marker (H5)

When a workspace-role mutation lands, account-service issues a single
marker write against the workspace-level `Space` doc so the transactor
broadcasts a `TxUpdateDoc` to every connected client of that workspace.
Each affected client then refetches its capability set.

The marker is **one scalar field** — `wacInvalidationTick` — a
monotonic timestamp. We deliberately do NOT include the demoted
account's UUID in the broadcast payload: the workspace-Space update is
visible to every subscriber, and emitting the affected account would
leak who got role-changed via the operations payload.

The `wacInvalidationTick` field is not declared in the `Workspace`
model. This is an intentional side-channel: we rely on the transactor's
leniency for unknown attributes in `DocumentUpdate`. No consumer reads
the value — its job is solely to trigger the broadcast. If a future
Workspace model declares this field formally, switch
`server/account-service/src/wac/cacheInvalidator.ts` to use that
declared field instead.

### Process-local state

D7: no process-local security state. account-service is load-balanced,
so a per-process `Map` cannot enforce anything cluster-wide. v1
specifically does NOT maintain a JTI revocation map for impersonation
tokens — the 30-min expiry is the sole revocation mechanism. Cross-pod
revocation needs a shared backend (Redis or DB) and is tracked as a v2
follow-up; the `endImpersonation` HTTP route returns `501 not_implemented`
with `detail: revocation_pending_persistent_store` so the UI can present
a clear "session will end on expiry" message.
