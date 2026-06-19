import {
  startImpersonation,
  endImpersonation,
  assertImpersonationToken,
  TTL_SECONDS,
  PER_ADMIN_HOURLY_LIMIT,
  PER_WORKSPACE_HOURLY_LIMIT,
  type ImpersonationDeps,
  type JwtPayload
} from '../impersonation'

function deps (overrides: Partial<ImpersonationDeps> = {}, signed: { [token: string]: JwtPayload } = {}): ImpersonationDeps & { signed: typeof signed, audit: { write: jest.Mock } } {
  const auditWrite = jest.fn()
  let counter = 0
  const base: ImpersonationDeps = {
    jwt: {
      sign: (payload) => {
        const token = `t${counter++}`
        signed[token] = { ...(payload as JwtPayload), iat: payload.iat ?? 0 }
        return token
      },
      verify: (token) => signed[token] ?? null
    },
    rate: { check: async () => true },
    revocation: {
      revoke: async () => undefined,
      isRevoked: async () => false
    },
    audit: { write: auditWrite },
    uuid: (() => { let n = 0; return () => `u${n++}` })(),
    now: () => 1000
  }
  return { ...base, ...overrides, signed, audit: { write: auditWrite } as any }
}

describe('startImpersonation', () => {
  it('mints a 30-min token with all 8 required claims', async () => {
    const d = deps()
    const res = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1', 'support ticket #42')
    expect(res.exp - 1000).toBe(TTL_SECONDS)
    const decoded = d.jwt.verify(res.impersonationToken) as JwtPayload
    expect(decoded.jti).toBe(res.jti)
    expect(decoded.workspace).toBe('ws1')
    expect(decoded.audience).toBe('wac')
    expect(decoded.extra.impersonation).toBe(true)
    expect(decoded.extra.impersonation_ref).toBe(res.impersonationRefId)
    expect(decoded.extra.actor_admin).toBe('admin1')
    expect(d.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'impersonation_started',
      actor: 'admin1',
      target_workspace: 'ws1'
    }))
  })

  it('enforces per-admin hourly limit', async () => {
    const d = deps({ rate: { check: async (k) => !k.startsWith('imp:admin:') } })
    await expect(startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')).rejects.toThrow(/rate_limit_admin/)
  })

  it('enforces per-workspace hourly limit', async () => {
    const d = deps({ rate: { check: async (k) => !k.startsWith('imp:workspace:') } })
    await expect(startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')).rejects.toThrow(/rate_limit_workspace/)
  })
})

describe('assertImpersonationToken — claim checks', () => {
  it('rejects unknown token', async () => {
    const d = deps()
    await expect(assertImpersonationToken(d, 'garbage', 'ws1')).rejects.toThrow(/invalid_token/)
  })

  it('rejects wrong audience', async () => {
    const d = deps()
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    d.signed[start.impersonationToken].audience = 'admin'
    await expect(assertImpersonationToken(d, start.impersonationToken, 'ws1')).rejects.toThrow(/wrong_audience/)
  })

  it('rejects expired token', async () => {
    let t = 1000
    const d = deps({ now: () => t })
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    // Advance time past the TTL.
    t = start.exp + 1
    await expect(assertImpersonationToken(d, start.impersonationToken, 'ws1')).rejects.toThrow(/token_expired/)
  })

  it('rejects + audits IDOR (workspace mismatch)', async () => {
    const d = deps()
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    await expect(assertImpersonationToken(d, start.impersonationToken, 'ws2')).rejects.toThrow(/workspace_mismatch/)
    expect(d.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'impersonation_idor_attempt'
    }))
  })

  it('rejects + audits revoked replay', async () => {
    let revoked = false
    const d = deps({
      revocation: { revoke: async () => { revoked = true }, isRevoked: async () => revoked }
    })
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    await endImpersonation(d, start.impersonationToken)
    await expect(assertImpersonationToken(d, start.impersonationToken, 'ws1')).rejects.toThrow(/token_revoked/)
    expect(d.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'impersonation_replay_attempt'
    }))
  })

  it('accepts a fresh, in-bounds token', async () => {
    const d = deps()
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    const v = await assertImpersonationToken(d, start.impersonationToken, 'ws1')
    expect(v.workspace).toBe('ws1')
    expect(v.actorAdmin).toBe('admin1')
    expect(v.impersonationRef).toBe(start.impersonationRefId)
  })
})

describe('endImpersonation', () => {
  it('audits ended + revokes + disconnects WS sockets', async () => {
    const disconnect = jest.fn()
    const d = deps({ disconnectWebSocketsByToken: disconnect })
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    await endImpersonation(d, start.impersonationToken)
    expect(d.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'impersonation_ended'
    }))
    expect(disconnect).toHaveBeenCalledWith(start.jti)
  })

  it('passes REMAINING TTL (not absolute exp) to revocation.revoke', async () => {
    let t = 1000
    const revokeSpy = jest.fn()
    const d = deps({
      now: () => t,
      revocation: { revoke: revokeSpy, isRevoked: async () => false }
    })
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    // Advance time by 5 minutes; remaining TTL should be 25 min = 1500s.
    t = 1000 + 5 * 60
    await endImpersonation(d, start.impersonationToken)
    const [jti, ttl] = revokeSpy.mock.calls[0]
    expect(jti).toBe(start.jti)
    expect(ttl).toBe(25 * 60)
    // And not the absolute exp.
    expect(ttl).not.toBe(start.exp)
  })

  it('clamps remaining TTL to >=0 when token already expired at end-time', async () => {
    let t = 1000
    const revokeSpy = jest.fn()
    const d = deps({
      now: () => t,
      revocation: { revoke: revokeSpy, isRevoked: async () => false }
    })
    const start = await startImpersonation(d, { admin: { uuid: 'admin1' } }, 'ws1')
    t = start.exp + 100
    await endImpersonation(d, start.impersonationToken)
    const [, ttl] = revokeSpy.mock.calls[0]
    expect(ttl).toBe(0)
  })
})

describe('exported constants', () => {
  it('limits match spec', () => {
    expect(TTL_SECONDS).toBe(30 * 60)
    expect(PER_ADMIN_HOURLY_LIMIT).toBe(10)
    expect(PER_WORKSPACE_HOURLY_LIMIT).toBe(5)
  })
})
