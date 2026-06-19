//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Workspace Access Center frontend plugin.
//

export { default as AccessCenter } from './components/AccessCenter.svelte'
export { default as TabBar } from './components/TabBar.svelte'

// Views
export { default as PeopleView } from './components/people/PeopleView.svelte'
export { default as ResourcesView } from './components/resources/ResourcesView.svelte'
export { default as MyAccessView } from './components/my-access/MyAccessView.svelte'
export { default as AuditView } from './components/audit/AuditView.svelte'

// Impersonation surface
export { default as ImpersonationBanner } from './components/impersonation/ImpersonationBanner.svelte'
export { default as AssumeRoleModal } from './components/impersonation/AssumeRoleModal.svelte'
export { default as ExpiredModal } from './components/impersonation/ExpiredModal.svelte'

// DSGVO
export { default as DsgvoFirstOpenBanner } from './components/shared/DsgvoFirstOpenBanner.svelte'

// API surface (so admin/workbench code can prime the client)
export { setDefaultWacClient, getDefaultWacClient, WacClient, WacError } from './api/wacClient'
export { peopleApi } from './api/peopleApi'
export { resourcesApi } from './api/resourcesApi'
export { myAccessApi } from './api/myAccessApi'
export { auditApi } from './api/auditApi'
export { grantedAccessApi } from './api/grantedAccessApi'
export { impersonationApi } from './api/impersonationApi'

// Stores
export {
  impersonationStore,
  enterDrillDown,
  startImpersonation,
  endImpersonation,
  markExpired,
  getImpersonationToken
} from './stores/impersonationStore'
export type { ImpersonationState, ImpersonationModel } from './stores/impersonationStore'

export {
  roleStore,
  effectiveRole,
  canEdit,
  canReadWorkspaceWide,
  tabsForRole
} from './stores/roleStore'

// Types
export type {
  WorkspaceRole,
  EffectiveRole,
  ActivityBucket,
  MemberRow,
  SpaceClass,
  SpaceRow,
  AuditRow,
  GrantRow,
  PendingInvite,
  PageResult
} from './types'
