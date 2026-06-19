import { withImpersonationAudit, type ImpersonationCtx } from '../withImpersonationAudit'

function fakeTx () {
  const wsCalls: any[] = []
  const adminCalls: any[] = []
  return {
    tx: {
      begin: async <T>(fn: (txCtx: any) => Promise<T>): Promise<T> => {
        return await fn({
          ws: async (e: any) => {
            wsCalls.push(e)
          },
          admin: async (e: any) => {
            adminCalls.push(e)
          }
        })
      }
    },
    wsCalls,
    adminCalls
  }
}

describe('withImpersonationAudit', () => {
  it('writes only workspace audit when not impersonating', async () => {
    const { tx, wsCalls, adminCalls } = fakeTx()
    const ctx: ImpersonationCtx = {
      tx,
      workspace: 'ws1',
      actorUuid: 'u1',
      actorRole: 'workspace_owner',
      isImpersonating: false
    }
    const result = await withImpersonationAudit(ctx, 'space_archived', { target_space: 's1' }, async () => 'ok')
    expect(result).toBe('ok')
    expect(wsCalls.length).toBe(1)
    expect(wsCalls[0].action).toBe('space_archived')
    expect(wsCalls[0].metadata.impersonation_ref).toBeUndefined()
    expect(adminCalls.length).toBe(0)
  })

  it('writes to both audit tables when impersonating', async () => {
    const { tx, wsCalls, adminCalls } = fakeTx()
    const ctx: ImpersonationCtx = {
      tx,
      workspace: 'ws1',
      actorUuid: 'u1',
      actorRole: 'instance_admin_impersonation',
      isImpersonating: true,
      impersonationRefId: 'ref1',
      instanceAdminUuid: 'admin1'
    }
    await withImpersonationAudit(ctx, 'space_archived', { target_space: 's1' }, async () => undefined)
    expect(wsCalls.length).toBe(1)
    expect(adminCalls.length).toBe(1)
    expect(adminCalls[0].action).toBe('wac_space_archived')
    expect(adminCalls[0].metadata.impersonation_ref).toBe('ref1')
    expect(wsCalls[0].metadata.impersonation_ref).toBe('ref1')
  })

  it('propagates exec failure (no audit committed by caller)', async () => {
    const { tx } = fakeTx()
    const ctx: ImpersonationCtx = {
      tx,
      workspace: 'ws1',
      actorUuid: 'u1',
      actorRole: 'workspace_owner',
      isImpersonating: false
    }
    await expect(
      withImpersonationAudit(ctx, 'space_archived', {}, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })
})
