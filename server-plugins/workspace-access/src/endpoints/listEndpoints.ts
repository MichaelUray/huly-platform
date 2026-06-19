//
// Copyright © 2026 Hardcore Engineering Inc.
//
// List endpoints for People / Resources / Audit. Every read goes
// through two gates: assertWorkspaceContext (token audience + workspace
// claim) and the role gate set (READ_ALLOWED_ROLES). Cursor pagination
// is mandatory above 100 rows.
//

import {
  assertWorkspaceContext,
  getEffectiveRole,
  READ_ALLOWED_ROLES,
  Forbidden,
  type EffectiveRole,
  type RoleCtx
} from '@hcengineering/access-management-server'

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 50

export interface ListEndpointCtx extends RoleCtx {
  token: { audience?: string; workspace?: string }
}

export interface ListParams {
  workspace: string
  cursor?: string
  sort?: string
  filter?: Record<string, unknown>
  limit?: number
}

export interface ListBackend<T> {
  query: (workspace: string, opts: { cursor?: string; sort?: string; filter?: Record<string, unknown>; limit: number }) => Promise<{ items: T[]; cursor: string | null }>
}

async function gate (ctx: ListEndpointCtx, params: ListParams): Promise<EffectiveRole> {
  assertWorkspaceContext(ctx)
  if (ctx.token.workspace !== params.workspace) {
    throw new Forbidden('workspace mismatch')
  }
  const role = await getEffectiveRole(ctx, params.workspace)
  if (!READ_ALLOWED_ROLES.includes(role)) {
    throw new Forbidden(`read_not_allowed:${role}`)
  }
  return role
}

export async function listWorkspaceMembers<T> (
  ctx: ListEndpointCtx,
  params: ListParams,
  backend: ListBackend<T>
): Promise<{ items: T[]; cursor: string | null }> {
  await gate(ctx, params)
  const limit = Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  return await backend.query(params.workspace, { cursor: params.cursor, sort: params.sort, filter: params.filter, limit })
}

export async function listWorkspaceSpaces<T> (
  ctx: ListEndpointCtx,
  params: ListParams,
  backend: ListBackend<T>
): Promise<{ items: T[]; cursor: string | null }> {
  await gate(ctx, params)
  const limit = Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  return await backend.query(params.workspace, { cursor: params.cursor, sort: params.sort, filter: params.filter, limit })
}

export async function listAuditLog<T> (
  ctx: ListEndpointCtx,
  params: ListParams,
  backend: ListBackend<T>
): Promise<{ items: T[]; cursor: string | null }> {
  await gate(ctx, params)
  const limit = Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  // Audit-log query patterns + index map documented in the spec; the
  // backend is responsible for routing the filter to the right index.
  return await backend.query(params.workspace, { cursor: params.cursor, sort: params.sort, filter: params.filter, limit })
}

export { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE }
