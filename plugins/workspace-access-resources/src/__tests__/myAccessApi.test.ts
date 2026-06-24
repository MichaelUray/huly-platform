//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Verifies `myAccessApi.getSummary` issues the correct request to
// `/api/wac/<workspace>/my-access` with the bearer token from the
// default WAC client. Phase 1 Task 3 (frontend roleStore hydration)
// depends on this contract — if either the URL or the Authorization
// header drifts, AccessCenterPage will silently fall back to GUEST.
//

import { setDefaultWacClient, WacClient } from '../api/wacClient'
import { myAccessApi } from '../api/myAccessApi'

describe('myAccessApi.getSummary', () => {
  const originalFetch = (globalThis as any).fetch

  afterEach(() => {
    ;(globalThis as any).fetch = originalFetch
  })

  it('GETs /api/wac/<ws>/my-access with Bearer token', async () => {
    const calls: Array<{ url: string, init: RequestInit }> = []
    ;(globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json () {
          return {
            role: 'MAINTAINER',
            spacesMemberOf: [],
            spacesOwned: [
              {
                _id: 'space-1',
                _class: 'tracker.class.Project',
                name: 'Demo',
                ownerIds: ['me'],
                membersCount: 3,
                private: false,
                autoJoin: false,
                archived: false
              }
            ],
            grantsReceived: [],
            grantsGiven: []
          }
        },
        async text () {
          return ''
        }
      }
    })

    setDefaultWacClient(new WacClient({ getToken: () => 'tok-abc' }))

    const summary = await myAccessApi.getSummary('ws-42')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/wac/ws-42/my-access')
    expect(calls[0].init.method).toBe('GET')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-abc')
    expect(headers.Accept).toBe('application/json')
    expect(summary.role).toBe('MAINTAINER')
    expect(summary.spacesOwned).toHaveLength(1)
    expect(summary.spacesOwned[0]._id).toBe('space-1')
  })

  it('omits Authorization when no token is available', async () => {
    const calls: Array<{ url: string, init: RequestInit }> = []
    ;(globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json () {
          return {
            role: 'GUEST',
            spacesMemberOf: [],
            spacesOwned: [],
            grantsReceived: [],
            grantsGiven: []
          }
        },
        async text () {
          return ''
        }
      }
    })

    setDefaultWacClient(new WacClient({ getToken: () => null }))

    await myAccessApi.getSummary('ws-0')

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('propagates a WacError on non-2xx', async () => {
    ;(globalThis as any).fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      async json () {
        return {}
      },
      async text () {
        return 'forbidden'
      }
    }))

    setDefaultWacClient(new WacClient({ getToken: () => 'tok' }))

    await expect(myAccessApi.getSummary('ws-x')).rejects.toThrow(/WAC 403/)
  })
})
