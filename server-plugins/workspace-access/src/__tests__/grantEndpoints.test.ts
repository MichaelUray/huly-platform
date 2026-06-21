import { listGrants, countGrants, revokeGrant, setGrantExpiry, type GrantBackend, type GrantCtx, type GrantRow } from '../endpoints/grantEndpoints'

const sampleGrant: GrantRow = {
  recipientUuid: 'u2',
  recipientName: 'Bob',
  granterUuid: 'u1',
  granterName: 'Alice',
  resourceId: 'r1',
  resourceClass: 'tracker.class.Issue',
  resourceTitle: 'Investigate latency',
  grantedAt: '2026-06-19T08:00:00Z',
  expiresAt: null
}

function ctx (overrides: any = {}): GrantCtx & { isGrantCreator?: any } {
  return {
    token: { audience: 'workspace', workspace: 'ws1' },
    account: { uuid: 'u1' },
    membership: { role: 'OWNER', ownedSpaces: [] },
    isImpersonating: false,
    workspace: 'ws1',
    actorUuid: 'u1',
    actorRole: 'workspace_owner',
    tx: {
      begin: async <T>(fn: (txCtx: any) => Promise<T>) =>
        await fn({ ws: async () => undefined, admin: async () => undefined, domain: { kind: 'fake-tx' } })
    },
    ...overrides
  } as any
}

function makeBackend (overrides: Partial<GrantBackend> = {}): GrantBackend {
  return {
    list: async () => ({ items: [sampleGrant], cursor: null }),
    count: async () => 1,
    resolveResourceClass: async () => 'tracker.class.Issue',
    revoke: async () => ({ resourceClass: 'tracker.class.Issue' }),
    ...overrides
  }
}

describe('listGrants', () => {
  it('rejects when workspace mismatch', async () => {
    const c = ctx({ token: { audience: 'workspace', workspace: 'ws1' } })
    await expect(listGrants(c, { workspace: 'ws2' }, makeBackend())).rejects.toThrow(/workspace mismatch/)
  })

  it('allows Maintainer + Owner read', async () => {
    const c = ctx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } })
    const res = await listGrants(c, { workspace: 'ws1' }, makeBackend())
    expect(res.items.length).toBe(1)
  })

  it('rejects plain User from read', async () => {
    const c = ctx({ membership: { role: 'USER', ownedSpaces: [] } })
    await expect(listGrants(c, { workspace: 'ws1' }, makeBackend())).rejects.toThrow(/read_not_allowed/)
  })
})

describe('countGrants', () => {
  it('returns the backend count', async () => {
    const c = ctx()
    expect(await countGrants(c, 'ws1', makeBackend({ count: async () => 42 }))).toBe(42)
  })
})

