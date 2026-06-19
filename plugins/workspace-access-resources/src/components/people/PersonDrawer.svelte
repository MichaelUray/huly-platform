<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Per-person drawer: role editor (last-admin-gated), space membership
// quick-list, link to grants. Concrete picker UIs come in Phase 2a polish.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
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
        <div class="row">
          <label for="role-select">Role</label>
          <select id="role-select" bind:value={newRole} disabled={!canEdit || busy}>
            <option value="OWNER">Owner</option>
            <option value="MAINTAINER">Maintainer</option>
            <option value="USER">User</option>
            <option value="GUEST">Guest</option>
          </select>
        </div>
        {#if lastAdminCount != null}
          <p class="hint">Workspace currently has {lastAdminCount} admin{lastAdminCount === 1 ? '' : 's'}.</p>
        {/if}
        {#if error != null}
          <p class="err" role="alert">{error}</p>
        {/if}
        <button class="primary" on:click={applyRole} disabled={!canEdit || busy}>
          {busy ? 'Saving…' : 'Save role'}
        </button>
      </section>
    {/if}
  </svelte:fragment>
</EntityDrawer>

<style lang="scss">
  .section { display: flex; flex-direction: column; gap: 0.5rem; }
  .section h3 { margin: 0 0 0.5rem 0; font-size: 0.95rem; color: var(--theme-caption-color); }
  .row { display: flex; align-items: center; gap: 0.5rem; }
  .row select {
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    padding: 0.3rem 0.5rem;
    border-radius: 0.25rem;
  }
  .primary {
    margin-top: 1rem;
    padding: 0.45rem 0.9rem;
    background: var(--theme-caption-color);
    color: var(--theme-bg-color);
    border: 0;
    border-radius: 0.25rem;
    cursor: pointer;
    align-self: flex-start;
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }
  .hint { font-size: 0.78rem; color: var(--theme-darker-color); margin: 0; }
  .muted { color: var(--theme-darker-color); }
  .err { background: rgba(239,68,68,0.1); color: #b91c1c; padding: 0.5rem; border-radius: 0.25rem; }
</style>
