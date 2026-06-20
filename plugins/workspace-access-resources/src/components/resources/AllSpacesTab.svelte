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

  // M7 — v2-placeholder rows are synthesized client-side. Pre-fix, the
  // backend pushed these into every /api/wac/<ws>/spaces response which
  // polluted the API contract for any non-UI consumer (CLI tools,
  // dashboards, future admin surfaces). The UI was the only consumer
  // that knew how to render the `v2NotYet=true` rows, so we keep the
  // synthesis local to it.
  const v2Placeholders: SpaceRow[] = [
    {
      _id: 'wac:placeholder:chat-channels',
      _class: 'chunter.placeholder.v2',
      name: 'Chat Channels',
      ownerIds: [],
      membersCount: 0,
      private: false,
      autoJoin: false,
      archived: false,
      capabilities: {
        editableHere: false,
        openInApp: `/workbench/${workspace}/chunter`,
        v2NotYet: true
      }
    } as SpaceRow,
    {
      _id: 'wac:placeholder:office-rooms',
      _class: 'love.placeholder.v2',
      name: 'Office Rooms',
      ownerIds: [],
      membersCount: 0,
      private: false,
      autoJoin: false,
      archived: false,
      capabilities: {
        editableHere: false,
        openInApp: `/workbench/${workspace}/love`,
        v2NotYet: true
      }
    } as SpaceRow,
    {
      _id: 'wac:placeholder:guest-links',
      _class: 'guest.placeholder.v2',
      name: 'Guest Links',
      ownerIds: [],
      membersCount: 0,
      private: false,
      autoJoin: false,
      archived: false,
      capabilities: { editableHere: false, openInApp: null, v2NotYet: true }
    } as SpaceRow
  ]

  async function refresh (): Promise<void> {
    loading = true
    error = null
    try {
      const res = await resourcesApi.listSpaces(workspace, { filter: preset, sort: sort?.field })
      // Append the v2 "coming soon" placeholders after the real rows so
      // users see a single combined list — the rendered styling already
      // distinguishes them via `capabilities.v2NotYet`.
      items = [...res.items, ...v2Placeholders]
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
    // v2-placeholder rows have no edit surface — clicking opens the
    // underlying app instead of the WAC drawer.
    if (e.detail.item.capabilities?.v2NotYet === true) {
      const url = e.detail.item.capabilities.openInApp
      if (url != null && typeof window !== 'undefined') {
        window.location.href = url
      }
      return
    }
    dispatch('rowClick', { spaceId: e.detail.item._id })
  }

  function openInApp (url: string | null | undefined, ev: Event): void {
    ev.stopPropagation()
    if (url == null || typeof window === 'undefined') return
    window.location.href = url
  }
</script>

<div class="all-spaces">
  {#if error != null}<div class="err" role="alert">{error}</div>{/if}
  <EntityTable items={items} {columns} {loading} {sort} idKey="_id"
    on:sort={onSort} on:rowClick={onRowClick}>
    <svelte:fragment slot="cell" let:item let:col>
      {#if String(col.key) === '_class'}
        <SpaceTypeIcon cls={item._class} />
      {:else if String(col.key) === 'private'}
        {#if item.capabilities?.v2NotYet}—{:else}{item.private ? '🔒 Private' : 'Public'}{/if}
      {:else if String(col.key) === 'autoJoin'}
        {#if item.capabilities?.v2NotYet}—{:else}{item.autoJoin ? '✓ Auto-join' : '—'}{/if}
      {:else if String(col.key) === 'archived'}
        {#if item.capabilities?.v2NotYet}
          <span class="badge badge-v2" data-test="wac-v2-badge">v2 coming soon</span>
        {:else if item.capabilities?.openInApp != null && item.capabilities?.editableHere === false}
          <a
            class="open-in-app"
            href={item.capabilities.openInApp}
            on:click={(ev) => openInApp(item.capabilities?.openInApp, ev)}
          >Open in App</a>
        {:else}
          {item.archived ? '🗄 Archived' : 'Active'}
        {/if}
      {:else}
        {item[String(col.key)] ?? ''}
      {/if}
    </svelte:fragment>
  </EntityTable>
</div>

<style lang="scss">
  .all-spaces { padding: 1rem 1.25rem; }
  .err { padding: 0.75rem; background: rgba(239,68,68,0.1); color: #b91c1c; border-radius: 0.25rem; margin-bottom: 0.75rem; }
  .badge {
    display: inline-block;
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
    border-radius: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  .badge-v2 {
    background: color-mix(in srgb, #6366f1 16%, transparent);
    color: #4338ca;
    border: 1px solid color-mix(in srgb, #6366f1 25%, transparent);
  }
  .open-in-app {
    font-size: 0.78rem;
    color: var(--theme-link-color, #2563eb);
    text-decoration: none;
    &:hover { text-decoration: underline; }
  }
</style>
