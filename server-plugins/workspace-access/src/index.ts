//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Workspace Access Center server module. Exports:
//   - migrations  : V31-V33 SQL (loaded from /migrations/*.sql)
//   - endpoints   : list + edit endpoint helpers (DI-friendly)
//   - impersonation : token start/end/validate + audit hooks
//   - backfill    : V33 orchestrator
//
// The package does not own its own HTTP server or DB pool. Wiring into
// Huly's transactor / account-server is the integration job in a
// follow-up PR; this layer keeps the auth + audit + RBAC logic so the
// wiring layer stays tiny.
//

export { migrations } from './migrations/loader'
export type { Migration } from './migrations/loader'

export {
  listWorkspaceMembers,
  listWorkspaceSpaces,
  listAuditLog,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE
} from './endpoints/listEndpoints'
export type { ListEndpointCtx, ListParams, ListBackend } from './endpoints/listEndpoints'

export {
  setSpaceMembers,
  setSpaceOwners,
  setSpacePrivacy,
  setSpaceAutoJoin,
  setSpaceArchived,
  setWorkspaceMemberRole,
  WRITE_ALLOWED_ROLES,
  ALLOWED_FIELDS_BY_SPACE_OWNER,
  FORBIDDEN_FIELDS_IN_WAC
} from './endpoints/editEndpoints'
export type { EditCtx, LastAdminCheck } from './endpoints/editEndpoints'

export {
  startImpersonation,
  endImpersonation,
  assertImpersonationToken,
  TTL_SECONDS,
  PER_ADMIN_HOURLY_LIMIT,
  PER_WORKSPACE_HOURLY_LIMIT
} from './impersonation'
export type {
  ImpersonationDeps,
  StartCtx,
  StartResult,
  ValidatedToken,
  JwtSigner,
  JwtPayload,
  RateLimiter,
  RevocationStore,
  AdminAuditWriter
} from './impersonation'

export { listGrants, countGrants, revokeGrant } from './endpoints/grantEndpoints'
export type { GrantRow, GrantBackend, GrantCtx } from './endpoints/grantEndpoints'

export { v33BackfillWorkspace, MAX_RETRIES } from './backfill/v33Orchestrator'
export type {
  BackfillState,
  BackfillRow,
  BackfillBatch,
  BackfillDeps,
  OrchestratorOptions
} from './backfill/v33Orchestrator'
