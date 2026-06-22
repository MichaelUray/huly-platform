//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Workspace Access Center server module. Exports:
//   - migrations  : V31-V33 SQL (loaded from /migrations/*.sql)
//   - endpoints   : list + edit endpoint helpers (DI-friendly)
//   - impersonation : token start/end/validate + audit hooks
//   - backfill    : V33 orchestrator
//   - http        : Phase 2A — read-route + CSV-export handlers used
//                   by account-service as a thin host. See
//                   src/http/readRouter.ts for the policy/IO surface.
//
// The package does not own its own HTTP server or DB pool. The
// account-service stays the HTTP host (mount/DI/auth gates); this
// module owns the read-side policy + business logic so the host file
// stays small.
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

export { listGrants, countGrants, revokeGrant, setGrantExpiry } from './endpoints/grantEndpoints'
export type { GrantRow, GrantBackend, GrantCtx } from './endpoints/grantEndpoints'

export { effectivePermissions } from './endpoints/effectivePermissions'
export type {
  EffectivePermissionsBackend,
  EffectivePermissionsCtx,
  EffectivePermissionsParams,
  EffectivePermissionsResult,
  EffectivePermissionsUser,
  EffectivePermissionsResource,
  EffectivePermissionsResourceFull,
  EffectivePermissionsPathStep,
  EffectivePermissionsDecision,
  EffectivePermissionsRole,
  EffectivePermissionsAuditEntry
} from './endpoints/effectivePermissions'

// Time-bounded grants — periodic prune job that removes rows whose
// expires_at has passed. Hosts wire this into their lifecycle so the
// schedule survives restarts; see account-service/src/wac for the
// canonical wiring.
export {
  runExpiredGrantPruneOnce,
  startExpiredGrantPruner,
  DEFAULT_PRUNE_INTERVAL_MS
} from './backfill/expiredGrantPruner'
export type {
  ExpiredGrantPrunerDeps,
  ExpiredGrantPrunerHandle,
  ExpiredGrantRow,
  PruneResult
} from './backfill/expiredGrantPruner'

export { v33BackfillWorkspace, MAX_RETRIES } from './backfill/v33Orchestrator'
export type {
  BackfillState,
  BackfillRow,
  BackfillBatch,
  BackfillDeps,
  OrchestratorOptions
} from './backfill/v33Orchestrator'

export { createWacReadHandlers } from './http/readRouter'
export type {
  WacReadDeps,
  WacReadHandlers,
  KoaCtxLike,
  PgClientLike,
  AccountDbLike,
  MeasureCtxLike
} from './http/readRouter'

export { createWacWriteHandlers } from './http/writeRouter'
export type {
  WacWriteDeps,
  WacWriteHandlers,
  WacTxClientLike,
  KoaWriteCtxLike,
  WritePgClientLike,
  WriteAccountDbLike,
  WriteMeasureCtxLike
} from './http/writeRouter'

// Permission Templates (a.k.a. Role+Spaces Presets). Workspace-local list
// of reusable role/space templates an Owner can apply to selected members.
// Tier-1 shape: { role, addToSpaces } — see http/presetsRouter.ts.
export { createWacPresetsHandlers, validateShape } from './http/presetsRouter'
export type {
  WacPresetsHandlers,
  PresetShape,
  PresetWireRole,
  PresetRow,
  ApplyResult,
  ApplyResultStatus
} from './http/presetsRouter'

// M2 — shared audit-row INSERT used by every WAC audit call-site.
// Hosts that issue their own audit rows (e.g. impersonation lifecycle in
// account-service) should call `executeWorkspaceAuditInsert` instead of
// duplicating the SQL.
export {
  executeWorkspaceAuditInsert,
  WORKSPACE_AUDIT_INSERT_SQL
} from './audit/insert'
export type {
  AuditInsertPgClient,
  WorkspaceAuditPayload
} from './audit/insert'

// Outbound webhook infrastructure (Wave 6 / new): CRUD + dispatcher +
// SSRF guard. Wired by the account-service host through CRUD endpoints;
// audit-side fan-out is opt-in via the dispatcher.
export {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  dispatchActiveWebhooksAsync,
  ValidationError as WebhookValidationError,
  ALLOWED_WEBHOOK_EVENT_TYPES,
  MAX_WEBHOOKS_PER_WORKSPACE
} from './endpoints/webhookEndpoints'
export type {
  WebhookBackend,
  WebhookCtx,
  WebhookCreateInput,
  WebhookUpdateInput,
  WebhookRow,
  WebhookSubscription,
  DataFilter,
  TestFireDeps
} from './endpoints/webhookEndpoints'

export {
  dispatchWebhook,
  buildPayload,
  signPayload,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRY_DELAYS_MS
} from './webhooks/dispatcher'
export type {
  WebhookAction,
  AuditEvent,
  DispatchResult,
  DispatchAttempt,
  DispatcherDeps
} from './webhooks/dispatcher'

export {
  validateWebhookUrl,
  assertResolvedHostSafe,
  isBlockedIp,
  WebhookUrlError
} from './webhooks/ssrf'
export type { LookupFn, UrlValidationResult } from './webhooks/ssrf'

export {
  processBulkInviteCsv,
  previewBulkInviteCsv,
  previewRowForResponse,
  splitCsvLine,
  stripBom,
  hashEmail,
  BulkInviteError,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS
} from './endpoints/bulkInviteEndpoints'
export type {
  BulkInviteCtx,
  BulkInviteOptions,
  BulkInvitePreview,
  BulkInviteResult,
  BulkInviteRow,
  BulkInviteSummary,
  PreviewBulkInviteResult,
  PreviewBulkInviteRow,
  RowStatus
} from './endpoints/bulkInviteEndpoints'
