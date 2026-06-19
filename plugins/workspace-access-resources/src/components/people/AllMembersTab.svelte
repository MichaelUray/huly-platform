<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// People > All Members: paginated table backed by peopleApi.listMembers.
// Drawer opens on row click. Selection (for bulk actions) is delegated
// up via the `selection` event and rendered by the parent PeopleView.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { EntityTable, type EntityColumn } from '@hcengineering/access-management-ui'
  import { peopleApi } from '../../api/peopleApi'
  import type { MemberRow } from '../../types'

  export let workspace: string
  export let preset: Record<string, unknown> = {}
  export let selectable: boolean = true
  export let selectedIds: Set<string> = new Set()

  const dispatch = createEventDispatcher<{ rowClick: { uuid: string }, selectionChange: Set<string> }>()

  let items: MemberRow[] = []
  let cursor: string | null = null
  let loading: boolean = true
  let error: string | null = null
  let sort: { field: string, direction: 'asc' | 'desc' } | undefined

  const columns: EntityColumn<MemberRow>[] = [
    { key: 'name', label: 'Name' as any, sort: true },
    { key: 'role', label: 'Role' as any, sort: true, width: 140 },
    { key: 'activityBucket', label: 'Last activity' as any, sort: true, width: 160 },
    { key: 'spacesCount', label: 'Spaces' as any, sort: true, width: 100 }
  ]

  async function refresh (): Promise<void> {
    loading = true
    error = null
    try {
      const res = await peopleApi.listMembers(workspace, { filter: preset, sort: sort?.field })
      items = res.items
      cursor = res.cursor
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void refresh()
  })

  function onSort (e: CustomEvent<{ field: string, direction: 'asc' | 'desc' }>): void {
    sort = e.detail
    void refresh()
  }

  function onRowClick (e: CustomEvent<{ item: MemberRow }>): void {
    dispatch('rowClick', { uuid: e.detail.item.uuid })
  }

  function onSelection (e: CustomEvent<{ ids: Set<string> }>): void {
    dispatch('selectionChange', e.detail.ids)
  }
</script>

<div class="all-members-tab">
  {#if error != null}
    <div class="err" role="alert">{error}</div>
  {/if}
  <EntityTable
    items={items}
    {columns}
    {loading}
    {sort}
    {selectable}
    selectedIds={selectedIds}
    idKey="uuid"
    on:sort={onSort}
    on:rowClick={onRowClick}
    on:selectionChange={onSelection}
  >
    <svelte:fragment slot="cell" let:item let:col>
      {#if String(col.key) === 'role'}
        <span class="role role-{(item.role || '').toLowerCase()}">{item.role}</span>
      {:else if String(col.key) === 'activityBucket'}
        <span class="bucket bucket-{item.activityBucket}">{item.activityBucket}</span>
      {:else}
        {item[String(col.key)] ?? ''}
      {/if}
    </svelte:fragment>
  </EntityTable>
</div>

<style lang="scss">
  .all-members-tab { padding: 1rem 1.25rem; }
  .err { padding: 0.75rem; background: rgba(239,68,68,0.1); color: #b91c1c; border-radius: 0.25rem; margin-bottom: 0.75rem; }
  .role { font-size: 0.78rem; padding: 0.1rem 0.45rem; border-radius: 0.25rem; }
  .role-owner { background: rgba(245,158,11,0.18); color: #b45309; }
  .role-maintainer { background: rgba(99,102,241,0.18); color: #4338ca; }
  .role-user { background: var(--theme-divider-color); color: var(--theme-darker-color); }
  .role-guest { background: rgba(156,163,175,0.18); color: #6b7280; }
  .bucket { font-size: 0.8rem; color: var(--theme-darker-color); }
  .bucket-today { color: #16a34a; font-weight: 500; }
  .bucket-90d\+ { color: #b91c1c; }
</style>
