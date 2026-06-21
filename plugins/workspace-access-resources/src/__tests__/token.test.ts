//
// Copyright © 2026 Hardcore Engineering Inc.
//
// A3 — `getEffectiveBearerToken` precedence:
//   1. sessionStorage['wac:imp:token'] (active impersonation)
//   2. registered regular-token getter (Huly workbench supplies
//      `() => getMetadata(presentation.metadata.Token)`)
//   3. legacy session-storage convention (`wac:token`/`huly:token`)
//
// Each branch is exercised independently so a future regression in
// any of the three fallbacks is caught at test-time.
//

import { getEffectiveBearerToken, setRegularTokenGetter } from '../api/wacClient'

const SESSION_KEY = 'wac:imp:token'

describe('getEffectiveBearerToken', () => {
  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.clear()
    }
    // Reset the registered getter — undefined is OK because the
    // setter accepts any function.
    setRegularTokenGetter(() => null)
  })

  it('returns the impersonation token when sessionStorage has one', () => {
    window.sessionStorage.setItem(SESSION_KEY, 'imp-token-xyz')
    setRegularTokenGetter(() => 'should-not-win')
    expect(getEffectiveBearerToken()).toBe('imp-token-xyz')
  })

  it('falls back to the registered regular-token getter when no impersonation session', () => {
    setRegularTokenGetter(() => 'regular-token-abc')
    expect(getEffectiveBearerToken()).toBe('regular-token-abc')
  })

  it('treats empty-string in sessionStorage as not-set and falls back', () => {
    window.sessionStorage.setItem(SESSION_KEY, '')
    setRegularTokenGetter(() => 'regular-token-abc')
    expect(getEffectiveBearerToken()).toBe('regular-token-abc')
  })

  it('returns null when no impersonation, no registered getter, no session-storage fallback', () => {
    setRegularTokenGetter(() => null)
    expect(getEffectiveBearerToken()).toBeNull()
  })

  it('falls back to legacy wac:token sessionStorage if nothing else matches', () => {
    setRegularTokenGetter(() => null)
    window.sessionStorage.setItem('wac:token', 'legacy-wac-token')
    expect(getEffectiveBearerToken()).toBe('legacy-wac-token')
  })

  it('falls back to legacy huly:token sessionStorage if wac:token absent', () => {
    setRegularTokenGetter(() => null)
    window.sessionStorage.setItem('huly:token', 'legacy-huly-token')
    expect(getEffectiveBearerToken()).toBe('legacy-huly-token')
  })

  it('impersonation token wins even when registered getter and legacy keys are also set', () => {
    window.sessionStorage.setItem(SESSION_KEY, 'imp-wins')
    window.sessionStorage.setItem('wac:token', 'should-lose-1')
    setRegularTokenGetter(() => 'should-lose-2')
    expect(getEffectiveBearerToken()).toBe('imp-wins')
  })
})
