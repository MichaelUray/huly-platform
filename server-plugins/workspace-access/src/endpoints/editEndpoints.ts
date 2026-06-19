//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Edit endpoints. WRITE_ALLOWED_ROLES never includes MAINTAINER. The
// Space-Owner side-channel applies only to `members`+`owners` and
// runs the four-constraint check from access-management-server.
//

import {
  assertWorkspaceContext,
  getEffectiveRole,
  WRITE_ALLOWED_ROLES,
  Forbidden,
  withImpersonationAudit,
  assertSpaceOwnerEdit,
  ALLOWED_FIELDS_BY_SPACE_OWNER,
  FORBIDDEN_FIELDS_IN_WAC,
  type EffectiveRole,
  type RoleCtx,
  type ImpersonationCtx,
  type SpaceOwnerEditCtx,
  type SpaceShape
} from '@hcengineering/access-management-server'

export interface EditCtx extends RoleCtx, ImpersonationCtx {
  token: { audience?: string; workspace?: string }
  isSpaceOwner: (space: string) => Promise<boolean>
  loadSpace: (space: string) => Promise<SpaceShape & { _class: string }>
  applyMembersUpdate: (space: string, next: string[]) => Promise<void>
  applyOwnersUpdate: (space: string, next: string[]) => Promise<void>
  applyFlagUpdate: (
    space: string,
    flag: 'private' | 'autoJoin' | 'archived',
    value: boolean
  ) => Promise<void>
  applyRoleUpdate: (target: string, role: string) => Promise<void>
  spaceOwnerCtx: (space: SpaceShape) => SpaceOwnerEditCtx
}

interface MembershipEdit {
  workspace: string
  space: string
  members: string[]
}
interface OwnersEdit {
  workspace: string
  space: string
  owners: string[]
}
interface FlagEdit {
  workspace: string
  space: string
  value: boolean
}
interface RoleEdit {
  workspace: string
  target: string
  role: 'OWNER' | 'MAINTAINER' | 'USER' | 'GUEST'
  /** When demoting an OWNER, server enforces last-owner check. */
}

function assertNotForbiddenField (field: string): void {
  if ((FORBIDDEN_FIELDS_IN_WAC as readonly string[]).includes(field)) {
    throw new Forbidden(`field_forbidden_in_wac:${field}`)
  }
}

async function gateWrite (
  ctx: EditCtx,
  workspace: string,
  field: 'members' | 'owners' | 'flags' | 'role'
): Promise<EffectiveRole> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== workspace) throw new Forbidden('workspace mismatch')
  const role = await getEffectiveRole(ctx, workspace)
  if (WRITE_ALLOWED_ROLES.includes(role)) return role
  // Space-Owner side channel only for members/owners
  if ((field === 'members' || field === 'owners') && (role === 'SPACE_OWNER_SCOPED' || role === 'MAINTAINER_PLUS_SPACE_OWNER')) {
    return role
  }
  throw new Forbidden(`write_not_allowed:${role}:${field}`)
}

export async function setSpaceMembers (ctx: EditCtx, p: MembershipEdit): Promise<void> {
  assertNotForbiddenField('members')
  const role = await gateWrite(ctx, p.workspace, 'members')
  const space = await ctx.loadSpace(p.space)
  if (role === 'SPACE_OWNER_SCOPED' || role === 'MAINTAINER_PLUS_SPACE_OWNER') {
    if (!(await ctx.isSpaceOwner(p.space))) throw new Forbidden('not_space_owner')
    await assertSpaceOwnerEdit(ctx.spaceOwnerCtx(space), space, 'members', space.members, p.members)
  }
  await withImpersonationAudit(
    ctx,
    'space_members_changed',
    { target_space: p.space, target_space_class: space._class, old: space.members, new: p.members },
    async () => {
      await ctx.applyMembersUpdate(p.space, p.members)
    }
  )
}

export async function setSpaceOwners (ctx: EditCtx, p: OwnersEdit): Promise<void> {
  assertNotForbiddenField('owners')
  const role = await gateWrite(ctx, p.workspace, 'owners')
  const space = await ctx.loadSpace(p.space)
  if (role === 'SPACE_OWNER_SCOPED' || role === 'MAINTAINER_PLUS_SPACE_OWNER') {
    if (!(await ctx.isSpaceOwner(p.space))) throw new Forbidden('not_space_owner')
    await assertSpaceOwnerEdit(ctx.spaceOwnerCtx(space), space, 'owners', space.owners, p.owners)
  }
  await withImpersonationAudit(
    ctx,
    'space_owners_changed',
    { target_space: p.space, target_space_class: space._class, old: space.owners, new: p.owners },
    async () => {
      await ctx.applyOwnersUpdate(p.space, p.owners)
    }
  )
}

async function setSpaceFlag (ctx: EditCtx, p: FlagEdit, flag: 'private' | 'autoJoin' | 'archived'): Promise<void> {
  await gateWrite(ctx, p.workspace, 'flags')
  const space = await ctx.loadSpace(p.space)
  // Flags are Owner-only — Space-Owner side-channel does not extend here.
  const role = await getEffectiveRole(ctx, p.workspace)
  if (!WRITE_ALLOWED_ROLES.includes(role)) {
    throw new Forbidden(`flag_${flag}_owner_only`)
  }
  const action = flag === 'private' ? 'space_privacy_changed' : flag === 'autoJoin' ? 'space_autojoin_changed' : p.value ? 'space_archived' : 'space_unarchived'
  await withImpersonationAudit(
    ctx,
    action,
    { target_space: p.space, target_space_class: space._class, old: (space as any)[flag], new: p.value },
    async () => {
      await ctx.applyFlagUpdate(p.space, flag, p.value)
    }
  )
}

export async function setSpacePrivacy (ctx: EditCtx, p: FlagEdit): Promise<void> {
  return await setSpaceFlag(ctx, p, 'private')
}
export async function setSpaceAutoJoin (ctx: EditCtx, p: FlagEdit): Promise<void> {
  return await setSpaceFlag(ctx, p, 'autoJoin')
}
export async function setSpaceArchived (ctx: EditCtx, p: FlagEdit): Promise<void> {
  return await setSpaceFlag(ctx, p, 'archived')
}

export interface LastAdminCheck {
  /** Returns the number of Workspace-Owners remaining if the proposed role change were applied. */
  remainingOwnersAfter: (workspace: string, target: string, newRole: string) => Promise<number>
}

export async function setWorkspaceMemberRole (
  ctx: EditCtx & LastAdminCheck,
  p: RoleEdit,
  oldRole: string
): Promise<void> {
  await gateWrite(ctx, p.workspace, 'role')
  if (oldRole === 'OWNER' && p.role !== 'OWNER') {
    const remaining = await ctx.remainingOwnersAfter(p.workspace, p.target, p.role)
    if (remaining <= 0) throw new Forbidden('cannot_demote_last_owner')
  }
  await withImpersonationAudit(
    ctx,
    'role_changed',
    { target_account: p.target, old: { role: oldRole }, new: { role: p.role } },
    async () => {
      await ctx.applyRoleUpdate(p.target, p.role)
    }
  )
}

export { WRITE_ALLOWED_ROLES, ALLOWED_FIELDS_BY_SPACE_OWNER, FORBIDDEN_FIELDS_IN_WAC }
