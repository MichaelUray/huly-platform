//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Browser-safe (no Node `Buffer`) base64-JSON filter encoding for use in
// URL query parameters. The decoder rejects prototype-pollution payloads
// recursively. Mirrors the server-side decoder used by the WAC + admin
// list endpoints; consumers must produce + consume via these helpers so
// the encoding stays symmetric and unit-testable.
//

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

function assertNoForbiddenKeys (value: unknown): void {
  if (value === null || typeof value !== 'object') return
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key)) throw new Error(`forbidden key: ${key}`)
    assertNoForbiddenKeys((value as Record<string, unknown>)[key])
  }
}

function base64Decode (b64: string): string {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  }
  // Node fallback for Jest/SSR
  return (globalThis as any).Buffer.from(b64, 'base64').toString('utf8')
}

function base64Encode (str: string): string {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }
  return (globalThis as any).Buffer.from(str, 'utf8').toString('base64')
}

/**
 * Decode a base64-JSON filter payload from a URL parameter. Returns null
 * if the payload is not a non-array object; throws if it contains any
 * `__proto__` / `constructor` / `prototype` key anywhere in the tree.
 */
export function decodeFilterParam (encoded: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(base64Decode(encoded))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  assertNoForbiddenKeys(parsed)
  return parsed as Record<string, unknown>
}

/**
 * Counter-part to `decodeFilterParam`. Use for client API calls instead
 * of `new URLSearchParams(obj as any)` (which serializes nested objects
 * as `[object Object]`).
 */
export function encodeFilterParam (filter: Record<string, unknown>): string {
  return base64Encode(JSON.stringify(filter))
}
