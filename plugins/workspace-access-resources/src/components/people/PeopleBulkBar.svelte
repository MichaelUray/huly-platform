<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Sticky bulk-action bar for the People view. Visible only when at
// least one row is selected; dispatches add/remove/role events to the
// parent which performs the API calls.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { WorkspaceRole } from '../../types'

  export let count: number = 0

  const dispatch = createEventDispatcher<{
    deselectAll: void
    addToSpace: void
    removeFromSpace: void
    changeRole: { role: WorkspaceRole }
  }>()

  let roleSelect: WorkspaceRole = 'USER'
</script>

{#if count > 0}
  <div class="bulk-bar" role="region" aria-label="Bulk actions">
    <span class="count">{count} selected</span>
    <button class="bulk-btn" on:click={() => dispatch('addToSpace')}>Add to space</button>
    <button class="bulk-btn" on:click={() => dispatch('removeFromSpace')}>Remove from space</button>
    <span class="role-changer">
      Change role
      <select bind:value={roleSelect} aria-label="New role">
        <option value="OWNER">Owner</option>
        <option value="MAINTAINER">Maintainer</option>
        <option value="USER">User</option>
        <option value="GUEST">Guest</option>
      </select>
      <button class="bulk-btn" on:click={() => dispatch('changeRole', { role: roleSelect })}>Apply</button>
    </span>
    <button class="ghost" on:click={() => dispatch('deselectAll')}>Cancel</button>
  </div>
{/if}

<style lang="scss">
  .bulk-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.25rem;
    background: var(--theme-bg-accent-color);
    border-top: 1px solid var(--theme-divider-color);
    z-index: 50;
  }
  .count { font-weight: 600; color: var(--theme-caption-color); }
  .bulk-btn {
    padding: 0.3rem 0.7rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--theme-caption-color);
    &:hover { background: var(--theme-divider-color); }
  }
  .role-changer { display: inline-flex; align-items: center; gap: 0.4rem; }
  .role-changer select {
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    padding: 0.25rem 0.4rem;
    border-radius: 0.25rem;
  }
  .ghost {
    margin-left: auto;
    background: transparent;
    border: 0;
    color: var(--theme-darker-color);
    cursor: pointer;
    &:hover { color: var(--theme-caption-color); }
  }
</style>
