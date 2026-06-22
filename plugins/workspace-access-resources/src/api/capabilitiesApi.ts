//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Granular preview-feature gate. The server exposes
// `/api/wac/<ws>/capabilities` (Codex E7 amendment) so the client can
// hide UI for features whose backend isn't really wired yet.
//
// Per-feature flags (NOT a single boolean) so e.g. CSV real can flip
// without also exposing Webhooks. Default: all preview flags false.
//

import { getDefaultWacClient } from './wacClient'

export interface WacCapabilities {
  workspace: string
  real: {
    accessCenter: boolean
    presets: boolean
    resourceBulkBar: boolean
    auditFilter: boolean
    inheritanceTree: boolean
    resourceSearch: boolean
    csvDryRun: boolean
  }
  preview: {
    webhooks: boolean
    grantExpiry: boolean
    csvDispatch: boolean
    effectivePermissions: boolean
    /**
     * FIX 4 — gates the "Leave space" + "Decline grant" buttons in
     * MyAccessView. Server routes return 501 my_access_mutations_not_wired
     * until the per-caller mutation backend is wired; UI hides the
     * buttons when this is false.
     */
    myAccessMutations: boolean
  }
}

const DEFAULT_PREVIEW_HIDDEN: WacCapabilities = {
  workspace: '',
  real: {
    accessCenter: true, presets: true, resourceBulkBar: true,
    auditFilter: true, inheritanceTree: true, resourceSearch: true, csvDryRun: true
  },
  preview: {
    webhooks: false, grantExpiry: false, csvDispatch: false, effectivePermissions: false, myAccessMutations: false
  }
}

export const capabilitiesApi = {
  /**
   * Fetch the workspace's capability matrix. Returns a default
   * "everything-real, preview-hidden" object on network / 4xx errors
   * so the UI fails safe: unknown backend status hides preview UIs.
   */
  async fetch (workspace: string): Promise<WacCapabilities> {
    try {
      return await getDefaultWacClient().get<WacCapabilities>(`/${workspace}/capabilities`)
    } catch {
      return { ...DEFAULT_PREVIEW_HIDDEN, workspace }
    }
  }
}
