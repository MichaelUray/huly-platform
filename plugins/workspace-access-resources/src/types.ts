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
  | 'IMPERSONATING_ADMIN'

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

export interface SpaceRow {
  _id: string
  _class: SpaceClass
  name: string
  ownerIds: string[]
  membersCount: number
  private: boolean
  autoJoin: boolean
  archived: boolean
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
