<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Sticky bulk-action bar styled with Huly's Button + theme tokens.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Button, IconAdd, IconClose, IconDelete } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
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
    <Button
      kind={'regular'}
      size={'small'}
      icon={IconAdd}
      label={getEmbeddedLabel('Add to space')}
      on:click={() => dispatch('addToSpace')}
    />
    <Button
      kind={'regular'}
      size={'small'}
      icon={IconDelete}
      label={getEmbeddedLabel('Remove from space')}
      on:click={() => dispatch('removeFromSpace')}
    />
    <span class="role-changer">
      Change role
      <select bind:value={roleSelect} aria-label="New role">
        <option value="OWNER">Owner</option>
        <option value="MAINTAINER">Maintainer</option>
        <option value="USER">User</option>
        <option value="GUEST">Guest</option>
      </select>
      <Button
        kind={'primary'}
        size={'small'}
        label={getEmbeddedLabel('Apply')}
        on:click={() => dispatch('changeRole', { role: roleSelect })}
      />
    </span>
    <span class="spacer"></span>
    <Button
      kind={'ghost'}
      size={'small'}
      icon={IconClose}
      label={getEmbeddedLabel('Cancel')}
      on:click={() => dispatch('deselectAll')}
    />
  </div>
{/if}

<style lang="scss">
  .bulk-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
    padding: var(--spacing-1_5) var(--spacing-2);
    background: var(--theme-bg-accent-color);
    border-top: 1px solid var(--theme-divider-color);
    z-index: 50;
  }
  .count {
    font-weight: 600;
    color: var(--theme-caption-color);
    padding-right: var(--spacing-1);
    border-right: 1px solid var(--theme-divider-color);
    margin-right: var(--spacing-1);
  }
  .role-changer {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--theme-darker-color);
    font-size: 0.85rem;

    select {
      background: var(--theme-bg-color);
      border: 1px solid var(--theme-divider-color);
      color: var(--theme-caption-color);
      padding: 0.25rem 0.4rem;
      border-radius: 0.25rem;
    }
  }
  .spacer { flex: 1; }
</style>
