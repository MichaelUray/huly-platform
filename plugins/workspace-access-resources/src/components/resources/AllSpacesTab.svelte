<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, EditBox, Label } from '@hcengineering/ui'
  import type { IntlString } from '@hcengineering/platform'
  import { EntityTable, type EntityColumn } from '@hcengineering/access-management-ui'
  import wac from '../../plugin'
  import { resourcesApi } from '../../api/resourcesApi'
  import SpaceTypeIcon from './SpaceTypeIcon.svelte'
  import InheritanceTreeModal from './InheritanceTreeModal.svelte'
  import type { SpaceRow } from '../../types'

  export let workspace: string
  export let preset: Record<string, unknown> = {}
  // Polish-4 — caller-supplied empty-state label so each Resources
  // sub-tab can surface a contextually meaningful message even though
  // the v2-placeholder rows mean items.length is normally non-zero;
  // archived/private/etc. filtered views can still come up empty.
  export let emptyLabel: IntlString = wac.string.EmptyAllSpaces
  // Wave 5 D — selection state for the Resources bulk-bar. When
  // `selectable=true`, EntityTable renders the row-checkbox column;
  // selection changes are forwarded via the `selectionChange` event.
  // The set is filtered server-side to NEVER include v2-placeholder
  // rows so the bulk endpoint never tries to mutate them.
  export let selectable: boolean = false
  export let selectedIds: Set<string> = new Set()

  const dispatch = createEventDispatcher<{
    rowClick: { spaceId: string }
    selectionChange: Set<string>
  }>()

  let spaces: SpaceRow[] = []
  let loading: boolean = true
  let error: string | null = null
  let sort: { field: string, direction: 'asc' | 'desc' } | undefined
  // A3 — client-side search over already-loaded spaces. Matches
  // case-insensitively on `name` and as prefix on `_id` so operators
  // can paste a known UUID prefix and still find the space. The v2
  // placeholder rows (chat/office/guest-link) are sticky info-rows and
  // are NOT filtered — they always appear at the end of the list.
  let searchQuery: string = ''
  // A4 — read-only inheritance visualizer modal. Toggled by the
  // "View hierarchy" button in the toolbar.
  let showHierarchy: boolean = false

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
      spaces = res.items
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  // A3 — reactive client-side filter. Empty query returns the full
  // list. Filtering is case-insensitive on `name` (contains) and on
  // `_id` (prefix-only — IDs are UUIDs so substring matches deep in
  // the middle would be noisy). v2-placeholder rows are appended last,
  // always, regardless of the query — they are sticky info rows about
  // resource families that don't have a v2 surface yet.
  $: filteredSpaces = (() => {
    const q = searchQuery.trim().toLowerCase()
    const real: SpaceRow[] = q === ''
      ? spaces
      : spaces.filter((s) =>
        s.name.toLowerCase().includes(q) || s._id.toLowerCase().startsWith(q)
      )
    return [...real, ...v2Placeholders]
  })()

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

  // Strip v2-placeholder rows from selection BEFORE bubbling up so the
  // bulk-bar can never enqueue a placeholder id (it would 404 on the
  // server with `space_not_found`).
  function onSelectionChange (e: CustomEvent<{ ids: Set<string> }>): void {
    const placeholders = new Set(v2Placeholders.map((p) => p._id))
    const filtered = new Set<string>()
    for (const id of e.detail.ids) {
      if (!placeholders.has(id)) filtered.add(id)
    }
    selectedIds = filtered
    dispatch('selectionChange', filtered)
  }

  function openInApp (url: string | null | undefined, ev: Event): void {
    ev.stopPropagation()
    if (url == null || typeof window === 'undefined') return
    window.location.href = url
  }
</script>

<div class="all-spaces">
  <div class="toolbar">
    <div class="search-box">
      <EditBox
        bind:value={searchQuery}
        placeholder={wac.string.ResourceSearchPlaceholder}
        kind={'search-style'}
      />
    </div>
    <Button
      kind={'ghost'}
      size={'small'}
      label={wac.string.ViewHierarchy}
      on:click={() => (showHierarchy = true)}
      dataId={'wac-view-hierarchy'}
    />
  </div>
  {#if error != null}<div class="err" role="alert">{error}</div>{/if}
  <EntityTable items={filteredSpaces} {columns} {loading} {sort} idKey="_id"
    {selectable} {selectedIds}
    on:sort={onSort} on:rowClick={onRowClick} on:selectionChange={onSelectionChange}>
    <svelte:fragment slot="empty">
      <Label label={emptyLabel} />
    </svelte:fragment>
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

{#if showHierarchy}
  <!-- Hierarchy visualizer shows the full loaded `spaces` list,
       intentionally NOT the search-filtered subset — the overview
       question "where does access come from?" needs the whole tree
       regardless of any narrowing the operator did in the table. -->
  <InheritanceTreeModal
    {workspace}
    {spaces}
    on:close={() => (showHierarchy = false)}
  />
{/if}

<style lang="scss">
  .all-spaces { padding: 1rem 1.25rem; }
  .toolbar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .search-box {
    flex: 0 0 18rem;
    padding: 0.25rem 0.5rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
  .err {
    padding: 0.75rem;
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border-radius: 0.25rem;
    margin-bottom: 0.75rem;
  }
  .badge {
    display: inline-block;
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
    border-radius: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  /* C5 — "v2 coming soon" badge uses Huly's mention-blue family so it
     reads as informational, not warning. */
  .badge-v2 {
    background: var(--theme-mention-bg-color);
    color: var(--theme-link-color);
    border: 1px solid var(--theme-divider-color);
  }
  .open-in-app {
    font-size: 0.78rem;
    color: var(--theme-link-color);
    text-decoration: none;
    &:hover { text-decoration: underline; }
  }
</style>
