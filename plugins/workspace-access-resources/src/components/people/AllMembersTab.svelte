<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// People > All Members: paginated table backed by peopleApi.listMembers.
// Drawer opens on row click. Selection (for bulk actions) is delegated
// up via the `selection` event and rendered by the parent PeopleView.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, Label } from '@hcengineering/ui'
  import type { IntlString } from '@hcengineering/platform'
  import { EntityTable, type EntityColumn } from '@hcengineering/access-management-ui'
  import wac from '../../plugin'
  import { peopleApi } from '../../api/peopleApi'
  import type { MemberRow } from '../../types'

  export let workspace: string
  export let preset: Record<string, unknown> = {}
  export let selectable: boolean = true
  export let selectedIds: Set<string> = new Set()
  // Polish-4 — sub-tab-specific empty-state label (defaults to the
  // generic All-Members copy). ByRole + Inactive override this.
  export let emptyLabel: IntlString = wac.string.EmptyAllMembers

  const dispatch = createEventDispatcher<{ rowClick: { uuid: string }, selectionChange: Set<string> }>()

  let items: MemberRow[] = []
  let cursor: string | null = null
  let loading: boolean = true
  let loadingMore: boolean = false
  let error: string | null = null
  let sort: { field: string, direction: 'asc' | 'desc' } | undefined

  const columns: EntityColumn<MemberRow>[] = [
    { key: 'name', label: 'Name' as any, sort: true },
    { key: 'role', label: 'Role' as any, sort: true, width: 140 },
    { key: 'activityBucket', label: 'Last activity' as any, sort: true, width: 160 },
    { key: 'spacesCount', label: 'Spaces' as any, sort: true, width: 100 }
  ]

  // 2026-06-25 H1 fix — apply the sub-tab preset filter client-side.
  // Pre-fix the preset (`{ activityBucketIn: ['90d+'] }` for Inactive,
  // role filters for By-role, etc.) was passed to the backend but
  // handleMembers ignored it, so every sub-tab returned the same full
  // member list. Filtering here is the smaller surgical fix; the
  // backend filter can land later without changing the contract
  // because the keys and values match what handleMembers would
  // consume (the preset shape is the same on both sides).
  function applyPresetFilter (rows: MemberRow[]): MemberRow[] {
    if (Object.keys(preset).length === 0) return rows
    return rows.filter((r) => {
      for (const [key, want] of Object.entries(preset)) {
        if (key === 'activityBucketIn' && Array.isArray(want)) {
          if (!want.includes(r.activityBucket)) return false
          continue
        }
        if (key === 'roleIn' && Array.isArray(want)) {
          if (!want.includes(r.role)) return false
          continue
        }
        // Generic equality fallback for future keys.
        if ((r as any)[key] !== want) return false
      }
      return true
    })
  }

  async function refresh (): Promise<void> {
    loading = true
    error = null
    try {
      const res = await peopleApi.listMembers(workspace, { filter: preset, sort: sort?.field })
      items = applyPresetFilter(res.items)
      cursor = res.cursor
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  // Polish-3 — page through additional members using the opaque `cursor`
  // returned by listMembers. Selection is preserved across loads: the
  // parent PeopleView holds `selectedIds` and we never reset it here.
  async function loadNext (): Promise<void> {
    if (cursor == null || loadingMore) return
    loadingMore = true
    error = null
    try {
      const res = await peopleApi.listMembers(workspace, {
        filter: preset,
        sort: sort?.field,
        cursor
      })
      // 2026-06-25 H1 — same client-side preset filter as refresh().
      // Without this the paginated tail would still spill un-filtered
      // rows into Inactive (90d+) etc.
      items = [...items, ...applyPresetFilter(res.items)]
      cursor = res.cursor
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loadingMore = false
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
    <svelte:fragment slot="empty">
      <Label label={emptyLabel} />
    </svelte:fragment>
    <svelte:fragment slot="cell" let:item let:col>
      {#if String(col.key) === 'role'}
        <span class="role role-{(item.role || '').toLowerCase().replace(/_/g, '-')}">
          {#if item.role === 'READONLY_GUEST'}Read-only Guest
          {:else if item.role === 'DOC_GUEST'}Doc Guest
          {:else}{item.role}{/if}
        </span>
      {:else if String(col.key) === 'activityBucket'}
        <span class="bucket bucket-{item.activityBucket}">{item.activityBucket}</span>
      {:else}
        {item[String(col.key)] ?? ''}
      {/if}
    </svelte:fragment>
  </EntityTable>
  {#if cursor != null && !loading}
    <div class="load-more">
      <Button
        kind={'ghost'}
        size={'small'}
        label={wac.string.LoadMore}
        loading={loadingMore}
        disabled={loadingMore}
        on:click={loadNext}
      />
    </div>
  {/if}
</div>

<style lang="scss">
  .all-members-tab { padding: 1rem 1.25rem; }
  .load-more {
    display: flex;
    justify-content: center;
    padding: 0.75rem 0 0;
  }
  .err {
    padding: 0.75rem;
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border-radius: 0.25rem;
    margin-bottom: 0.75rem;
  }
  .role { font-size: 0.78rem; padding: 0.1rem 0.45rem; border-radius: 0.25rem; }
  /* C5 — Role badges use Huly theme tokens.
     OWNER → "warning"-family (amber) so the privileged role stands out.
     MAINTAINER → mention-family (blue) — clearly different from OWNER but
     still positive/empowered.
     USER → neutral divider/darker (the previous baseline).
     GUEST + sub-roles → all share the neutral-grey family; the visual
     distinction between READONLY_GUEST and DOC_GUEST is intentional only
     in label text, since they carry the same capability bucket in v1. */
  .role-owner {
    background: var(--theme-warning-color, var(--theme-state-positive-background-color));
    color: var(--theme-caption-color);
  }
  .role-maintainer {
    background: var(--theme-mention-bg-color);
    color: var(--theme-link-color);
  }
  .role-user { background: var(--theme-divider-color); color: var(--theme-darker-color); }
  .role-guest { background: var(--theme-divider-color); color: var(--theme-darker-color); }
  .role-readonly-guest { background: var(--theme-divider-color); color: var(--theme-darker-color); }
  .role-doc-guest { background: var(--theme-divider-color); color: var(--theme-darker-color); }
  .bucket { font-size: 0.8rem; color: var(--theme-darker-color); }
  .bucket-today { color: var(--theme-state-positive-color); font-weight: 500; }
  .bucket-90d\+ { color: var(--theme-state-negative-color); }
</style>
