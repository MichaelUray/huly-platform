<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
-->
<!--
  Phase 2.5 — Access Center "Guest Settings" tab body.

  This is a thin host that mounts the per-application guest-permission
  editor (`setting.component.GuestPermissionsEditor`, defined in
  `plugins/setting-resources/src/components/GuestPermissionsEditor.svelte`).

  Why an indirection through `AnyComponent`:
    * `workspace-access-resources` is intentionally lean (only depends
      on `core`, `presentation`, `ui`, `workbench`, `account-client`).
      Importing the editor directly would force a hard dep on
      `setting-resources` + the editor's transitive deps (`contact`,
      `communication`, `card`, `chat`, `analytics`, `contact-resources`).
    * The editor's data model is workspace-local Tx state, NOT a
      cross-workspace HTTP API, so we deliberately do NOT route through
      WacClient — the editor uses Huly's standard `getClient()` from
      `presentation`.
    * The AnyComponent id is registered in `setting/src/index.ts` and
      passed in from `setting-resources/AccessCenterPage.svelte` as the
      `guestSettingsComponent` prop on `AccessCenter`. If the prop is
      omitted, the tab renders an empty-state hint instead of breaking.

  Owner-only gate: enforced by `tabsForRole` in `roleStore.ts` (only
  OWNER + IMPERSONATING_ADMIN get this tab in their list). `canEdit` is
  forwarded to the editor for defense-in-depth — if anyone ever
  mis-passes the tab id to a non-Owner, the toggles render disabled
  rather than triggering a server-side 403 after a click.
-->
<script lang="ts">
  import { Component, Label } from '@hcengineering/ui'
  import type { AnyComponent } from '@hcengineering/ui'
  import wac from '../../plugin'

  /**
   * AnyComponent id of the editor body. Passed down from
   * AccessCenterPage (setting-resources) so this plugin needs no static
   * dep on `@hcengineering/setting`.
   */
  export let editorComponent: AnyComponent | undefined = undefined
  /**
   * Operator-write gate, forwarded to the editor. The AccessCenter
   * shell computes this from the effective role via `canEdit()`.
   */
  export let canEdit: boolean = false
</script>

<div class="guest-settings-view" id="wac-panel-guest-settings" role="tabpanel" data-test="wac-guest-settings">
  {#if editorComponent !== undefined}
    <Component is={editorComponent} props={{ canEdit }} />
  {:else}
    <div class="placeholder" data-test="wac-guest-settings-missing">
      <p><Label label={wac.string.GuestSettingsUnavailable} /></p>
    </div>
  {/if}
</div>

<style lang="scss">
  .guest-settings-view {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: var(--spacing-2) 0;
  }

  .placeholder {
    padding: 1.5rem;
    color: var(--theme-darker-color);
    font-style: italic;
  }
</style>
