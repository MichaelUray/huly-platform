<!--
// Copyright © 2026 Hardcore Engineering Inc.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Button } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'

  export let count: number = 0

  const dispatch = createEventDispatcher<{
    'deselect-all': void
    add: void
    remove: void
    disable: void
    enable: void
    reset: void
  }>()
</script>

<div
  class="bar"
  class:is-empty={count === 0}
  role="region"
  aria-label="Bulk actions"
  aria-disabled={count === 0}
>
  <span class="label" aria-live="polite">{count} selected</span>
  <button class="link" disabled={count === 0} on:click={() => dispatch('deselect-all')}>Clear</button>
  <div class="spacer" />
  <Button label={getEmbeddedLabel('Add to workspace')} disabled={count === 0} on:click={() => dispatch('add')} />
  <Button label={getEmbeddedLabel('Remove from workspace')} disabled={count === 0} on:click={() => dispatch('remove')} />
  <Button label={getEmbeddedLabel('Disable')} kind={'dangerous'} disabled={count === 0} on:click={() => dispatch('disable')} />
  <Button label={getEmbeddedLabel('Enable')} disabled={count === 0} on:click={() => dispatch('enable')} />
  <Button label={getEmbeddedLabel('Send password reset')} disabled={count === 0} on:click={() => dispatch('reset')} />
</div>

<style lang="scss">
  /*
   * Sticky bulk-action bar pinned to the top of the scroll container, just
   * above the table — follows the standard data-grid convention. Stays
   * ALWAYS mounted; when no rows are selected it dims via .is-empty and
   * every interactive control receives `disabled` so the table layout
   * does not jump when the first row gets ticked.
   */
  .bar {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    margin-bottom: var(--spacing-2);
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--small-BorderRadius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    width: 100%;
    max-width: 76rem;
    z-index: 5;
    transition: opacity 120ms ease;
  }

  .bar.is-empty {
    opacity: 0.55;
  }

  .bar.is-empty .label {
    color: var(--theme-darker-color);
  }

  .label {
    font-weight: 500;
    color: var(--theme-caption-color);
    font-size: 0.85rem;
  }

  .link {
    background: transparent;
    border: 0;
    color: var(--theme-link-color, #3b82f6);
    cursor: pointer;
    font-size: 0.82rem;
    padding: 0;

    &:hover {
      text-decoration: underline;
    }

    &:disabled {
      color: var(--theme-darker-color);
      cursor: default;
      text-decoration: none;
    }
  }

  .spacer {
    flex: 1;
  }
</style>
