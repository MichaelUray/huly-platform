import {
  setSpaceMembers,
  setSpaceOwners,
  setSpacePrivacy,
  setWorkspaceMemberRole,
  type EditCtx,
  type LastAdminCheck
} from '../endpoints/editEndpoints'
import type { SpaceShape } from '@hcengineering/access-management-server'

function makeCtx (overrides: any = {}): EditCtx & LastAdminCheck {
  const audited: any[] = []
  const adminCalls: any[] = []
  const base: any = {
    token: { audience: 'workspace', workspace: 'ws1' },
    account: { uuid: 'u1' },
    membership: { role: 'OWNER', ownedSpaces: [] },
    isImpersonating: false,
    workspace: 'ws1',
    actorUuid: 'u1',
    actorRole: 'workspace_owner',
    tx: {
      begin: async <T>(fn: (txCtx: any) => Promise<T>): Promise<T> => {
        return await fn({
          ws: async (e: any) => audited.push(e),
          admin: async (e: any) => adminCalls.push(e)
        })
      }
    },
    audited,
    adminCalls,
    isSpaceOwner: async () => false,
    loadSpace: async (id: string): Promise<SpaceShape & { _class: string }> => ({
      _id: id,
      _class: 'tracker.class.Project',
      members: ['u1', 'u2'],
      owners: ['u1']
    }),
    applyMembersUpdate: jest.fn().mockResolvedValue(undefined),
    applyOwnersUpdate: jest.fn().mockResolvedValue(undefined),
    applyFlagUpdate: jest.fn().mockResolvedValue(undefined),
    applyRoleUpdate: jest.fn().mockResolvedValue(undefined),
    spaceOwnerCtx: (space: any) => ({
      account: { uuid: 'u1' },
      workspace: 'ws1',
      isWorkspaceOwner: false,
      isWorkspaceMember: async () => true,
      addToSpaceMembersInTx: async () => undefined
    }),
    remainingOwnersAfter: async () => 1
  }
  return { ...base, ...overrides }
}

describe('setSpaceMembers', () => {
  it('Owner can change members and writes audit', async () => {
    const ctx = makeCtx()
    await setSpaceMembers(ctx, { workspace: 'ws1', space: 's1', members: ['u1', 'u3'] })
    expect(ctx.applyMembersUpdate).toHaveBeenCalledWith('s1', ['u1', 'u3'])
    expect((ctx as any).audited[0].action).toBe('space_members_changed')
  })

  it('Maintainer is rejected', async () => {
    const ctx = makeCtx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } })
    await expect(
      setSpaceMembers(ctx, { workspace: 'ws1', space: 's1', members: ['u1'] })
    ).rejects.toThrow(/write_not_allowed/)
  })

  it('Space-Owner allowed to edit own space members', async () => {
    const ctx = makeCtx({
      membership: { role: 'USER', ownedSpaces: ['s1'] },
      isSpaceOwner: async () => true
    })
    await setSpaceMembers(ctx, { workspace: 'ws1', space: 's1', members: ['u1', 'u3'] })
    expect(ctx.applyMembersUpdate).toHaveBeenCalled()
  })

  it('Space-Owner rejected when not actually owner of THIS space', async () => {
    const ctx = makeCtx({
      membership: { role: 'USER', ownedSpaces: ['s2'] },
      isSpaceOwner: async () => false
    })
    await expect(
      setSpaceMembers(ctx, { workspace: 'ws1', space: 's1', members: ['u1'] })
    ).rejects.toThrow(/not_space_owner/)
  })
})

describe('setSpaceOwners', () => {
  it('Owner can change owners', async () => {
    const ctx = makeCtx()
    await setSpaceOwners(ctx, { workspace: 'ws1', space: 's1', owners: ['u1', 'u3'] })
    expect(ctx.applyOwnersUpdate).toHaveBeenCalledWith('s1', ['u1', 'u3'])
  })

  it('Space-Owner rejected if removing self as last owner', async () => {
    const ctx = makeCtx({
      membership: { role: 'USER', ownedSpaces: ['s1'] },
      isSpaceOwner: async () => true,
      loadSpace: async () => ({ _id: 's1', _class: 'tracker.class.Project', members: ['u1', 'u2'], owners: ['u1'] })
    })
    await expect(
      setSpaceOwners(ctx, { workspace: 'ws1', space: 's1', owners: [] })
    ).rejects.toThrow(/cannot_remove_self_as_last_owner/)
  })
})

describe('setSpacePrivacy', () => {
  it('Space-Owner is rejected (flag is Owner-only)', async () => {
    const ctx = makeCtx({
      membership: { role: 'USER', ownedSpaces: ['s1'] },
      isSpaceOwner: async () => true
    })
    // Space-Owner side-channel only applies to members/owners; flags are
    // workspace-wide and require Workspace-Owner.
    await expect(
      setSpacePrivacy(ctx, { workspace: 'ws1', space: 's1', value: true })
    ).rejects.toThrow(/write_not_allowed/)
  })

  it('Owner can toggle privacy', async () => {
    const ctx = makeCtx()
    await setSpacePrivacy(ctx, { workspace: 'ws1', space: 's1', value: true })
    expect(ctx.applyFlagUpdate).toHaveBeenCalledWith('s1', 'private', true)
  })
})

describe('setWorkspaceMemberRole', () => {
  it('rejects demoting the last Owner', async () => {
    const ctx = makeCtx({ remainingOwnersAfter: async () => 0 })
    await expect(
      setWorkspaceMemberRole(ctx, { workspace: 'ws1', target: 'u1', role: 'USER' }, 'OWNER')
    ).rejects.toThrow(/cannot_demote_last_owner/)
  })

  it('allows demoting an Owner when others remain', async () => {
    const ctx = makeCtx({ remainingOwnersAfter: async () => 2 })
    await setWorkspaceMemberRole(ctx, { workspace: 'ws1', target: 'u2', role: 'USER' }, 'OWNER')
    expect(ctx.applyRoleUpdate).toHaveBeenCalledWith('u2', 'USER')
  })
})