describe('revokeGrant', () => {
  it('Owner can revoke any grant', async () => {
    const revokeFn = jest.fn().mockResolvedValue({ resourceClass: 'tracker.class.Issue' })
    const c = ctx()
    await revokeGrant(c, { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1' }, makeBackend({ revoke: revokeFn }))
    // Revoke is now called with the tx-domain handle as the first arg
    // so the change commits atomically with the audit row.
    expect(revokeFn).toHaveBeenCalledWith({ kind: 'fake-tx' }, 'ws1', 'u2', 'r1')
  })

  it('records target_space_class in audit metadata when resolving resource', async () => {
    const audited: any[] = []
    const c = ctx({
      tx: {
        begin: async <T>(fn: (txCtx: any) => Promise<T>) =>
          await fn({
            ws: async (e: any) => audited.push(e),
            admin: async () => undefined,
            domain: { kind: 'fake-tx' }
          })
      }
    })
    await revokeGrant(
      c,
      { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1' },
      makeBackend({ resolveResourceClass: async () => 'document.class.Document' })
    )
    expect(audited[0].action).toBe('grant_revoked')
    expect(audited[0].target_space_class).toBe('document.class.Document')
  })

  it('rejects with grant_not_found when resourceClass lookup returns null', async () => {
    const c = ctx()
    await expect(
      revokeGrant(
        c,
        { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'gone' },
        makeBackend({ resolveResourceClass: async () => null })
      )
    ).rejects.toThrow(/grant_not_found/)
  })

  it('non-Owner is rejected unless they are the grant creator', async () => {
    const c = ctx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } })
    await expect(
      revokeGrant(c, { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1' }, makeBackend())
    ).rejects.toThrow(/grant_revoke_not_allowed/)
  })

  it('grant creator can revoke own grants without Workspace-Owner role', async () => {
    const c = ctx({
      membership: { role: 'USER', ownedSpaces: [] },
      isGrantCreator: async () => true
    })
    await expect(
      revokeGrant(c, { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1' }, makeBackend())
    ).resolves.toBeUndefined()
  })

  it('rejects when token workspace mismatch', async () => {
    const c = ctx()
    await expect(
      revokeGrant(c, { workspace: 'ws2', recipientUuid: 'u2', resourceId: 'r1' }, makeBackend())
    ).rejects.toThrow(/workspace mismatch/)
  })

  it('exposes expiresAt on returned grants', async () => {
    const expiring: GrantRow = { ...sampleGrant, expiresAt: '2027-01-01T00:00:00Z' }
    const c = ctx()
    const res = await listGrants(c, { workspace: 'ws1' }, makeBackend({
      list: async () => ({ items: [expiring], cursor: null })
    }))
    expect(res.items[0].expiresAt).toBe('2027-01-01T00:00:00Z')
  })
})

describe('setGrantExpiry', () => {
  const FAR_FUTURE = '2099-01-01T00:00:00Z'
  const PAST = '2000-01-01T00:00:00Z'
  // Deterministic clock for the in-past / no-op tests.
  const fixedNow = (): number => Date.parse('2026-06-21T00:00:00Z')

  function expiryBackend (overrides: Partial<GrantBackend> = {}): GrantBackend {
    return {
      ...makeBackend(),
      resolveExpiresAt: async () => null,
      setExpiresAt: async () => undefined,
      ...overrides
    }
  }

  it('rejects when token workspace mismatch', async () => {
    const c = ctx()
    await expect(
      setGrantExpiry(
        c,
        { workspace: 'ws2', recipientUuid: 'u2', resourceId: 'r1', expiresAt: FAR_FUTURE },
        expiryBackend(),
        fixedNow
      )
    ).rejects.toThrow(/workspace mismatch/)
  })

  it('Owner can set a future expiry, audit event includes old + new', async () => {
    const audited: any[] = []
    const setCalls: any[] = []
    const c = ctx({
      tx: {
        begin: async <T>(fn: (txCtx: any) => Promise<T>) =>
          await fn({
            ws: async (e: any) => audited.push(e),
            admin: async () => undefined,
            domain: { kind: 'tx' }
          })
      }
    })
    await setGrantExpiry(
      c,
      { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: FAR_FUTURE },
      expiryBackend({
        setExpiresAt: async (d, ws, r, res, exp) => {
          setCalls.push({ d, ws, r, res, exp })
        }
      }),
      fixedNow
    )
    expect(setCalls).toEqual([{ d: { kind: 'tx' }, ws: 'ws1', r: 'u2', res: 'r1', exp: FAR_FUTURE }])
    expect(audited[0].action).toBe('grant_expiry_set')
    expect(audited[0].target_account).toBe('u2')
    expect(audited[0].target_space).toBe('r1')
    expect(audited[0].target_space_class).toBe('tracker.class.Issue')
    expect(audited[0].old_value).toEqual({ expiresAt: null })
    expect(audited[0].new_value).toEqual({ expiresAt: FAR_FUTURE })
  })

  it('clearing expiry (null) on an expiring grant is allowed and persisted', async () => {
    const setCalls: any[] = []
    const c = ctx()
    await setGrantExpiry(
      c,
      { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: null },
      expiryBackend({
        resolveExpiresAt: async () => FAR_FUTURE,
        setExpiresAt: async (_d, _ws, _r, _res, exp) => {
          setCalls.push(exp)
        }
      }),
      fixedNow
    )
    expect(setCalls).toEqual([null])
  })

  it('rejects expiry in the past', async () => {
    const c = ctx()
    await expect(
      setGrantExpiry(
        c,
        { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: PAST },
        expiryBackend(),
        fixedNow
      )
    ).rejects.toThrow(/grant_expiry_in_past/)
  })

  it('rejects malformed ISO timestamps', async () => {
    const c = ctx()
    await expect(
      setGrantExpiry(
        c,
        { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: 'tomorrow' as any },
        expiryBackend(),
        fixedNow
      )
    ).rejects.toThrow(/grant_expiry_invalid_format/)
  })

  it('rejects USER role (not Owner)', async () => {
    const c = ctx({ membership: { role: 'USER', ownedSpaces: [] } })
    await expect(
      setGrantExpiry(
        c,
        { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: FAR_FUTURE },
        expiryBackend(),
        fixedNow
      )
    ).rejects.toThrow(/grant_expiry_not_allowed/)
  })

  it('IMPERSONATING_ADMIN can set expiry', async () => {
    const setCalls: any[] = []
    const c = ctx({ isImpersonating: true })
    await setGrantExpiry(
      c,
      { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: FAR_FUTURE },
      expiryBackend({
        setExpiresAt: async (_d, _ws, _r, _res, exp) => {
          setCalls.push(exp)
        }
      }),
      fixedNow
    )
    expect(setCalls).toEqual([FAR_FUTURE])
  })

  it('grant_not_found when collaborator row is missing', async () => {
    const c = ctx()
    await expect(
      setGrantExpiry(
        c,
        { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'gone', expiresAt: FAR_FUTURE },
        expiryBackend({ resolveExpiresAt: async () => undefined }),
        fixedNow
      )
    ).rejects.toThrow(/grant_not_found/)
  })

  it('no-op when old == new (does not emit audit row)', async () => {
    const audited: any[] = []
    const setCalls: any[] = []
    const c = ctx({
      tx: {
        begin: async <T>(fn: (txCtx: any) => Promise<T>) =>
          await fn({
            ws: async (e: any) => audited.push(e),
            admin: async () => undefined,
            domain: { kind: 'tx' }
          })
      }
    })
    await setGrantExpiry(
      c,
      { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: FAR_FUTURE },
      expiryBackend({
        resolveExpiresAt: async () => FAR_FUTURE,
        setExpiresAt: async (_d, _ws, _r, _res, exp) => {
          setCalls.push(exp)
        }
      }),
      fixedNow
    )
    expect(audited).toEqual([])
    expect(setCalls).toEqual([])
  })

  it('grant_expiry_not_implemented when backend lacks the hook', async () => {
    const c = ctx()
    await expect(
      setGrantExpiry(
        c,
        { workspace: 'ws1', recipientUuid: 'u2', resourceId: 'r1', expiresAt: FAR_FUTURE },
        makeBackend(),
        fixedNow
      )
    ).rejects.toThrow(/grant_expiry_not_implemented/)
  })
})
