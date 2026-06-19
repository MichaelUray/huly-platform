//
// Copyright © 2026 Hardcore Engineering Inc.
//

export { Forbidden } from './Forbidden'

export { assertWorkspaceContext } from './assertWorkspaceContext'
export type { WorkspaceContext } from './assertWorkspaceContext'

export {
  getEffectiveRole,
  READ_ALLOWED_ROLES,
  WRITE_ALLOWED_ROLES
} from './getEffectiveRole'
export type { EffectiveRole, RoleCtx } from './getEffectiveRole'

export { AuditLogger } from './AuditLogger'
export type {
  SqlExecutor,
  WorkspaceAuditEntry,
  AdminAuditEntry
} from './AuditLogger'

export { withImpersonationAudit } from './withImpersonationAudit'
export type { ImpersonationCtx, TxCtx, WACPayload } from './withImpersonationAudit'

export {
  assertSpaceOwnerEdit,
  ALLOWED_FIELDS_BY_SPACE_OWNER,
  FORBIDDEN_FIELDS_IN_WAC
} from './assertSpaceOwnerEdit'
export type { SpaceOwnerEditCtx, SpaceShape } from './assertSpaceOwnerEdit'
