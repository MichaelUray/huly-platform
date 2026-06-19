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
 * Returns the effective bearer token for outbound requests — the
 * impersonation token if active, else whatever the registered WAC
 * client's `getToken` returns (the regular workspace token). Used by
 * the CSV export button which needs to authenticate every request
 * (the previous version sent NO Authorization header when there was
 * no impersonation session, breaking exports for regular Owner /
 * Maintainer callers).
 */
export function getEffectiveBearerToken (): string | null {
  if (typeof window !== 'undefined') {
    const imp = window.sessionStorage.getItem('wac:imp:token')
    if (imp != null) return imp
  }
  // Fallback to whatever the client is configured to issue.
  return getDefaultWacClient().getToken() ?? null
}
