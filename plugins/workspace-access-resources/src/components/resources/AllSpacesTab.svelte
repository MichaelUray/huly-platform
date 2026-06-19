<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { EntityTable, type EntityColumn } from '@hcengineering/access-management-ui'
  import { resourcesApi } from '../../api/resourcesApi'
  import SpaceTypeIcon from './SpaceTypeIcon.svelte'
  import type { SpaceRow } from '../../types'

  export let workspace: string
  export let preset: Record<string, unknown> = {}

  const dispatch = createEventDispatcher<{ rowClick: { spaceId: string } }>()

  let items: SpaceRow[] = []
  let loading: boolean = true
  let error: string | null = null
  let sort: { field: string, direction: 'asc' | 'desc' } | undefined

  const columns: EntityColumn<SpaceRow>[] = [
    { key: '_class', label: 'Type' as any, width: 140 },
    { key: 'name', label: 'Name' as any, sort: true },
    { key: 'membersCount', label: 'Members' as any, sort: true, width: 100 },
    { key: 'private', label: 'Privacy' as any, width: 100 },
    { key: 'autoJoin', label: 'Auto-join' as any, width: 100 },
    { key: 'archived', label: 'State' as any, width: 100 }
  ]

  async function refresh (): Promise<void> {
    loading = true
    error = null
    try {
      const res = await resourcesApi.listSpaces(workspace, { filter: preset, sort: sort?.field })
      items = res.items
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  onMount(refresh)

  function onSort (e: CustomEvent<{ field: string, direction: 'asc' | 'desc' }>): void {
    sort = e.detail
    void refresh()
  }

  function onRowClick (e: CustomEvent<{ item: SpaceRow }>): void {
    dispatch('rowClick', { spaceId: e.detail.item._id })
  }
</script>

<div class="all-spaces">
  {#if error != null}<div class="err" role="alert">{error}</div>{/if}
  <EntityTable items={items as any} {columns} {loading} {sort} idKey="_id"
    on:sort={onSort} on:rowClick={onRowClick}>
    <svelte:fragment slot="cell" let:item let:col>
      {#if String(col.key) === '_class'}
        <SpaceTypeIcon cls={item._class} />
      {:else if String(col.key) === 'private'}
        {item.private ? '🔒 Private' : 'Public'}
      {:else if String(col.key) === 'autoJoin'}
        {item.autoJoin ? '✓ Auto-join' : '—'}
      {:else if String(col.key) === 'archived'}
        {item.archived ? '🗄 Archived' : 'Active'}
      {:else}
        {item[String(col.key)] ?? ''}
      {/if}
    </svelte:fragment>
  </EntityTable>
</div>

<style lang="scss">
  .all-spaces { padding: 1rem 1.25rem; }
  .err { padding: 0.75rem; background: rgba(239,68,68,0.1); color: #b91c1c; border-radius: 0.25rem; margin-bottom: 0.75rem; }
</style>
