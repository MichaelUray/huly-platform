//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Svelte store for WAC capabilities. Singleton per workspace; refresh()
// on AccessCenter mount so the visibility-gates are up to date for the
// session. Default = preview-hidden (fail safe).
//

import { writable, type Readable, derived, get } from 'svelte/store'
import { capabilitiesApi, type WacCapabilities } from '../api/capabilitiesApi'

const _store = writable<WacCapabilities | null>(null)

export const capabilities: Readable<WacCapabilities | null> = _store

export async function refreshCapabilities (workspace: string): Promise<void> {
  const caps = await capabilitiesApi.fetch(workspace)
  _store.set(caps)
}

/**
 * Convenience derived store: returns true when a specific preview
 * feature is enabled. Default (no caps loaded) returns false so UIs
 * stay hidden until the matrix arrives.
 */
export function previewEnabled (key: keyof WacCapabilities['preview']): Readable<boolean> {
  return derived(_store, ($c) => $c?.preview?.[key] === true)
}

export function previewEnabledSync (key: keyof WacCapabilities['preview']): boolean {
  return get(_store)?.preview?.[key] === true
}
