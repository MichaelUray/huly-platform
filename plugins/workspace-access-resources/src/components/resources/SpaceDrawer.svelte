<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Per-space drawer: members editor, owners editor, privacy/autoJoin/
// archive toggles (Owner-only), class-specific block kept read-only
// with "Open in <App> →" link. No Delete button.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, ToggleWithLabel } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import wac from '../../plugin'
  import { EntityDrawer } from '@hcengineering/access-management-ui'
  import SpaceTypeIcon from './SpaceTypeIcon.svelte'
  import MemberPickerInput from '../shared/MemberPickerInput.svelte'
  import { resourcesApi } from '../../api/resourcesApi'
  import { peopleApi } from '../../api/peopleApi'
  import type { SpaceDetail, MemberRow } from '../../types'

  export let workspace: string
  export let spaceId: string | null = null
  export let open: boolean = false
  /** True if caller can edit workspace-wide flags (private/autoJoin/archived). */
  export let canEditFlags: boolean = false
  /** True if caller can edit members/owners (Owner OR Space-Owner of THIS space). */
  export let canEditMembership: boolean = false

  const dispatch = createEventDispatcher<{ close: void, changed: void }>()

  let space: SpaceDetail | null = null
  let loading: boolean = false
  let error: string | null = null
  // `detailLoaded` separates "drawer just opened" from "we actually have
  // a valid members/owners list". Save buttons stay disabled until this
  // is true so a click cannot wipe a list that hasn't loaded yet.
  let detailLoaded: boolean = false

  let membersSelected: string[] = []
  let ownersSelected: string[] = []
  let allMembers: { uuid: string; name: string; email?: string }[] = []
  let privateFlag = false
  let autoJoinFlag = false
  let archivedFlag = false

  onMount(async () => {
    try {
      const res = await peopleApi.listMembers(workspace, { limit: 100 })
      allMembers = res.items.map((m: MemberRow) => ({ uuid: m.uuid, name: m.name, email: m.email }))
    } catch { /* keep empty */ }
  })

  $: if (spaceId != null && open) {
    void load(spaceId)
  }

  async function load (id: string): Promise<void> {
    loading = true
    error = null
    detailLoaded = false
    membersSelected = []
    ownersSelected = []
    try {
      space = await resourcesApi.getSpace(workspace, id)
      membersSelected = space.members ?? []
      ownersSelected = space.ownerIds ?? []
      privateFlag = space.private
      autoJoinFlag = space.autoJoin
      archivedFlag = space.archived
      detailLoaded = true
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  async function saveMembers (): Promise<void> {
    if (space == null) return
    try {
      await resourcesApi.setSpaceMembers(workspace, space._id, membersSelected)
      dispatch('changed')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function saveOwners (): Promise<void> {
    if (space == null) return
    try {
      await resourcesApi.setSpaceOwners(workspace, space._id, ownersSelected)
      dispatch('changed')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function togglePrivacy (): Promise<void> {
    if (space == null) return
    try {
      await resourcesApi.setSpacePrivacy(workspace, space._id, privateFlag)
      dispatch('changed')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      privateFlag = !privateFlag
    }
  }

  async function toggleAutoJoin (): Promise<void> {
    if (space == null) return
    try {
      await resourcesApi.setSpaceAutoJoin(workspace, space._id, autoJoinFlag)
      dispatch('changed')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      autoJoinFlag = !autoJoinFlag
    }
  }

  async function toggleArchived (): Promise<void> {
    if (space == null) return
    try {
      await resourcesApi.setSpaceArchived(workspace, space._id, archivedFlag)
      dispatch('changed')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      archivedFlag = !archivedFlag
    }
  }

  function deepLink (s: SpaceRow): string {
    // Map _class → in-app navigator path. Stub for now; the workbench
    // wiring task (Phase 4) plugs in the real per-app routes.
    return `/workbench/${workspace}/${s._class.split('.')[0]}/${s._id}`
  }
</script>

<EntityDrawer {open} title={space?.name ?? 'Space'} on:close={() => dispatch('close')}>
  <svelte:fragment slot="body">
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if space == null}
      <p class="muted">No space selected.</p>
    {:else}
      <div class="head-meta">
        <SpaceTypeIcon cls={space._class} />
        <a href={deepLink(space)} target="_blank" rel="noopener">Open in {space._class.split('.')[0]} →</a>
      </div>

      {#if error != null}<p class="err" role="alert">{error}</p>{/if}

      <section>
        <h3>Members</h3>
        <MemberPickerInput
          bind:selected={membersSelected}
          options={allMembers}
          disabled={!canEditMembership || !detailLoaded}
          placeholder={'Add member…'}
        />
        <div class="actions">
          <Button
            kind={'primary'}
            size={'small'}
            label={wac.string.SaveMembers}
            disabled={!canEditMembership || !detailLoaded}
            title={!canEditMembership ? 'Only Workspace Owners and Space Owners can change members.' : undefined}
            on:click={saveMembers}
          />
        </div>
      </section>

      <section>
        <h3>Owners</h3>
        <MemberPickerInput
          bind:selected={ownersSelected}
          options={allMembers}
          disabled={!canEditMembership || !detailLoaded}
          placeholder={'Add owner…'}
        />
        <div class="actions">
          <Button
            kind={'primary'}
            size={'small'}
            label={wac.string.SaveOwners}
            disabled={!canEditMembership || !detailLoaded}
            title={!canEditMembership ? 'Only Workspace Owners and Space Owners can change owners.' : undefined}
            on:click={saveOwners}
          />
        </div>
      </section>

      <section class="toggles">
        <h3>Flags</h3>
        <div class="toggle-row">
          <ToggleWithLabel
            label={getEmbeddedLabel('Private')}
            bind:on={privateFlag}
            disabled={!canEditFlags}
            on:change={togglePrivacy}
          />
        </div>
        <div class="toggle-row">
          <ToggleWithLabel
            label={getEmbeddedLabel('Auto-join')}
            bind:on={autoJoinFlag}
            disabled={!canEditFlags}
            on:change={toggleAutoJoin}
          />
        </div>
        <div class="toggle-row">
          <ToggleWithLabel
            label={getEmbeddedLabel('Archived')}
            bind:on={archivedFlag}
            disabled={!canEditFlags}
            on:change={toggleArchived}
          />
        </div>
        {#if !canEditFlags}
          <p class="hint">Workspace-wide consequences — only Workspace Owners can change these.</p>
        {/if}
      </section>
    {/if}
  </svelte:fragment>
</EntityDrawer>

<style lang="scss">
  section { margin-bottom: var(--spacing-3); }
  h3 {
    margin: 0 0 var(--spacing-1);
    font-size: 0.95rem;
    color: var(--theme-caption-color);
  }
  textarea {
    width: 100%;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    padding: var(--spacing-1);
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.85rem;
  }
  .actions {
    margin-top: var(--spacing-1);
    display: flex;
    gap: var(--spacing-1);
  }
  .toggle-row {
    margin: var(--spacing-1) 0;
  }
  .head-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-2);
    padding-bottom: var(--spacing-1_5);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .head-meta a { color: var(--theme-caption-color); font-size: 0.85rem; }
  .toggles label { display: block; margin: 0.4rem 0; font-size: 0.9rem; }
  .hint { font-size: 0.78rem; color: var(--theme-darker-color); }
  .muted { color: var(--theme-darker-color); }
  .err { background: rgba(239,68,68,0.1); color: #b91c1c; padding: 0.5rem; border-radius: 0.25rem; }
</style>
