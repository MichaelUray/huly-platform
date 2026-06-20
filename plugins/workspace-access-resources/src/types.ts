//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Lib-neutral row shapes returned by `/api/wac/...` endpoints. Mirrored
// in workspace-access-server's types (Phase 2b); kept here so the
// frontend doesn't depend on the server package.
//

export type WorkspaceRole = 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
export type EffectiveRole =
  | 'OWNER'
  | 'MAINTAINER'
  | 'MAINTAINER_PLUS_SPACE_OWNER'
  | 'SPACE_OWNER_SCOPED'
  | 'USER_SELF_SCOPED'
  | 'GUEST'
  /** Active impersonation session — read+write, dual-audited. */
  | 'IMPERSONATING_ADMIN'
  /** Instance-Admin drilled into WAC from #10883 admin panel WITHOUT
   * starting an impersonation session — read-only blue banner state.
   * Distinct from IMPERSONATING_ADMIN because no audit entries are
   * emitted from this surface and no edits are possible. */
  | 'INSTANCE_ADMIN_READONLY'

export type ActivityBucket = 'today' | '7d' | '30d' | '90d+'

export interface MemberRow {
  uuid: string
  name: string
  email: string
  role: WorkspaceRole
  activityBucket: ActivityBucket
  spacesCount: number
}

export type SpaceClass =
  | 'tracker.class.Project'
  | 'document.class.Teamspace'
  | 'drive.class.Drive'
  | 'card.class.CardSpace'
  | 'lead.class.Funnel'
  | 'recruit.class.Vacancy'
  | 'recruit.class.JobFunnel'
  // Synthetic v2-placeholder classes emitted by `handleSpaces` for the
  // resource types that are deliberately out-of-scope for v1 (D4).
  // The UI renders them with `capabilities.v2NotYet=true` badges.
  | 'chunter.placeholder.v2'
  | 'love.placeholder.v2'
  | 'guest.placeholder.v2'

/**
 * Capability-Matrix block returned per resource row by `/api/wac/.../spaces`.
 *
 * `editableHere` — whether WAC owns the members/owners/flags edit surface
 * `openInApp`    — deep-link path to the underlying Huly workbench app, or null
 * `v2NotYet`     — true for synthetic placeholder rows (Chat / Office / Guest-Links)
 *
 * Optional on the type so older payloads (without the capabilities block)
 * deserialize cleanly during a rolling deploy; the UI treats `undefined`
 * as the conservative default ("not editable here").
 */
export interface SpaceCapabilities {
  editableHere: boolean
  openInApp: string | null
  v2NotYet: boolean
}

export interface SpaceRow {
  _id: string
  _class: SpaceClass
  name: string
  ownerIds: string[]
  membersCount: number
  private: boolean
  autoJoin: boolean
  archived: boolean
  capabilities?: SpaceCapabilities
}

/**
 * Full Space detail returned by `resourcesApi.getSpace`. Distinct from
 * `SpaceRow` so the listSpaces endpoint can omit the (potentially large)
 * `members` list for performance while the drawer still gets it.
 */
export interface SpaceDetail extends SpaceRow {
  members: string[]
}

export interface AuditRow {
  id: string
  ts: string
  action: string
  actor: string | null
  actor_pseudonym: string | null
  actor_role: string
  target_account?: string | null
  target_space?: string | null
  target_space_class?: string | null
  old_value?: unknown
  new_value?: unknown
  metadata?: Record<string, unknown>
}

export interface GrantRow {
  recipientUuid: string
  recipientName: string
  granterUuid: string
  granterName: string
  resourceId: string
  resourceClass: string
  resourceTitle: string
  grantedAt: string
}

export interface PendingInvite {
  id: string
  email: string
  invitedBy: string
  invitedAt: string
  expiresAt: string
}

export interface PageResult<T> {
  items: T[]
  cursor: string | null
}
