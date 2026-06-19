//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Svelte store that tracks the WAC impersonation lifecycle:
//   normal:      no impersonation; WAC behaves per workspace role
//   drill-down:  Instance-Admin opened WAC via #10883; banner blue,
//                no edit; can elevate to active via the modal
//   active:      30-min impersonation token live; red banner + countdown
//   expired:     token's `exp` has passed; expired modal blocks UI
//

import { writable } from 'svelte/store'
import { impersonationApi } from '../api/impersonationApi'

const SESSION_KEY = 'wac:imp:token'
const REF_KEY = 'wac:imp:ref'
const EXP_KEY = 'wac:imp:exp'

export type ImpersonationState = 'normal' | 'drill-down' | 'active' | 'expired'

export interface ImpersonationModel {
  state: ImpersonationState
  /** Seconds-since-epoch; same as JWT `exp`. */
  exp: number | null
  ref: string | null
  workspace: string | null
}

function initial (): ImpersonationModel {
  if (typeof window === 'undefined') {
    return { state: 'normal', exp: null, ref: null, workspace: null }
  }
  const token = window.sessionStorage.getItem(SESSION_KEY)
  const ref = window.sessionStorage.getItem(REF_KEY)
  const expStr = window.sessionStorage.getItem(EXP_KEY)
  if (token != null && expStr != null) {
    const exp = parseInt(expStr, 10)
    const now = Math.floor(Date.now() / 1000)
    if (exp > now) {
      return { state: 'active', exp, ref, workspace: null }
    }
    return { state: 'expired', exp, ref, workspace: null }
  }
  return { state: 'normal', exp: null, ref: null, workspace: null }
}

export const impersonationStore = writable<ImpersonationModel>(initial())

export function enterDrillDown (workspace: string): void {
  impersonationStore.set({ state: 'drill-down', exp: null, ref: null, workspace })
}

export async function startImpersonation (workspace: string, reason?: string): Promise<void> {
  const resp = await impersonationApi.start(workspace, reason)
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(SESSION_KEY, resp.impersonationToken)
    window.sessionStorage.setItem(REF_KEY, resp.impersonationRefId)
    window.sessionStorage.setItem(EXP_KEY, String(resp.exp))
  }
  impersonationStore.set({ state: 'active', exp: resp.exp, ref: resp.impersonationRefId, workspace })
}

export async function endImpersonation (): Promise<void> {
  let token: string | null = null
  if (typeof window !== 'undefined') {
    token = window.sessionStorage.getItem(SESSION_KEY)
    window.sessionStorage.removeItem(SESSION_KEY)
    window.sessionStorage.removeItem(REF_KEY)
    window.sessionStorage.removeItem(EXP_KEY)
  }
  if (token != null) {
    try {
      await impersonationApi.end(token)
    } catch {
      /* server-side cleanup may already have happened */
    }
  }
  impersonationStore.set({ state: 'normal', exp: null, ref: null, workspace: null })
}

export function markExpired (): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(SESSION_KEY)
  }
  impersonationStore.update((m) => ({ ...m, state: 'expired' }))
}

export function getImpersonationToken (): string | null {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(SESSION_KEY)
}
