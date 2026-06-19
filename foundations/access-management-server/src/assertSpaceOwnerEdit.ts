//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Space-Owner edit constraints. Called BEFORE setSpaceMembers /
// setSpaceOwners writes the change.
//

import { Forbidden } from './Forbidden'

export const ALLOWED_FIELDS_BY_SPACE_OWNER = ['members', 'owners'] as const
export const FORBIDDEN_FIELDS_IN_WAC = [
  'type',
  'restricted',
  'autoJoinForRoles',
  '_class'
] as const

export interface SpaceOwnerEditCtx {
  account: { uuid: string }
  workspace: string
  /** True if the caller is the workspace's Owner (not just a Space-Owner). */
  isWorkspaceOwner: boolean
  /** Async lookup: is this UUID currently a member of the workspace? */
  isWorkspaceMember: (workspace: string, uuid: string) => Promise<boolean>
  /** Async write: add UUID to the space.members set in the SAME transaction. */
  addToSpaceMembersInTx: (space: { _id: string; members: string[] }, uuid: string) => Promise<void>
}

export interface SpaceShape {
  _id: string
  members: string[]
  owners: string[]
}

/**
 * Verify the proposed edit against the four constraints:
 *  1. A space-owner cannot remove themselves if they're the last owner.
 *  2. New owners must already be workspace members (no cross-workspace).
 *  3. New owners are auto-added to space.members in the same tx.
 *  4. A space-owner cannot remove another owner via the members field.
 */
export async function assertSpaceOwnerEdit (
  ctx: SpaceOwnerEditCtx,
  space: SpaceShape,
  field: 'members' | 'owners',
  oldValue: string[],
  newValue: string[]
): Promise<void> {
  if (field === 'owners') {
    // Constraint 1
    const isRemovingSelf = oldValue.includes(ctx.account.uuid) && !newValue.includes(ctx.account.uuid)
    if (isRemovingSelf && newValue.length === 0) {
      throw new Forbidden('cannot_remove_self_as_last_owner')
    }

    // Constraint 2
    const newOwners = newValue.filter((uuid) => !oldValue.includes(uuid))
    for (const owner of newOwners) {
      if (!(await ctx.isWorkspaceMember(ctx.workspace, owner))) {
        throw new Forbidden(`new_owner_not_workspace_member:${owner}`)
      }
    }

    // Constraint 3
    for (const owner of newOwners) {
      if (!space.members.includes(owner)) {
        await ctx.addToSpaceMembersInTx(space, owner)
      }
    }
  }

  if (field === 'members' && !ctx.isWorkspaceOwner) {
    // Constraint 4
    const removedMembers = oldValue.filter((uuid) => !newValue.includes(uuid))
    for (const member of removedMembers) {
      if (space.owners.includes(member)) {
        throw new Forbidden(`cannot_remove_owner_via_members_field:${member}`)
      }
    }
  }
}
