//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Workspace Access Center frontend plugin.
//

import { addStringsLoader } from '@hcengineering/platform'
import wac, { wacPluginId } from './plugin'

// H4 — Register lazy locale loaders. The platform invokes the loader once
// per language on first reference. Coverage is partial in this pass
// (~30 strings); the rest of the surface still uses getEmbeddedLabel —
// see README "i18n status".
addStringsLoader(wacPluginId, async (lang: string) => await import(`../lang/${lang}.json`))

export { wac, wacPluginId }
export default wac

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
export {
  setDefaultWacClient,
  getDefaultWacClient,
  WacClient,
  WacError,
  getEffectiveBearerToken,
  setRegularTokenGetter
} from './api/wacClient'
export { peopleApi, summarizeBulkRoleResult } from './api/peopleApi'
export type {
  BulkRoleEntry,
  BulkRoleResult,
  BulkRoleStatus,
  BulkRoleSummary
} from './api/peopleApi'
export { resourcesApi } from './api/resourcesApi'
export {
  resourcesBulkApi,
  summarizeResourceBulkResult
} from './api/resourcesBulkApi'
export type {
  ResourceBulkResult,
  ResourceBulkEntry,
  ResourceBulkStatus,
  ResourceBulkSummary
} from './api/resourcesBulkApi'
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

// Wave 7 / B4 — refetch + demoted-banner helpers consumed by
// setting-resources/AccessCenterPage.svelte.
export {
  roleHierarchy,
  isDemote,
  makeThrottle,
  ACCESS_REFETCH_INTERVAL_MS
} from './util/accessRefresh'
export type { ThrottleGate } from './util/accessRefresh'

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
