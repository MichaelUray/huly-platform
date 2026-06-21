<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Per-person drawer: role editor (last-owner-gated). Uses Huly
// Button + DropdownLabelsIntl for native look.
//
// Wave 5 / Task C2 — Last-Admin → Last-Owner rename.
// Per D5 only OWNER edits workspace members; MAINTAINER is read-only,
// so the demote-warning is now gated on the Owner count, not the
// Owner+Maintainer count. UI strings + the consumed endpoint follow.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, DropdownLabelsIntl, Label, type DropdownIntlItem } from '@hcengineering/ui'
  import wac from '../../plugin'
  import { EntityDrawer } from '@hcengineering/access-management-ui'
  import { peopleApi } from '../../api/peopleApi'
  import type { WorkspaceRole } from '../../types'

  export let workspace: string
  export let person: { uuid: string, name: string, role: WorkspaceRole } | null = null
  export let open: boolean = false
  export let canEdit: boolean = false

  const dispatch = createEventDispatcher<{ close: void, changed: void }>()

  let newRole: WorkspaceRole = 'USER'
  let lastOwnerCount: number | null = null
  let error: string | null = null
  // Wave 5 / Task C2 — separated from `error` so the localized
  // "cannot demote the last Owner" message can be rendered via <Label>
  // (and translated for all 13 locales) while server-side error strings
  // fall through the plain `error` text.
  let lastOwnerRefused: boolean = false
  let busy: boolean = false

  // H4 — role labels via IntlString.
  const roleItems: DropdownIntlItem[] = [
    { id: 'OWNER', label: wac.string.Owner },
    { id: 'MAINTAINER', label: wac.string.Maintainer },
    { id: 'USER', label: wac.string.User },
    { id: 'GUEST', label: wac.string.Guest },
    // T3 — Guest sub-roles. All three share the same capability bucket
    // in v1 but are reported distinctly so the role label is honest.
    { id: 'READONLY_GUEST', label: wac.string.ReadOnlyGuest },
    { id: 'DOC_GUEST', label: wac.string.DocGuest }
  ]

  $: if (person != null) {
    newRole = person.role
    error = null
    lastOwnerRefused = false
  }

  async function refreshOwnerInfo (): Promise<void> {
    try {
      const info = await peopleApi.getLastOwnerInfo(workspace)
      lastOwnerCount = info.remaining
    } catch {
      lastOwnerCount = null
    }
  }

  onMount(refreshOwnerInfo)

  async function applyRole (): Promise<void> {
    if (person == null) return
    if (newRole === person.role) {
      dispatch('close')
      return
    }
    // Wave 5 / Task C2 — client-side gate against demoting the last Owner.
    // The server enforces this independently (writeRouter.handleMemberRole
    // returns last_owner_refused); this just prevents the round-trip and
    // surfaces a localized message via <Label>.
    if (person.role === 'OWNER' && newRole !== 'OWNER' && lastOwnerCount != null && lastOwnerCount <= 1) {
      lastOwnerRefused = true
      error = null
      return
    }
    busy = true
    lastOwnerRefused = false
    try {
      await peopleApi.setMemberRole(workspace, person.uuid, newRole)
      dispatch('changed')
      dispatch('close')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }
</script>

<EntityDrawer {open} title={person?.name ?? 'Person'} on:close={() => dispatch('close')}>
  <svelte:fragment slot="body">
    {#if person == null}
      <p class="muted">No person selected.</p>
    {:else}
      <section class="section">
        <h3>Workspace role</h3>
        <DropdownLabelsIntl
          label={wac.string.Role}
          kind={'primary'}
          size={'medium'}
          items={roleItems}
          selected={newRole}
          disabled={!canEdit || busy}
          on:selected={(e) => { newRole = e.detail }}
        />
        {#if lastOwnerCount != null}
          <p class="hint">
            <Label label={wac.string.LastOwnerHint} params={{ count: lastOwnerCount }} />
          </p>
        {/if}
        {#if lastOwnerRefused}
          <p class="err" role="alert">
            <Label label={wac.string.LastOwnerCannotDemote} />
          </p>
        {/if}
        {#if error != null}
          <p class="err" role="alert">{error}</p>
        {/if}
        <div class="actions">
          <Button
            kind={'primary'}
            size={'medium'}
            label={busy ? wac.string.Loading : wac.string.SaveRole}
            disabled={!canEdit || busy}
            title={!canEdit ? 'Only Workspace Owners can change workspace roles.' : undefined}
            on:click={applyRole}
          />
        </div>
      </section>
    {/if}
  </svelte:fragment>
</EntityDrawer>

<style lang="scss">
  .section { display: flex; flex-direction: column; gap: var(--spacing-1); }
  .section h3 {
    margin: 0 0 var(--spacing-1) 0;
    font-size: 0.95rem;
    color: var(--theme-caption-color);
  }
  .actions {
    margin-top: var(--spacing-2);
    display: flex;
    gap: var(--spacing-1);
  }
  .hint { font-size: 0.78rem; color: var(--theme-darker-color); margin: 0; }
  .muted { color: var(--theme-darker-color); }
  .err {
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    padding: var(--spacing-1);
    border-radius: 0.25rem;
  }
</style>
