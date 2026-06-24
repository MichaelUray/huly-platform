<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Per-person drawer: role editor (last-admin-gated). Uses Huly
// Button + DropdownLabelsIntl for native look.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, DropdownLabelsIntl, type DropdownIntlItem } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { EntityDrawer } from '@hcengineering/access-management-ui'
  import { peopleApi } from '../../api/peopleApi'
  import type { WorkspaceRole } from '../../types'

  export let workspace: string
  export let person: { uuid: string, name: string, role: WorkspaceRole } | null = null
  export let open: boolean = false
  export let canEdit: boolean = false

  const dispatch = createEventDispatcher<{ close: void, changed: void }>()

  let newRole: WorkspaceRole = 'USER'
  let lastAdminCount: number | null = null
  let error: string | null = null
  let busy: boolean = false

  const roleItems: DropdownIntlItem[] = [
    { id: 'OWNER', label: getEmbeddedLabel('Owner') },
    { id: 'MAINTAINER', label: getEmbeddedLabel('Maintainer') },
    { id: 'USER', label: getEmbeddedLabel('User') },
    { id: 'GUEST', label: getEmbeddedLabel('Guest') }
  ]

  $: if (person != null) {
    newRole = person.role
    error = null
  }

  async function refreshAdminInfo (): Promise<void> {
    try {
      const info = await peopleApi.getLastAdminInfo(workspace)
      lastAdminCount = info.remaining
    } catch {
      lastAdminCount = null
    }
  }

  onMount(refreshAdminInfo)

  async function applyRole (): Promise<void> {
    if (person == null) return
    if (newRole === person.role) {
      dispatch('close')
      return
    }
    if (person.role === 'OWNER' && newRole !== 'OWNER' && lastAdminCount != null && lastAdminCount <= 1) {
      error = 'Cannot demote the last admin of this workspace.'
      return
    }
    busy = true
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
          label={getEmbeddedLabel('Role')}
          kind={'primary'}
          size={'medium'}
          items={roleItems}
          selected={newRole}
          disabled={!canEdit || busy}
          on:selected={(e) => { newRole = e.detail }}
        />
        {#if lastAdminCount != null}
          <p class="hint">Workspace currently has {lastAdminCount} admin{lastAdminCount === 1 ? '' : 's'}.</p>
        {/if}
        {#if error != null}
          <p class="err" role="alert">{error}</p>
        {/if}
        <div class="actions">
          <Button
            kind={'primary'}
            size={'medium'}
            label={getEmbeddedLabel(busy ? 'Saving…' : 'Save role')}
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
    background: color-mix(in srgb, #ef4444 12%, transparent);
    color: #b91c1c;
    padding: var(--spacing-1);
    border-radius: 0.25rem;
  }
</style>
