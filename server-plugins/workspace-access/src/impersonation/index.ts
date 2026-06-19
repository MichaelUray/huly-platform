//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Impersonation token lifecycle. The token is issued only from an
// /login/admin authenticated context (`assertAdmin` runs upstream),
// validated per-request via `assertImpersonationToken`, and revoked
// (or expires after 30 min). Replay or IDOR attempts are audit-logged.
//

import { Forbidden, type AdminAuditEntry } from '@hcengineering/access-management-server'

const TTL_SECONDS = 30 * 60
const PER_ADMIN_HOURLY_LIMIT = 10
const PER_WORKSPACE_HOURLY_LIMIT = 5

export interface JwtPayload {
  jti: string
  sub: string
  workspace: string
  audience: string
  iat: number
  exp: number
  extra: {
    impersonation: true
    impersonation_ref: string
    actor_admin: string
  }
}

export interface JwtSigner {
  sign: (payload: Omit<JwtPayload, 'iat'> & { iat?: number }) => string
  verify: (token: string) => JwtPayload | null
}

export interface RateLimiter {
  /** Returns true if the call is allowed; false if the limit was hit. */
  check: (key: string, perHour: number) => Promise<boolean>
}

export interface RevocationStore {
  revoke: (jti: string, expSeconds: number) => Promise<void>
  isRevoked: (jti: string) => Promise<boolean>
}

export interface AdminAuditWriter {
  write: (entry: AdminAuditEntry) => Promise<void>
}

export interface ImpersonationDeps {
  jwt: JwtSigner
  rate: RateLimiter
  revocation: RevocationStore
  audit: AdminAuditWriter
  uuid: () => string
  now: () => number
  /** Optional: kicks open WebSocket sessions on a given jti. */
  disconnectWebSocketsByToken?: (jti: string) => Promise<void>
}

export interface StartCtx {
  admin: { uuid: string }
}

export interface StartResult {
  impersonationToken: string
  impersonationRefId: string
  jti: string
  exp: number
}

export async function startImpersonation (
  deps: ImpersonationDeps,
  ctx: StartCtx,
  workspace: string,
  reason?: string
): Promise<StartResult> {
  if (!(await deps.rate.check(`imp:admin:${ctx.admin.uuid}`, PER_ADMIN_HOURLY_LIMIT))) {
    throw new Forbidden('rate_limit_admin')
  }
  if (!(await deps.rate.check(`imp:workspace:${workspace}`, PER_WORKSPACE_HOURLY_LIMIT))) {
    throw new Forbidden('rate_limit_workspace')
  }
  const impersonationRefId = deps.uuid()
  const jti = deps.uuid()
  const iat = deps.now()
  const exp = iat + TTL_SECONDS
  const token = deps.jwt.sign({
    jti,
    sub: ctx.admin.uuid,
    workspace,
    audience: 'wac',
    iat,
    exp,
    extra: {
      impersonation: true,
      impersonation_ref: impersonationRefId,
      actor_admin: ctx.admin.uuid
    }
  })
  await deps.audit.write({
    action: 'impersonation_started',
    actor: ctx.admin.uuid,
    target_workspace: workspace,
    metadata: { impersonation_ref: impersonationRefId, jti, reason, started_at: iat }
  })
  return { impersonationToken: token, impersonationRefId, jti, exp }
}

export interface ValidatedToken {
  jti: string
  actorAdmin: string
  workspace: string
  impersonationRef: string
  exp: number
}

export async function assertImpersonationToken (
  deps: ImpersonationDeps,
  raw: string,
  requestedWorkspace: string
): Promise<ValidatedToken> {
  const t = deps.jwt.verify(raw)
  if (t == null) throw new Forbidden('invalid_token')
  if (t.jti == null || t.jti === '') throw new Forbidden('missing_jti')
  if (t.workspace == null || t.workspace === '') throw new Forbidden('missing_workspace_claim')
  if (t.audience !== 'wac') throw new Forbidden('wrong_audience')
  if (t.extra?.impersonation !== true) throw new Forbidden('not_an_impersonation_token')
  if (t.extra?.impersonation_ref == null) throw new Forbidden('missing_impersonation_ref')
  if (t.extra?.actor_admin == null) throw new Forbidden('missing_actor_admin')

  const now = deps.now()
  if (now >= t.exp) throw new Forbidden('token_expired')

  if (t.workspace !== requestedWorkspace) {
    await deps.audit.write({
      action: 'impersonation_idor_attempt',
      actor: t.extra.actor_admin,
      metadata: { token_workspace: t.workspace, requested_workspace: requestedWorkspace, jti: t.jti }
    })
    throw new Forbidden('workspace_mismatch')
  }

  if (await deps.revocation.isRevoked(t.jti)) {
    await deps.audit.write({
      action: 'impersonation_replay_attempt',
      actor: t.extra.actor_admin,
      metadata: { jti: t.jti, impersonation_ref: t.extra.impersonation_ref }
    })
    throw new Forbidden('token_revoked')
  }

  return {
    jti: t.jti,
    actorAdmin: t.extra.actor_admin,
    workspace: t.workspace,
    impersonationRef: t.extra.impersonation_ref,
    exp: t.exp
  }
}

export async function endImpersonation (
  deps: ImpersonationDeps,
  raw: string
): Promise<void> {
  const t = deps.jwt.verify(raw)
  if (t == null) throw new Forbidden('invalid_token')
  await deps.audit.write({
    action: 'impersonation_ended',
    actor: t.extra.actor_admin,
    target_workspace: t.workspace,
    metadata: {
      impersonation_ref: t.extra.impersonation_ref,
      jti: t.jti,
      ended_at: deps.now(),
      duration_seconds: deps.now() - t.iat
    }
  })
  await deps.revocation.revoke(t.jti, t.exp)
  if (deps.disconnectWebSocketsByToken != null) {
    await deps.disconnectWebSocketsByToken(t.jti)
  }
}

export { TTL_SECONDS, PER_ADMIN_HOURLY_LIMIT, PER_WORKSPACE_HOURLY_LIMIT }
