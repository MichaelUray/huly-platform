//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wave 7 / B4 — pure-logic tests for the AccessCenterPage refetch +
// demoted-banner pipeline.
//
// We can't mount the Svelte component from jest here (no Svelte
// transformer wired in this package's jest config), so the testable
// surface is the lib/accessRefresh helpers plus an inline simulation
// of the page's "subscribe → refetch → set banner" wiring against a
// mocked myAccessApi.
//

import {
  roleHierarchy,
  isDemote,
  makeThrottle,
  ACCESS_REFETCH_INTERVAL_MS
} from '../util/accessRefresh'
import { roleStore } from '../stores/roleStore'
import { myAccessApi } from '../api/myAccessApi'
import type { WorkspaceRole } from '../types'
import type { MyAccessSummary } from '../api/myAccessApi'

describe('roleHierarchy', () => {
  it('orders OWNER > MAINTAINER > USER > GUEST', () => {
    expect(roleHierarchy('OWNER')).toBeGreaterThan(roleHierarchy('MAINTAINER'))
    expect(roleHierarchy('MAINTAINER')).toBeGreaterThan(roleHierarchy('USER'))
    expect(roleHierarchy('USER')).toBeGreaterThan(roleHierarchy('GUEST'))
  })

  it('collapses all guest variants to the same tier', () => {
    expect(roleHierarchy('GUEST')).toBe(roleHierarchy('READONLY_GUEST'))
    expect(roleHierarchy('GUEST')).toBe(roleHierarchy('DOC_GUEST'))
  })

  it('returns 0 for undefined / unknown roles', () => {
    expect(roleHierarchy(undefined)).toBe(0)
    expect(roleHierarchy('NOT_A_ROLE' as WorkspaceRole)).toBe(0)
  })
})

describe('isDemote', () => {
  it('flags MAINTAINER → USER as demote', () => {
    expect(isDemote('MAINTAINER', 'USER')).toBe(true)
  })

  it('flags OWNER → MAINTAINER as demote', () => {
    expect(isDemote('OWNER', 'MAINTAINER')).toBe(true)
  })

  it('flags USER → GUEST as demote', () => {
    expect(isDemote('USER', 'GUEST')).toBe(true)
  })

  it('does NOT flag same-role refetches (OWNER → OWNER, impersonation case)', () => {
    expect(isDemote('OWNER', 'OWNER')).toBe(false)
  })

  it('does NOT flag promotes', () => {
    expect(isDemote('USER', 'MAINTAINER')).toBe(false)
    expect(isDemote('MAINTAINER', 'OWNER')).toBe(false)
  })

  it('does NOT flag inter-guest-variant transitions', () => {
    expect(isDemote('GUEST', 'READONLY_GUEST')).toBe(false)
    expect(isDemote('DOC_GUEST', 'GUEST')).toBe(false)
  })

  it('returns false on missing prev (first hydration)', () => {
    expect(isDemote(undefined, 'GUEST')).toBe(false)
  })
})

describe('makeThrottle', () => {
  it('allows the first call', () => {
    const t = makeThrottle(1000, () => 100)
    expect(t.canRun()).toBe(true)
  })

  it('blocks within the interval after a mark', () => {
    let now = 100
    const t = makeThrottle(2000, () => now)
    expect(t.canRun()).toBe(true)
    t.mark()
    now = 1500
    expect(t.canRun()).toBe(false)
  })

  it('re-allows once the interval has elapsed', () => {
    let now = 100
    const t = makeThrottle(2000, () => now)
    t.mark()
    now = 2100
    expect(t.canRun()).toBe(true)
  })

  it('reset clears the throttle baseline', () => {
    let now = 100
    const t = makeThrottle(2000, () => now)
    t.mark()
    now = 500
    expect(t.canRun()).toBe(false)
    t.reset()
    expect(t.canRun()).toBe(true)
  })

  it('default interval is 2000ms', () => {
    expect(ACCESS_REFETCH_INTERVAL_MS).toBe(2000)
  })
})

