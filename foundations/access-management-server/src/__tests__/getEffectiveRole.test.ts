import { getEffectiveRole, READ_ALLOWED_ROLES, WRITE_ALLOWED_ROLES } from '../getEffectiveRole'
import type { EffectiveRole, RoleCtx } from '../getEffectiveRole'

const baseCtx = (overrides: Partial<RoleCtx> = {}): RoleCtx => ({
  account: { uuid: 'u1' },
  membership: { role: 'USER', ownedSpaces: [] },
  isImpersonating: false,
  ...overrides
})

describe('getEffectiveRole', () => {
  it('returns OWNER for workspace owner', async () => {
    const role: EffectiveRole = await getEffectiveRole(baseCtx({ membership: { role: 'OWNER', ownedSpaces: [] } }), 'ws')
    expect(role).toBe('OWNER')
  })

  it('returns MAINTAINER for plain maintainer', async () => {
    const role = await getEffectiveRole(baseCtx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } }), 'ws')
    expect(role).toBe('MAINTAINER')
  })

  it('promotes Maintainer+SpaceOwner to MAINTAINER_PLUS_SPACE_OWNER', async () => {
    const role = await getEffectiveRole(
      baseCtx({ membership: { role: 'MAINTAINER', ownedSpaces: ['s1'] } }),
      'ws'
    )
    expect(role).toBe('MAINTAINER_PLUS_SPACE_OWNER')
  })

  it('returns SPACE_OWNER_SCOPED for User+SpaceOwner', async () => {
    const role = await getEffectiveRole(baseCtx({ membership: { role: 'USER', ownedSpaces: ['s1'] } }), 'ws')
    expect(role).toBe('SPACE_OWNER_SCOPED')
  })

  it('returns USER_SELF_SCOPED for plain User', async () => {
    const role = await getEffectiveRole(baseCtx(), 'ws')
    expect(role).toBe('USER_SELF_SCOPED')
  })

  it('returns GUEST for guest accounts', async () => {
    const role = await getEffectiveRole(baseCtx({ membership: { role: 'GUEST', ownedSpaces: [] } }), 'ws')
    expect(role).toBe('GUEST')
  })

  it('returns IMPERSONATING_ADMIN when isImpersonating', async () => {
    const role = await getEffectiveRole(baseCtx({ isImpersonating: true }), 'ws')
    expect(role).toBe('IMPERSONATING_ADMIN')
  })
})

describe('role gate sets', () => {
  it('MAINTAINER is NOT in WRITE_ALLOWED_ROLES', () => {
    expect(WRITE_ALLOWED_ROLES.includes('MAINTAINER')).toBe(false)
  })
  it('OWNER is in both READ and WRITE allowed sets', () => {
    expect(READ_ALLOWED_ROLES.includes('OWNER')).toBe(true)
    expect(WRITE_ALLOWED_ROLES.includes('OWNER')).toBe(true)
  })
  it('IMPERSONATING_ADMIN is in WRITE_ALLOWED_ROLES', () => {
    expect(WRITE_ALLOWED_ROLES.includes('IMPERSONATING_ADMIN')).toBe(true)
  })
  it('USER_SELF_SCOPED is not in READ_ALLOWED_ROLES (read is gated workspace-wide)', () => {
    expect(READ_ALLOWED_ROLES.includes('USER_SELF_SCOPED')).toBe(false)
  })
})
