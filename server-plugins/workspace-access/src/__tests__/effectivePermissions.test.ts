//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Tests for the Effective Permissions Drilldown endpoint.
//
// The drill-down is a read-only forensics tool that explains WHY a
// given user has (or does not have) access to a given space-level
// resource. It is gated to OWNER + IMPERSONATING_ADMIN only — even
// MAINTAINER cannot use it, because it discloses other members'
// membership lists.
//

import {
  effectivePermissions,
  type EffectivePermissionsBackend,
  type EffectivePermissionsCtx,
  type EffectivePermissionsResult
} from '../endpoints/effectivePermissions'

const userOwner = { uuid: 'u-owner', name: 'Olivia Owner', role: 'OWNER' as const }
const userMaint = { uuid: 'u-maint', name: 'Marvin Maint', role: 'MAINTAINER' as const }
const userPlain = { uuid: 'u-plain', name: 'Pauline Plain', role: 'USER' as const }

function ctx (overrides: Partial<EffectivePermissionsCtx> = {}): EffectivePermissionsCtx {
  return {
    token: { audience: 'workspace', workspace: 'ws1' },
    account: { uuid: 'u-caller' },
    membership: { role: 'OWNER', ownedSpaces: [] },
    isImpersonating: false,
    workspace: 'ws1',
    actorUuid: 'u-caller',
    actorRole: 'workspace_owner',
    ...overrides
  }
}

function makeBackend (overrides: Partial<EffectivePermissionsBackend> = {}): EffectivePermissionsBackend {
  return {
    loadUser: async () => userPlain,
    loadResource: async () => ({
      id: 'space-1',
      class: 'tracker:class:Project',
      name: 'Demo Project',
      private: false,
      archived: false,
      members: [],
      owners: []
    }),
    writeAudit: async () => undefined,
    ...overrides
  }
}

describe('effectivePermissions — auth gates', () => {
  it('rejects when workspace claim mismatch', async () => {
    const c = ctx({ token: { audience: 'workspace', workspace: 'ws1' } })
    await expect(
      effectivePermissions(c, { workspace: 'ws2', userUuid: 'u-plain', resourceId: 'space-1' }, makeBackend())
    ).rejects.toThrow(/workspace mismatch/)
  })

  it('rejects plain USER caller', async () => {
    const c = ctx({ membership: { role: 'USER', ownedSpaces: [] } })
    await expect(
      effectivePermissions(c, { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' }, makeBackend())
    ).rejects.toThrow(/effective_permissions_forbidden/)
  })

  it('rejects GUEST caller', async () => {
    const c = ctx({ membership: { role: 'GUEST', ownedSpaces: [] } })
    await expect(
      effectivePermissions(c, { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' }, makeBackend())
    ).rejects.toThrow(/effective_permissions_forbidden/)
  })

  it('rejects MAINTAINER caller (more restrictive than read endpoints)', async () => {
    const c = ctx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } })
    await expect(
      effectivePermissions(c, { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' }, makeBackend())
    ).rejects.toThrow(/effective_permissions_forbidden/)
  })

  it('rejects INSTANCE_ADMIN_READONLY caller (drill-down requires impersonation)', async () => {
    const c = ctx({
      membership: { role: 'GUEST', ownedSpaces: [] },
      isImpersonating: false,
      isInstanceAdminReadOnly: true
    })
    await expect(
      effectivePermissions(c, { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' }, makeBackend())
    ).rejects.toThrow(/effective_permissions_forbidden/)
  })

  it('allows IMPERSONATING_ADMIN caller', async () => {
    const c = ctx({
      membership: { role: 'GUEST', ownedSpaces: [] },
      isImpersonating: true
    })
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend()
    )
    expect(res.decision).toBeDefined()
  })

  it('allows OWNER caller', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend()
    )
    expect(res.decision).toBeDefined()
  })
})

describe('effectivePermissions — parameter validation', () => {
  it('rejects missing userUuid', async () => {
    const c = ctx()
    await expect(
      effectivePermissions(c, { workspace: 'ws1', userUuid: '', resourceId: 'space-1' }, makeBackend())
    ).rejects.toThrow(/effective_permissions_bad_request/)
  })

  it('rejects missing resourceId', async () => {
    const c = ctx()
    await expect(
      effectivePermissions(c, { workspace: 'ws1', userUuid: 'u-plain', resourceId: '' }, makeBackend())
    ).rejects.toThrow(/effective_permissions_bad_request/)
  })

  it('reports unknown user via backend null', async () => {
    const c = ctx()
    await expect(
      effectivePermissions(
        c,
        { workspace: 'ws1', userUuid: 'u-gone', resourceId: 'space-1' },
        makeBackend({ loadUser: async () => null })
      )
    ).rejects.toThrow(/effective_permissions_user_not_found/)
  })

  it('reports unknown resource via backend null', async () => {
    const c = ctx()
    await expect(
      effectivePermissions(
        c,
        { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-gone' },
        makeBackend({ loadResource: async () => null })
      )
    ).rejects.toThrow(/effective_permissions_resource_not_found/)
  })
})

describe('effectivePermissions — decision logic', () => {
  it('OWNER target user → allow via workspace-role', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-owner', resourceId: 'space-1' },
      makeBackend({ loadUser: async () => userOwner })
    )
    expect(res.decision).toBe('allow')
    expect(res.path[0].step).toBe('workspace-role')
    expect(res.path[0].detail).toMatch(/OWNER/)
    expect(res.user.role).toBe('OWNER')
  })

  it('MAINTAINER target user → allow via workspace-role', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-maint', resourceId: 'space-1' },
      makeBackend({ loadUser: async () => userMaint })
    )
    expect(res.decision).toBe('allow')
    expect(res.path[0].step).toBe('workspace-role')
    expect(res.path[0].detail).toMatch(/MAINTAINER/)
  })

  it('plain USER + public non-archived space → allow via space-public', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend()
    )
    expect(res.decision).toBe('allow')
    expect(res.path.map((p) => p.step)).toEqual(['space-public'])
  })

  it('plain USER in private space members list → allow via space-member', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend({
        loadResource: async () => ({
          id: 'space-1',
          class: 'tracker:class:Project',
          name: 'Demo Project',
          private: true,
          archived: false,
          members: ['u-other', 'u-plain'],
          owners: []
        })
      })
    )
    expect(res.decision).toBe('allow')
    expect(res.path[res.path.length - 1].step).toBe('space-member')
  })

  it('plain USER listed in space owners → allow via space-owner', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend({
        loadResource: async () => ({
          id: 'space-1',
          class: 'tracker:class:Project',
          name: 'Demo Project',
          private: true,
          archived: false,
          members: [],
          owners: ['u-plain']
        })
      })
    )
    expect(res.decision).toBe('allow')
    expect(res.path[res.path.length - 1].step).toBe('space-owner')
  })

  it('plain USER not in private space → deny no-match', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend({
        loadResource: async () => ({
          id: 'space-1',
          class: 'tracker:class:Project',
          name: 'Demo Project',
          private: true,
          archived: false,
          members: ['u-other'],
          owners: ['u-someone-else']
        })
      })
    )
    expect(res.decision).toBe('deny')
    expect(res.path[res.path.length - 1].step).toBe('no-match')
  })

  it('plain USER + archived space → deny archived-for-non-admin', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend({
        loadResource: async () => ({
          id: 'space-1',
          class: 'tracker:class:Project',
          name: 'Demo Project',
          private: false,
          archived: true,
          members: ['u-plain'],
          owners: []
        })
      })
    )
    expect(res.decision).toBe('deny')
    expect(res.path[res.path.length - 1].step).toBe('archived')
  })

  it('OWNER target user on archived space → still allow (admin bypass)', async () => {
    const c = ctx()
    const res = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-owner', resourceId: 'space-1' },
      makeBackend({
        loadUser: async () => userOwner,
        loadResource: async () => ({
          id: 'space-1',
          class: 'tracker:class:Project',
          name: 'Demo Project',
          private: true,
          archived: true,
          members: [],
          owners: []
        })
      })
    )
    expect(res.decision).toBe('allow')
    expect(res.path[0].step).toBe('workspace-role')
  })

  it('exposes resource metadata in response', async () => {
    const c = ctx()
    const res: EffectivePermissionsResult = await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend()
    )
    expect(res.resource).toEqual({
      id: 'space-1',
      class: 'tracker:class:Project',
      name: 'Demo Project',
      private: false,
      archived: false
    })
    expect(res.user).toEqual({ uuid: 'u-plain', name: 'Pauline Plain', role: 'USER' })
  })
})