describe('AccessCenterPage refetch pipeline (simulated)', () => {
  // Mirror the in-page wiring so we can drive it from tests without
  // mounting Svelte: a function that (a) checks the throttle, (b)
  // calls the (mocked) myAccessApi, (c) writes roleStore, (d) toggles
  // a `demoted` flag if isDemote() returns true.
  //
  // Test surface stays in sync with the Svelte component via a single
  // implementation pattern — if AccessCenterPage's refetch logic
  // drifts, this harness needs to drift too (intentional pairing).

  beforeEach(() => {
    jest.restoreAllMocks()
    roleStore.set({ workspaceRole: 'GUEST', ownedSpaceIds: [], hydrated: false })
  })

  function makeHarness (initialNow: number = 1000) {
    let nowMs = initialNow
    const throttle = makeThrottle(2000, () => nowMs)
    let demoted = false
    let prevRole: WorkspaceRole | undefined

    function captureRole (): void {
      const unsubscribe = roleStore.subscribe((v) => {
        prevRole = v.hydrated ? v.workspaceRole : undefined
      })
      unsubscribe()
    }

    async function refetch (workspace: string): Promise<boolean> {
      if (!throttle.canRun()) return false
      throttle.mark()
      captureRole()
      const snapshot = await myAccessApi.getSummary(workspace)
      roleStore.set({
        workspaceRole: snapshot.role,
        ownedSpaceIds: (snapshot.spacesOwned ?? []).map((s) => s._id),
        hydrated: true
      })
      if (isDemote(prevRole, snapshot.role)) {
        demoted = true
      }
      return true
    }

    return {
      tick (ms: number): void {
        nowMs += ms
      },
      refetch,
      isDemoted (): boolean {
        return demoted
      }
    }
  }

  function mockSummary (role: WorkspaceRole): MyAccessSummary {
    return { role, spacesMemberOf: [], spacesOwned: [], grantsReceived: [], grantsGiven: [] }
  }

  it('workspace-doc update → refetchMyAccess called', async () => {
    const spy = jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('OWNER'))
    const h = makeHarness()

    const ran = await h.refetch('ws1')

    expect(ran).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('ws1')
  })

  it('two updates within 2s → only one refetch (throttle)', async () => {
    const spy = jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('OWNER'))
    const h = makeHarness()

    await h.refetch('ws1')
    h.tick(500)
    const second = await h.refetch('ws1')

    expect(second).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('third update after 2s elapses → refetch re-allowed', async () => {
    const spy = jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('OWNER'))
    const h = makeHarness()

    await h.refetch('ws1')
    h.tick(2100)
    await h.refetch('ws1')

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('reconnect event → same refetch path, throttle applies', async () => {
    // Reconnect uses the same throttle as workspace-doc-update — only
    // ONE refetch can fire in a 2s window regardless of trigger.
    const spy = jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('OWNER'))
    const h = makeHarness()

    await h.refetch('ws1') // simulated workspace-doc-update
    const reconnectRan = await h.refetch('ws1') // simulated reconnect

    expect(reconnectRan).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)

    // After the window elapses, reconnect can drive a fresh refetch.
    h.tick(2100)
    const reconnectRan2 = await h.refetch('ws1')
    expect(reconnectRan2).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('refetch returns a LOWER role → banner state set', async () => {
    roleStore.set({ workspaceRole: 'OWNER', ownedSpaceIds: [], hydrated: true })
    jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('USER'))
    const h = makeHarness()

    await h.refetch('ws1')

    expect(h.isDemoted()).toBe(true)
  })

  it('refetch returns the SAME role → no banner', async () => {
    roleStore.set({ workspaceRole: 'OWNER', ownedSpaceIds: [], hydrated: true })
    jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('OWNER'))
    const h = makeHarness()

    await h.refetch('ws1')

    expect(h.isDemoted()).toBe(false)
  })

  it('refetch returns a HIGHER role → no banner (promote is safe)', async () => {
    roleStore.set({ workspaceRole: 'USER', ownedSpaceIds: [], hydrated: true })
    jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('OWNER'))
    const h = makeHarness()

    await h.refetch('ws1')

    expect(h.isDemoted()).toBe(false)
  })

  it('no banner when prev snapshot was un-hydrated (first load)', async () => {
    // Un-hydrated means we have no baseline to demote FROM, so the
    // first refetch must never light the banner — otherwise every
    // cold-start would show "your access has changed" spuriously.
    roleStore.set({ workspaceRole: 'GUEST', ownedSpaceIds: [], hydrated: false })
    jest.spyOn(myAccessApi, 'getSummary').mockResolvedValue(mockSummary('GUEST'))
    const h = makeHarness()

    await h.refetch('ws1')

    expect(h.isDemoted()).toBe(false)
  })
})
