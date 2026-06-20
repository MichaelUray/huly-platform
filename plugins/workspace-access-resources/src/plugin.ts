//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

// H4 — i18n plumbing.
//
// Before this commit the entire WAC surface shipped hardcoded English via
// `getEmbeddedLabel('…')`. That worked but locked the plugin into a single
// language and prevented translators from contributing without touching
// .svelte sources.
//
// This module registers a Huly platform plugin (`workspace-access`) so we
// can use the standard `IntlString` machinery — same pattern as
// `tracker`, `tracker-resources`, etc. The translated bundles live in
// `lang/<locale>.json` and are loaded lazily by `addStringsLoader` in
// `index.ts`.
//
// Scope of this pass: we register ~30 of the most user-visible strings
// covering tab names, role labels, button labels, and the loading/empty/
// error states. The remaining ~22 `getEmbeddedLabel` call-sites are
// flagged as a v2 follow-up — pattern is proven, mechanical work to
// finish (see README "i18n status" section).

import type { IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'

export const wacPluginId = 'workspace-access' as Plugin

const wac = plugin(wacPluginId, {
  string: {
    // Tab labels (4)
    People: '' as IntlString,
    Resources: '' as IntlString,
    MyAccess: '' as IntlString,
    Audit: '' as IntlString,

    // Role labels (6)
    Owner: '' as IntlString,
    Maintainer: '' as IntlString,
    User: '' as IntlString,
    Guest: '' as IntlString,
    ReadOnlyGuest: '' as IntlString,
    DocGuest: '' as IntlString,

    // Button + action labels (9)
    SaveMembers: '' as IntlString,
    SaveOwners: '' as IntlString,
    SaveRole: '' as IntlString,
    ExportCsv: '' as IntlString,
    Revoke: '' as IntlString,
    Cancel: '' as IntlString,
    Save: '' as IntlString,
    Close: '' as IntlString,
    Refresh: '' as IntlString,

    // State labels (6)
    Loading: '' as IntlString,
    Error: '' as IntlString,
    NoData: '' as IntlString,
    NoGrantsReceived: '' as IntlString,
    NoGrantsGiven: '' as IntlString,
    WorkspaceAuditRetention: '' as IntlString,

    // Misc (3)
    AccessCenter: '' as IntlString,
    OpenInApp: '' as IntlString,
    ComingInV2: '' as IntlString
  }
})

export default wac
