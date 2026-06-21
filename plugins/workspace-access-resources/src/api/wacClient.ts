//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Thin fetch wrapper used by every WAC API module. The base URL is
// the same-origin /api/wac/<workspace>/... endpoint family defined in
// workspace-access-server (Phase 2b). All requests carry the caller's
// workspace token; an impersonation session adds `wac` audience.
//

export interface WacClientOpts {
  baseUrl?: string
  /** Returns the bearer token (workspace or wac audience). */
  getToken: () => string | null
}

export class WacClient {
  private readonly baseUrl: string
  /** Public so the export button + tests can reach the active token. */
  readonly getToken: () => string | null

  constructor (opts: WacClientOpts) {
    this.baseUrl = opts.baseUrl ?? '/api/wac'
    this.getToken = opts.getToken
  }

  async get<T> (path: string): Promise<T> {
    return await this.request<T>('GET', path)
  }

  async post<T> (path: string, body: unknown): Promise<T> {
    return await this.request<T>('POST', path, body)
  }

  async put<T> (path: string, body: unknown): Promise<T> {
    return await this.request<T>('PUT', path, body)
  }

  async delete<T> (path: string): Promise<T> {
    return await this.request<T>('DELETE', path)
  }

  private async request<T> (method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json'
    }
    const token = this.getToken()
    if (token != null) headers.Authorization = `Bearer ${token}`
    if (body != null) headers['Content-Type'] = 'application/json'
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new WacError(resp.status, text || resp.statusText)
    }
    if (resp.status === 204) return undefined as unknown as T
    return (await resp.json()) as T
  }
}

export class WacError extends Error {
  constructor (public readonly status: number, body: string) {
    super(`WAC ${status}: ${body}`)
    this.name = 'WacError'
  }
}

let defaultClient: WacClient | null = null

export function setDefaultWacClient (client: WacClient): void {
  defaultClient = client
}

export function getDefaultWacClient (): WacClient {
  if (defaultClient == null) {
    // Sensible fallback: same-origin, sessionStorage-held token. Callers
    // that mount the WAC inside Huly's workbench should call
    // `setDefaultWacClient` first with the real token getter.
    defaultClient = new WacClient({
      getToken: () =>
        typeof window !== 'undefined'
          ? window.sessionStorage.getItem('wac:token') ?? window.sessionStorage.getItem('huly:token')
          : null
    })
  }
  return defaultClient
}

/**
 * Caller-provided getter for the regular (non-impersonation) workspace
 * bearer token. Registered once by the Huly workbench at WAC mount time
 * (typically: `() => getMetadata(presentation.metadata.Token)`) so
 * `wacClient.ts` does NOT import `@hcengineering/presentation` directly
 * — that import would drag Svelte components into jest's module graph
 * and break unit tests.
 *
 * If unregistered, `getEffectiveBearerToken` falls back to
 * `sessionStorage['huly:token'] || sessionStorage['wac:token']`.
 */
let regularTokenGetter: (() => string | null | undefined) | null = null

export function setRegularTokenGetter (getter: () => string | null | undefined): void {
  regularTokenGetter = getter
}

/**
 * Returns the effective bearer token for outbound requests — the
 * A3 impersonation token if active, else the workbench-supplied
 * regular workspace token. Used both by the CSV export button
 * (direct fetch) and by the default WacClient `getToken` hook in
 * AccessCenterPage so every WAC API module (myAccess / people /
 * resources / audit / grantedAccess) automatically picks up the
 * impersonation token without per-module changes.
 *
 * IMPORTANT: this MUST NOT delegate back to `getDefaultWacClient().getToken`
 * — the default client's `getToken` hook itself calls
 * `getEffectiveBearerToken`, so doing so creates infinite recursion.
 */
export function getEffectiveBearerToken (): string | null {
  if (typeof window !== 'undefined' && window.sessionStorage != null) {
    const imp = window.sessionStorage.getItem('wac:imp:token')
    // Treat empty string as "not set" so a UI bug that wrote ''
    // doesn't silently break Authorization headers.
    if (imp != null && imp.length > 0) return imp
  }
  if (regularTokenGetter != null) {
    const v = regularTokenGetter()
    if (typeof v === 'string' && v.length > 0) return v
  }
  // Final fallback: session-storage convention used by the legacy
  // default-client `getToken`. Keeps tests + standalone harnesses
  // working without forcing them to register a getter.
  if (typeof window !== 'undefined' && window.sessionStorage != null) {
    const s = window.sessionStorage.getItem('wac:token') ?? window.sessionStorage.getItem('huly:token')
    if (s != null && s.length > 0) return s
  }
  return null
}