describe('effectivePermissions — audit emission', () => {
  it('emits effective_permissions_viewed audit on success', async () => {
    const audited: any[] = []
    const c = ctx()
    await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend({ writeAudit: async (e) => { audited.push(e) } })
    )
    expect(audited).toHaveLength(1)
    expect(audited[0].action).toBe('effective_permissions_viewed')
    expect(audited[0].actor).toBe('u-caller')
    expect(audited[0].target_account).toBe('u-plain')
    expect(audited[0].target_space).toBe('space-1')
    expect(audited[0].metadata).toEqual({ decision: 'allow' })
  })

  it('emits audit with decision=deny when caller drills into a no-match', async () => {
    const audited: any[] = []
    const c = ctx()
    await effectivePermissions(
      c,
      { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
      makeBackend({
        loadResource: async () => ({
          id: 'space-1',
          class: 'tracker:class:Project',
          name: 'Demo Project',
          private: true,
          archived: false,
          members: [],
          owners: []
        }),
        writeAudit: async (e) => { audited.push(e) }
      })
    )
    expect(audited[0].metadata).toEqual({ decision: 'deny' })
  })

  it('does NOT emit audit when caller gate rejects', async () => {
    const audited: any[] = []
    const c = ctx({ membership: { role: 'USER', ownedSpaces: [] } })
    await expect(
      effectivePermissions(
        c,
        { workspace: 'ws1', userUuid: 'u-plain', resourceId: 'space-1' },
        makeBackend({ writeAudit: async (e) => { audited.push(e) } })
      )
    ).rejects.toThrow()
    expect(audited).toHaveLength(0)
  })

  it('does NOT emit audit when params are invalid', async () => {
    const audited: any[] = []
    const c = ctx()
    await expect(
      effectivePermissions(
        c,
        { workspace: 'ws1', userUuid: '', resourceId: 'space-1' },
        makeBackend({ writeAudit: async (e) => { audited.push(e) } })
      )
    ).rejects.toThrow()
    expect(audited).toHaveLength(0)
  })
})
