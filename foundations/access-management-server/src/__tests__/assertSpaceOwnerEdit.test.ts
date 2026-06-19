import { assertSpaceOwnerEdit, type SpaceOwnerEditCtx, type SpaceShape } from '../assertSpaceOwnerEdit'

function ctx (overrides: Partial<SpaceOwnerEditCtx> = {}): SpaceOwnerEditCtx & { addedMembers: string[] } {
  const addedMembers: string[] = []
  return {
    account: { uuid: 'u1' },
    workspace: 'ws1',
    isWorkspaceOwner: false,
    isWorkspaceMember: async () => true,
    addToSpaceMembersInTx: async (_space, uuid) => {
      addedMembers.push(uuid)
    },
    addedMembers,
    ...overrides
  }
}

const space = (overrides: Partial<SpaceShape> = {}): SpaceShape => ({
  _id: 's1',
  members: ['u1', 'u2'],
  owners: ['u1'],
  ...overrides
})

describe('assertSpaceOwnerEdit — owners field', () => {
  it('rejects last-owner self-removal', async () => {
    await expect(
      assertSpaceOwnerEdit(ctx(), space({ owners: ['u1'] }), 'owners', ['u1'], [])
    ).rejects.toThrow(/cannot_remove_self_as_last_owner/)
  })

  it('allows owner self-removal when other owners remain', async () => {
    await expect(
      assertSpaceOwnerEdit(ctx(), space({ owners: ['u1', 'u2'] }), 'owners', ['u1', 'u2'], ['u2'])
    ).resolves.toBeUndefined()
  })

  it('rejects new owner who is not a workspace member', async () => {
    await expect(
      assertSpaceOwnerEdit(
        ctx({ isWorkspaceMember: async () => false }),
        space(),
        'owners',
        ['u1'],
        ['u1', 'u3']
      )
    ).rejects.toThrow(/new_owner_not_workspace_member:u3/)
  })

  it('auto-adds a new owner to space.members in the same transaction', async () => {
    const c = ctx()
    await assertSpaceOwnerEdit(c, space({ members: ['u1'], owners: ['u1'] }), 'owners', ['u1'], ['u1', 'u4'])
    expect(c.addedMembers).toEqual(['u4'])
  })

  it('does not double-add when the new owner already is a member', async () => {
    const c = ctx()
    await assertSpaceOwnerEdit(c, space({ members: ['u1', 'u2'], owners: ['u1'] }), 'owners', ['u1'], ['u1', 'u2'])
    expect(c.addedMembers).toEqual([])
  })
})

describe('assertSpaceOwnerEdit — members field', () => {
  it('rejects when a space-owner tries to remove another owner via members', async () => {
    await expect(
      assertSpaceOwnerEdit(
        ctx({ isWorkspaceOwner: false }),
        space({ members: ['u1', 'u2'], owners: ['u1', 'u2'] }),
        'members',
        ['u1', 'u2'],
        ['u1']
      )
    ).rejects.toThrow(/cannot_remove_owner_via_members_field:u2/)
  })

  it('allows workspace owner to remove an owner via members', async () => {
    await expect(
      assertSpaceOwnerEdit(
        ctx({ isWorkspaceOwner: true }),
        space({ members: ['u1', 'u2'], owners: ['u1', 'u2'] }),
        'members',
        ['u1', 'u2'],
        ['u1']
      )
    ).resolves.toBeUndefined()
  })

  it('allows removing a non-owner from members', async () => {
    await expect(
      assertSpaceOwnerEdit(
        ctx({ isWorkspaceOwner: false }),
        space({ members: ['u1', 'u2', 'u3'], owners: ['u1'] }),
        'members',
        ['u1', 'u2', 'u3'],
        ['u1', 'u2']
      )
    ).resolves.toBeUndefined()
  })
})
