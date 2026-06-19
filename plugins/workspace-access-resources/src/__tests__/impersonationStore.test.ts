import { get } from 'svelte/store'
import {
  impersonationStore,
  enterDrillDown,
  markExpired,
  getImpersonationToken
} from '../stores/impersonationStore'

describe('impersonationStore', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.sessionStorage.clear()
    impersonationStore.set({ state: 'normal', exp: null, ref: null, workspace: null })
  })

  it('enterDrillDown sets drill-down with workspace', () => {
    enterDrillDown('ws1')
    expect(get(impersonationStore)).toEqual({
      state: 'drill-down',
      exp: null,
      ref: null,
      workspace: 'ws1'
    })
  })

  it('markExpired transitions to expired and clears stored token', () => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem('wac:imp:token', 'abc')
    impersonationStore.set({ state: 'active', exp: 1, ref: 'r', workspace: 'ws' })
    markExpired()
    expect(get(impersonationStore).state).toBe('expired')
    if (typeof window !== 'undefined') {
      expect(window.sessionStorage.getItem('wac:imp:token')).toBeNull()
    }
  })

  it('getImpersonationToken returns null when none stored', () => {
    expect(getImpersonationToken()).toBeNull()
  })
})
