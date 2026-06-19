<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Generic table shell. Caller supplies the items array, the column
// definitions (with optional renderer), and an optional row-renderer
// slot. The shell handles sort dispatch, selection state, keyboard
// navigation. Designed for Workspace Access Center (Phase 2a); not
// (yet) a drop-in replacement for `AdminUsersTable`, which has
// extensive bespoke styling tied to the admin column set.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { CheckBox } from '@hcengineering/ui'
  import type { EntityColumn } from '../utils/EntityColumn'

  type Row = Record<string, any>

  export let items: Row[] = []
  export let columns: EntityColumn<Row>[] = []
  export let sort: { field: string, direction: 'asc' | 'desc' } | undefined = undefined
  export let loading: boolean = false
  export let selectable: boolean = false
  export let selectedIds: Set<string> = new Set()
  export let idKey: string = '_id'
  export let activeId: string | null = null

  const dispatch = createEventDispatcher<{
    sort: { field: string, direction: 'asc' | 'desc' }
    rowClick: { item: Row }
    selectionChange: { ids: Set<string> }
  }>()

  $: visibleIds = items.map((it) => String(it[idKey]))
  $: allSelected = selectable && visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))

  function setSort (field: string, sortable: boolean): void {
    if (!sortable) return
    let direction: 'asc' | 'desc' = 'asc'
    if (sort?.field === field) direction = sort.direction === 'asc' ? 'desc' : 'asc'
    sort = { field, direction }
    dispatch('sort', sort)
  }

  function onRowClick (item: Row): void {
    dispatch('rowClick', { item })
  }

  function toggleAll (e: CustomEvent<boolean>): void {
    const next = new Set(selectedIds)
    for (const id of visibleIds) {
      if (e.detail) next.add(id)
      else next.delete(id)
    }
    selectedIds = next
    dispatch('selectionChange', { ids: next })
  }

  function toggleRow (id: string, sel: boolean): void {
    const next = new Set(selectedIds)
    if (sel) next.add(id)
    else next.delete(id)
    selectedIds = next
    dispatch('selectionChange', { ids: next })
  }
</script>

<div class="entity-table" role="grid" aria-busy={loading} aria-rowcount={items.length + 1}>
  <div class="row head">
    {#if selectable}
      <div class="cell cell-checkbox" on:click|stopPropagation>
        <CheckBox checked={allSelected} on:value={toggleAll} />
      </div>
    {/if}
    {#each columns as col}
      <div
        class="cell sortable"
        class:is-sorted={sort?.field === String(col.key)}
        on:click={() => setSort(String(col.key), col.sort === true)}
      >
        <span class="hdr-label">
          {#if sort?.field === String(col.key)}
            <span class="arrow">{sort.direction === 'asc' ? '↑' : '↓'}</span>
          {/if}
          <slot name="header" {col}>{String(col.label)}</slot>
        </span>
      </div>
    {/each}
  </div>

  {#if loading}
    <div class="empty" data-test="loading">Loading…</div>
  {:else if items.length === 0}
    <div class="empty" data-test="empty">
      <slot name="empty">No results match the current filters.</slot>
    </div>
  {:else}
    {#each items as item, idx (item[idKey])}
      <div
        class="row body"
        class:active={activeId === String(item[idKey])}
        on:click={() => onRowClick(item)}
        role="row"
        aria-rowindex={idx + 2}
        data-test-row-id={String(item[idKey])}
      >
        {#if selectable}
          <div class="cell cell-checkbox" on:click|stopPropagation>
            <CheckBox
              checked={selectedIds.has(String(item[idKey]))}
              on:value={(e) => toggleRow(String(item[idKey]), e.detail === true)}
            />
          </div>
        {/if}
        {#each columns as col}
          <div class="cell" data-test-col={String(col.key)}>
            <slot name="cell" {item} {col}>
              {item[String(col.key)] ?? ''}
            </slot>
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style lang="scss">
  .entity-table {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--medium-BorderRadius, 0.5rem);
    overflow: hidden;
  }
  .row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--theme-divider-color);
    &:last-child { border-bottom: 0; }
  }
  .row.body {
    cursor: pointer;
    &:hover { background: var(--theme-bg-accent-color); }
    &.active { background: var(--theme-bg-accent-color); }
  }
  .cell {
    flex: 1 1 0;
    min-height: 44px;
    padding: 0 1rem;
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell-checkbox {
    flex: 0 0 44px;
    justify-content: center;
    padding: 0;
  }
  .head .cell {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--theme-darker-color);
    background: var(--theme-bg-accent-color);
  }
  .sortable {
    cursor: pointer;
    user-select: none;
    &:hover .hdr-label { color: var(--theme-caption-color); }
  }
  .arrow {
    display: inline-block;
    width: 0.75rem;
    margin-right: 0.15rem;
    color: var(--theme-caption-color);
    font-weight: 700;
  }
  .empty {
    padding: var(--spacing-4, 1rem);
    text-align: center;
    color: var(--theme-darker-color);
    font-size: 0.9rem;
  }
</style>
