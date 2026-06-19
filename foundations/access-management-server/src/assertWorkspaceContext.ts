//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { Forbidden } from './Forbidden'

export interface WorkspaceContext {
  token: {
    audience?: string
    workspace?: string
  }
}

/**
 * Reject any caller that isn't operating in a workspace session. The
 * Instance-Admin Panel (#10883) and the Workspace Access Center share
 * server endpoints in some cases, and an audience check is what keeps
 * an `/login/admin` token from accidentally accessing a `*Workspace*`
 * endpoint with admin powers it never asked for.
 */
export function assertWorkspaceContext (ctx: WorkspaceContext): void {
  const aud = ctx.token.audience
  if (aud !== 'workspace' && aud !== 'wac') {
    throw new Forbidden('workspace context required')
  }
  if (ctx.token.workspace == null || ctx.token.workspace === '') {
    throw new Forbidden('missing workspace claim')
  }
}
