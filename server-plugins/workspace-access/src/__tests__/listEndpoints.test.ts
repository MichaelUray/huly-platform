import {
  listWorkspaceMembers,
  listWorkspaceSpaces,
  listAuditLog,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  type ListEndpointCtx,
  type ListBackend
} from '../endpoints/listEndpoints'

function ctx (overrides: Partial<ListEndpointCtx> = {}): ListEndpointCtx {
  return {
    token: { audience: 'workspace', workspace: 'ws1' },
    account: { uuid: 'u1' },
    membership: { role: 'OWNER', ownedSpaces: [] },
    isImpersonating: false,
    ...overrides
  }
}

function fakeBackend<T> (items: T[]): ListBackend<T> {
  return {
    query: async (_ws, opts) => ({
      items: items.slice(0, opts.limit),
      cursor: items.length > opts.limit ? 'c1' : null
    })
  }
}

describe('listEndpoints — auth gates', () => {
  it('rejects admin-audience tokens', async () => {
    const c = ctx({ token: { audience: 'admin', workspace: 'ws1' } })
    await expect(listWorkspaceMembers(c, { workspace: 'ws1' }, fakeBackend([]))).rejects.toThrow(/workspace context required/)
  })

  it('rejects workspace claim mismatch', async () => {
    const c = ctx({ token: { audience: 'workspace', workspace: 'ws1' } })
    await expect(listWorkspaceMembers(c, { workspace: 'ws2' }, fakeBackend([]))).rejects.toThrow(/workspace mismatch/)
  })

  it('rejects GUEST roles from read endpoints', async () => {
    const c = ctx({ membership: { role: 'GUEST', ownedSpaces: [] } })
    await expect(listWorkspaceMembers(c, { workspace: 'ws1' }, fakeBackend([]))).rejects.toThrow(/read_not_allowed/)
  })

  it('rejects plain User from read endpoints', async () => {
    const c = ctx({ membership: { role: 'USER', ownedSpaces: [] } })
    await expect(listWorkspaceMembers(c, { workspace: 'ws1' }, fakeBackend([]))).rejects.toThrow(/read_not_allowed/)
  })

  it('allows Maintainer through read', async () => {
    const c = ctx({ membership: { role: 'MAINTAINER', ownedSpaces: [] } })
    const res = await listWorkspaceMembers(c, { workspace: 'ws1' }, fakeBackend([{ id: 'a' }] as any))
    expect(res.items.length).toBe(1)
  })

  it('allows IMPERSONATING_ADMIN through read', async () => {
    const c = ctx({ membership: { role: 'USER', ownedSpaces: [] }, isImpersonating: true })
    const res = await listWorkspaceMembers(c, { workspace: 'ws1' }, fakeBackend([{ id: 'a' }] as any))
    expect(res.items.length).toBe(1)
  })
})

describe('listEndpoints — pagination defaults', () => {
  it('uses DEFAULT_PAGE_SIZE when no limit', async () => {
    const c = ctx()
    const backend: ListBackend<any> = {
      query: async (_ws, opts) => {
        expect(opts.limit).toBe(DEFAULT_PAGE_SIZE)
        return { items: [], cursor: null }
      }
    }
    await listWorkspaceSpaces(c, { workspace: 'ws1' }, backend)
  })

  it('caps at MAX_PAGE_SIZE', async () => {
    const c = ctx()
    const backend: ListBackend<any> = {
      query: async (_ws, opts) => {
        expect(opts.limit).toBe(MAX_PAGE_SIZE)
        return { items: [], cursor: null }
      }
    }
    await listAuditLog(c, { workspace: 'ws1', limit: 9999 }, backend)
  })

  it('passes cursor + sort + filter through', async () => {
    const c = ctx()
    const backend: ListBackend<any> = {
      query: async (_ws, opts) => {
        expect(opts.cursor).toBe('c-mid')
        expect(opts.sort).toBe('name')
        expect(opts.filter).toEqual({ roleIn: ['OWNER'] })
        return { items: [], cursor: null }
      }
    }
    await listWorkspaceMembers(
      c,
      { workspace: 'ws1', cursor: 'c-mid', sort: 'name', filter: { roleIn: ['OWNER'] } },
      backend
    )
  })
})
