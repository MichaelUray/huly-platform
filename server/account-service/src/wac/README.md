# account-service/src/wac

Account-service-internal helpers wiring the WAC plugin
(`@hcengineering/server-workspace-access`) into the live HTTP host.

This directory holds **the boundary between Koa + the account DB on one
side, and the plugin's DI-shaped handlers on the other**. It does not
contain any business logic — every policy decision lives in the plugin.
What lives here:

| File | Purpose | Contract |
|------|---------|----------|
| `auth.ts` | `authenticateWac(ctx, workspaceParam, capability, deps)` — the single auth gate every `/api/wac/*` middleware calls before reaching a handler. Resolves the bearer token, looks up the caller's effective workspace role, maps the capability requirement to the allowed role-set, and either returns a `WacAuthContext` or short-circuits the response with 401/403/404. | Returns `{ workspaceUuid, callerUuid, callerRole }` on success. On failure: writes the appropriate status (401 missing/invalid token, 403 insufficient role, 404 workspace not found) and returns `null` — the middleware must check and `return` immediately. |
| `transactorClient.ts` | `createWacTxClient({ transactorUrl, systemToken, clientFactory })` — wraps `@hcengineering/client` so write-side handlers can issue TxOperations against the transactor without bringing the platform client into the plugin's runtime deps. Memoizes one Client per workspace, refreshes on transactor 401, and exposes the small `WacTxClient` surface the plugin's `writeRouter.ts` needs. | `update(workspaceUuid, ...)`, `findAll(workspaceUuid, ...)`, `close()`. All methods accept the workspaceUuid as the first arg; the client is built lazily and reused across requests within the same workspace. |
| `cacheInvalidator.ts` | `createWacCacheInvalidator({ accountsUrl, logger })` — broadcasts a `wac-role-changed` event to open sessions so the platform's cached membership rolls forward without a logout. Uses the same `account-metadata-Token` cookie shape as the rest of account-service. Also exports a `noopWacCacheInvalidator` for tests + the `WAC_DISABLE_LIVE_CACHE_INVALIDATION` env opt-out. | `invalidate(workspaceUuid, accountUuid)`. Fire-and-forget; logs (but does not throw) on transport failure so an audit-write isn't rolled back when the invalidator is unreachable. |

## Why a separate directory

The plugin (`server-plugins/workspace-access`) is published as a
Huly-platform package and **must not** depend on
`@hcengineering/account` or `@hcengineering/postgres-base` at runtime —
that would pull half the server graph into anything that imports the
plugin's types. So the plugin defines DI surfaces (`PgClientLike`,
`AccountDbLike`, `WacTxClient`, `WacCacheInvalidator`) and this
directory contains the concrete account-service-bound implementations
that satisfy them.

The same plugin code can be hosted from a different process tomorrow by
swapping these three files for an equivalent set against a different
runtime — without touching the plugin.

## Tests

Each file has a focused unit test under `../__tests__/`:

| Tested by | Surface |
|-----------|---------|
| `wacAuth.test.ts` | All four capability levels (`read`, `read-self`, `edit`, `admin`), the role-mapping table, the 401/403/404 branches, and the bearer-fallback to the `account-metadata-Token` cookie. |
| `wacTxClient.test.ts` | Per-workspace memoization, refresh on transactor 401, the `close()` cleanup path, and a 500→propagate path. |
| `wacCacheInvalidator.test.ts` | The fire-and-forget contract (errors logged not thrown), the no-op stub, and the env opt-out. |

## Rate-limiting (CSV exports)

The admin and WAC CSV-export routes share a single rate-limiter
(`../util/redisRateLimiter.ts`). Keys are namespaced so the two routes
do not starve each other:

- `csv:admin:<sha256(token)>` — admin `GET /api/admin/accounts/export.csv`
- `csv:wac:<sha256(token)>` — WAC `GET /api/wac/<ws>/audit/export.csv`

Both buckets are sized 5 requests / 60 s / token.

### Backend selection

| `REDIS_URL` | Backend | Behaviour |
|-------------|---------|-----------|
| set | Redis (atomic `INCR` + `PEXPIRE` via Lua) | Cluster-wide cap. Production. |
| unset / empty | Process-local `Map` | Per-pod cap (D7 violation, dev/test only). A `warn` breadcrumb is emitted at boot. |

### Fixed-window semantics (deliberate)

The Lua script is `INCR` + conditional `PEXPIRE` (only on the
counter-creating call). The TTL is anchored to the first request in a
window, not refreshed on every hit — that is fixed-window, not
sliding-window. We picked it intentionally so sustained abuse cannot
walk the bucket forward indefinitely.

### Fail-open on Redis errors

Any error from `EVAL` (connection refused, timeout, MOVED in cluster
mode, …) is caught and the request is **allowed** with an `error`-level
breadcrumb. Rationale: a transient infra blip should not block a real
admin from running a one-off export. Sustained failures are visible in
logs / alerts.

### Token hashing

The bucket key is `sha256(token)` — never the raw token — so neither
log lines nor Redis keys leak credential material.

## What this directory does NOT do

- Audit-row writes — those live inline in `serveAccount(...)` via
  `writeWacAudit(...)` so they share a postgres handle with the rest of
  account-service.
- Migrations — owned by the plugin (`backfill/` + `migrations/`).
- Impersonation token shape — owned by the plugin
  (`src/impersonation/index.ts`); the host just issues the JWT via
  `@hcengineering/server-token` and lets the plugin's
  `assertImpersonationToken` validate it on incoming requests.
