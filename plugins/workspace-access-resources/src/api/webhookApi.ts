//
// Copyright © 2026 Hardcore Engineering Inc.
//
// WAC outbound-webhook API client. Wraps the
// `/api/wac/<workspace>/webhooks` CRUD surface defined in
// server-workspace-access (V35).
//

import { getDefaultWacClient } from './wacClient'

export type WebhookEventType =
  | 'role_changed'
  | 'grant_created'
  | 'grant_revoked'
  | 'grant_expired'
  | 'member_removed'
  | 'space_members_changed'
  | 'space_owners_changed'

export interface Webhook {
  id: string
  workspace: string
  url: string
  /** Server NEVER echoes the secret back; only the presence flag. */
  hasSecret: boolean
  event_types: WebhookEventType[]
  active: boolean
  data_filter: 'minimal' | 'full'
  created_by: string | null
  created_at: string
}

export interface WebhookCreateRequest {
  url: string
  secret?: string | null
  event_types: WebhookEventType[]
  active?: boolean
  data_filter?: 'minimal' | 'full'
}

export interface WebhookUpdateRequest {
  url?: string
  secret?: string | null
  event_types?: WebhookEventType[]
  active?: boolean
  data_filter?: 'minimal' | 'full'
}

export interface WebhookTestResult {
  ok: boolean
  status: number | null
  error?: string
}

export async function listWebhooks (workspace: string): Promise<Webhook[]> {
  const c = getDefaultWacClient()
  const resp = await c.get<{ items: Webhook[] }>(`/${workspace}/webhooks`)
  return resp.items
}

export async function createWebhook (workspace: string, body: WebhookCreateRequest): Promise<Webhook> {
  const c = getDefaultWacClient()
  return await c.post<Webhook>(`/${workspace}/webhooks`, body)
}

export async function updateWebhook (workspace: string, id: string, body: WebhookUpdateRequest): Promise<Webhook> {
  const c = getDefaultWacClient()
  return await c.put<Webhook>(`/${workspace}/webhooks/${id}`, body)
}

export async function deleteWebhook (workspace: string, id: string): Promise<void> {
  const c = getDefaultWacClient()
  await c.delete<void>(`/${workspace}/webhooks/${id}`)
}

export async function testWebhook (workspace: string, id: string): Promise<WebhookTestResult> {
  const c = getDefaultWacClient()
  return await c.post<WebhookTestResult>(`/${workspace}/webhooks/${id}/test`, {})
}
