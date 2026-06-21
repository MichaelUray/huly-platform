//
// Copyright © 2026 Hardcore Engineering Inc.
//
// A3 — verification gap closure.
//
// When AccessCenterPage wires its default WacClient with
//   `getToken: () => getEffectiveBearerToken()`
// every WAC API client (myAccessApi, peopleApi, resourcesApi, auditApi,
// grantedAccessApi) must inherit the impersonation token without per-
// module changes — they all route through `getDefaultWacClient()`.
//
// These tests assert the Authorization header carries the impersonation
// token when one is active in sessionStorage, for one representative
// method per client. A regression here would mean one of the API
// modules side-stepped the default client (e.g. by holding its own
// fetch wrapper).
//

import {
  setDefaultWacClient,
  WacClient,
  getEffectiveBearerToken
} from '../api/wacClient'
import { myAccessApi } from '../api/myAccessApi'
import { peopleApi } from '../api/peopleApi'
import { resourcesApi } from '../api/resourcesApi'
import { auditApi } from '../api/auditApi'
import { grantedAccessApi } from '../api/grantedAccessApi'

const SESSION_KEY = 'wac:imp:token'
const WS = 'ws-42'

interface CapturedCall { url: string, init: RequestInit }

function installFetchMock (response: any = {}): CapturedCall[] {
  const calls: CapturedCall[] = []
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json () {
        return response
      },
      async text () {
        return ''
      }
    }
  })
  return calls
}

describe('WAC API clients carry the impersonation token (A3)', () => {
  const originalFetch = (globalThis as any).fetch

  beforeEach(() => {
    window.sessionStorage.clear()
    window.sessionStorage.setItem(SESSION_KEY, 'IMP-TOKEN-A3')
    // Default client routes its `getToken` through the same hook as
    // the production AccessCenterPage. Tests assert that all 5
    // clients inherit this resolution.
    setDefaultWacClient(new WacClient({ getToken: () => getEffectiveBearerToken() }))
  })

  afterEach(() => {
    ;(globalThis as any).fetch = originalFetch
    window.sessionStorage.clear()
  })

  it('myAccessApi.getSummary uses impersonation token', async () => {
    const calls = installFetchMock({
      role: 'OWNER',
      spacesMemberOf: [],
      spacesOwned: [],
      grantsReceived: [],
      grantsGiven: []
    })
    await myAccessApi.getSummary(WS)
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer IMP-TOKEN-A3')
  })

  it('peopleApi.listMembers uses impersonation token', async () => {
    const calls = installFetchMock({ rows: [], total: 0 })
    await peopleApi.listMembers(WS, {})
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer IMP-TOKEN-A3')
  })

  it('resourcesApi.listSpaces uses impersonation token', async () => {
    const calls = installFetchMock({ rows: [], total: 0 })
    await resourcesApi.listSpaces(WS, {})
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer IMP-TOKEN-A3')
  })

  it('auditApi.list uses impersonation token', async () => {
    const calls = installFetchMock({ rows: [], total: 0 })
    await auditApi.list(WS, {})
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer IMP-TOKEN-A3')
  })

  it('grantedAccessApi.listGrants uses impersonation token', async () => {
    const calls = installFetchMock({ rows: [], total: 0 })
    await grantedAccessApi.listGrants(WS, {})
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer IMP-TOKEN-A3')
  })

  it('without an impersonation session, falls back to the regular-token getter', async () => {
    const { setRegularTokenGetter } = await import('../api/wacClient')
    window.sessionStorage.removeItem(SESSION_KEY)
    setRegularTokenGetter(() => 'REGULAR-TOKEN')
    const calls = installFetchMock({
      role: 'USER',
      spacesMemberOf: [],
      spacesOwned: [],
      grantsReceived: [],
      grantsGiven: []
    })
    await myAccessApi.getSummary(WS)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer REGULAR-TOKEN')
  })
})
