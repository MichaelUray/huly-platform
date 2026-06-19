<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Generic audit-log table. Caller supplies entries + mapper. Supports
// cursor pagination via the `loadMore` event; the `cursor` prop is
// purely informational (whether to show the load-more affordance).
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { AuditMapper } from '../types/AuditEntry'

  export let entries: any[] = []
  export let mapper: AuditMapper<any>
  export let loading: boolean = false
  export let cursor: string | null = null

  const dispatch = createEventDispatcher<{ loadMore: void }>()

  $: rows = entries.map(mapper)
</script>

<div class="audit-list" role="list" aria-busy={loading}>
  {#each rows as row (row.when + row.actor + row.what)}
    <div class="audit-row" role="listitem">
      <div class="ts">{row.when}</div>
      <div class="actor">{row.actor}</div>
      <div class="action">{row.what}</div>
      {#if row.metadata?.impersonation_ref != null}
        <div class="badge red" title="Impersonation action">imp</div>
      {/if}
      {#if row.metadata?.batch_id != null}
        <div class="badge grey" title="Bulk-action batch">batch</div>
      {/if}
    </div>
  {/each}

  {#if loading}
    <div class="hint">Loading…</div>
  {:else if rows.length === 0}
    <div class="empty">
      <slot name="empty">No audit entries.</slot>
    </div>
  {/if}

  {#if cursor != null && !loading}
    <button class="load-more" on:click={() => dispatch('loadMore')}>Load more</button>
  {/if}
</div>

<style lang="scss">
  .audit-list { display: flex; flex-direction: column; gap: 0.25rem; }
  .audit-row {
    display: grid;
    grid-template-columns: 13rem 13rem 1fr auto auto;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
    font-size: 0.85rem;
    align-items: center;
  }
  .ts { color: var(--theme-darker-color); }
  .actor { color: var(--theme-caption-color); font-weight: 500; }
  .action { color: var(--theme-content-color); }
  .badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    text-transform: uppercase;
  }
  .badge.red { background: rgba(239, 68, 68, 0.18); color: #b91c1c; }
  .badge.grey { background: var(--theme-divider-color); color: var(--theme-darker-color); }
  .hint, .empty {
    padding: 1rem;
    text-align: center;
    color: var(--theme-darker-color);
    font-size: 0.9rem;
  }
  .load-more {
    align-self: center;
    margin: 1rem;
    padding: 0.4rem 1rem;
    background: var(--theme-bg-accent-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--theme-caption-color);
    &:hover { background: var(--theme-divider-color); }
  }
</style>
