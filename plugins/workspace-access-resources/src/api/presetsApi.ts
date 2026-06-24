//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Permission Templates (a.k.a. Role+Spaces Presets) — client API.
//
// Hits the WAC presets endpoints registered in
// `server-plugins/workspace-access/src/http/presetsRouter.ts`. All
// requests carry the workspace bearer (or impersonation token) via the
// shared WacClient, identical to peopleApi / resourcesApi.
//
// Tier-1 scope: only `role` + `addToSpaces` in the shape — doc-permissions
// and custom-attribute presets are deferred to v2.
//

import { getDefaultWacClient } from './wacClient'
import type { PageResult, WorkspaceRole } from '../types'

export interface PresetShape {
  role: WorkspaceRole
  /** Space `_id` strings — applied to each target member's space membership. */
  addToSpaces: string[]
}

export interface PresetRow {
  id: string
  workspace: string
  name: string
  description: string | null
  shape: PresetShape
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ApplyResultStatus =
  | 'ok'
  | 'last_owner_refused'
  | 'not_found'
  | 'internal'

export interface ApplyResult {
  memberUuid: string
  status: ApplyResultStatus
  addedToSpaces: number
  detail?: string
}

export interface ApplyResponse {
  applied: number
  results: ApplyResult[]
  snapshot: PresetRow
}

export interface CreatePresetInput {
  name: string
  description?: string | null
  shape: PresetShape
}

export interface UpdatePresetInput {
  name?: string
  description?: string | null
  shape?: PresetShape
}

export const presetsApi = {
  async list (workspace: string): Promise<PageResult<PresetRow>> {
    return await getDefaultWacClient().get(`/${workspace}/presets`)
  },

  async create (workspace: string, input: CreatePresetInput): Promise<{ item: PresetRow }> {
    return await getDefaultWacClient().post(`/${workspace}/presets`, input)
  },

  async update (workspace: string, id: string, input: UpdatePresetInput): Promise<{ item: PresetRow }> {
    return await getDefaultWacClient().put(`/${workspace}/presets/${id}`, input)
  },

  async remove (workspace: string, id: string): Promise<void> {
    await getDefaultWacClient().delete(`/${workspace}/presets/${id}`)
  },

  async apply (workspace: string, id: string, memberUuids: string[]): Promise<ApplyResponse> {
    return await getDefaultWacClient().post(`/${workspace}/presets/${id}/apply`, { memberUuids })
  }
}
