//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

// H4 + C5 — i18n plumbing.
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
// Wave 1 / C5: full sweep — all 31 hardcoded `getEmbeddedLabel(...)`
// call-sites in `src/components/**/*.svelte` plus the 3 strings in
// `setting-resources/AccessCenterPage.svelte` are now keyed. The
// `no-hardcoded-strings` guard test in `src/__tests__/` keeps it that way.

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
    ComingInV2: '' as IntlString,

    // C5 sweep — People sub-tabs (5)
    PeopleTabAll: '' as IntlString,
    PeopleTabByRole: '' as IntlString,
    PeopleTabInactive: '' as IntlString,
    PeopleTabGrantedAccess: '' as IntlString,
    PeopleTabPending: '' as IntlString,

    // C5 sweep — Resources sub-tabs (5)
    ResourcesTabAll: '' as IntlString,
    ResourcesTabPrivate: '' as IntlString,
    ResourcesTabPublic: '' as IntlString,
    ResourcesTabArchived: '' as IntlString,
    ResourcesTabAutoJoin: '' as IntlString,

    // C5 sweep — My Access sub-tabs (5)
    MyAccessTabRole: '' as IntlString,
    MyAccessTabMemberOf: '' as IntlString,
    MyAccessTabOwned: '' as IntlString,
    MyAccessTabReceived: '' as IntlString,
    MyAccessTabGiven: '' as IntlString,

    // C5 sweep — Audit toolbar (3)
    AuditFilterAction: '' as IntlString,
    AuditFilterActor: '' as IntlString,
    AuditClear: '' as IntlString,

    // C5 sweep — Bulk bar / drawers (5)
    BulkAddToSpace: '' as IntlString,
    BulkRemoveFromSpace: '' as IntlString,
    BulkApply: '' as IntlString,
    Role: '' as IntlString,
    Dismiss: '' as IntlString,

    // C5 sweep — Resource drawer toggles (3)
    Private: '' as IntlString,
    AutoJoin: '' as IntlString,
    Archived: '' as IntlString,

    // C5 sweep — Member picker (2)
    HideList: '' as IntlString,
    BrowseAll: '' as IntlString,

    // C5 sweep — Access Center page (Settings shell) (3)
    LoadingAccessCenter: '' as IntlString,
    LoadWorkspaceRoleError: '' as IntlString,
    Retry: '' as IntlString,

    // Wave 5 / Task C2 — last-Owner warning & hint in PersonDrawer.
    // Renamed from "Last Admin" since post-rename we count only Owners
    // (D5: MAINTAINER is read-only, not an admin in the WAC sense).
    // Pluralization handled by ICU `plural` in the IntlString value.
    LastOwnerCannotDemote: '' as IntlString,
    LastOwnerHint: '' as IntlString
  }
})

export default wac
