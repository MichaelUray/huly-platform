//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Issued/consumed via the admin-server endpoints; routed under
// `/api/admin/impersonation/*` not `/api/wac/*` since they bridge the
// instance-admin → workspace surfaces.
//

export interface StartResponse {
  impersonationToken: string
  impersonationRefId: string
  jti: string
  /** Seconds-since-epoch; same as the JWT `exp` claim. */
  exp: number
}

export const impersonationApi = {
  async start (workspace: string, reason?: string, getAdminToken: () => string | null = () => null): Promise<StartResponse> {
    const resp = await fetch('/api/admin/impersonation/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(getAdminToken() != null ? { Authorization: `Bearer ${getAdminToken() ?? ''}` } : {})
      },
      body: JSON.stringify({ workspace, reason })
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`impersonation start failed: ${resp.status} ${text}`)
    }
    return (await resp.json()) as StartResponse
  },

  async end (wacToken: string): Promise<void> {
    const resp = await fetch('/api/admin/impersonation/end', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${wacToken}`
      }
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`impersonation end failed: ${resp.status} ${text}`)
    }
  }
}
