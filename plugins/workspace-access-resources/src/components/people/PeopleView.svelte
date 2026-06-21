<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// People view container with sub-tabs and shared bulk-action bar.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { TabList } from '@hcengineering/ui'
  import { translate } from '@hcengineering/platform'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import wac from '../../plugin'
  import AllMembersTab from './AllMembersTab.svelte'
  import ByRoleTab from './ByRoleTab.svelte'
  import InactiveTab from './InactiveTab.svelte'
  import PendingInvitesTab from './PendingInvitesTab.svelte'
  import GrantedAccessTab from './GrantedAccessTab.svelte'
  import PersonDrawer from './PersonDrawer.svelte'
  import PeopleBulkBar from './PeopleBulkBar.svelte'
  import { peopleApi, type BulkRoleResult } from '../../api/peopleApi'
  import { grantedAccessApi } from '../../api/grantedAccessApi'
  import type { MemberRow, WorkspaceRole } from '../../types'

  export let workspace: string
  export let canEdit: boolean = false

  type Tab = 'all' | 'by-role' | 'inactive' | 'granted' | 'pending'

  let sub: Tab = 'all'
  let selectedIds: Set<string> = new Set()
  let drawerPerson: { uuid: string; name: string; role: WorkspaceRole } | null = null
  let drawerOpen: boolean = false
  let allMembers: MemberRow[] = []
  let grantsCount: number = 0
  let error: string | null = null
  // Wave 5 C1 — last bulk-role outcome surfaced via the BulkBar's
  // per-target result banner. Server now always returns 200 with a
  // `results[]` array (see writeRouter.ts handleBulkMemberRole); we
  // hand it straight to PeopleBulkBar which summarizes + renders.
  let lastBulkRoleResult: BulkRoleResult | null = null

  // TabList does not forward per-item `params` to the underlying
  // Label component. Translate the "Granted access" base label
  // eagerly and append the count as a numeric suffix outside the
  // ICU layer to avoid an "intl context variable 'count' not
  // provided" runtime error.
  let grantedAccessBaseLabel: string = 'Granted access'
  $: void translate(wac.string.PeopleTabGrantedAccess, {}).then((s) => {
    grantedAccessBaseLabel = s
  })

  $: subItems = [
    { id: 'all', labelIntl: wac.string.PeopleTabAll },
    { id: 'by-role', labelIntl: wac.string.PeopleTabByRole },
    { id: 'inactive', labelIntl: wac.string.PeopleTabInactive },
    ...(grantsCount > 0
      ? [{ id: 'granted', label: getEmbeddedLabel(`${grantedAccessBaseLabel} (${grantsCount})`) }]
      : []),
    { id: 'pending', labelIntl: wac.string.PeopleTabPending }
  ]

  async function loadGrantsCount (): Promise<void> {
    try {
      grantsCount = await grantedAccessApi.countGrants(workspace)
    } catch {
      grantsCount = 0
    }
  }

  onMount(loadGrantsCount)

  async function onRowClick (e: CustomEvent<{ uuid: string }>): Promise<void> {
    const uuid = e.detail.uuid
    // Look up the row from the most recent list result; if not in cache,
    // fall back to a tiny one-off fetch via filter.
    let row = allMembers.find((m) => m.uuid === uuid)
    if (row == null) {
      try {
        const r = await peopleApi.listMembers(workspace, { filter: { uuid }, limit: 1 })
        row = r.items[0]
      } catch {
        return
      }
    }
    if (row != null) {
      drawerPerson = { uuid: row.uuid, name: row.name, role: row.role }
      drawerOpen = true
    }
  }

  function onSelection (e: CustomEvent<Set<string>>): void {
    selectedIds = e.detail
  }

  async function bulkAdd (): Promise<void> {
    const space = window.prompt('Space-ID to add selected members to')
    if (space == null || space === '') return
    try {
      await peopleApi.bulkAddToSpace(workspace, [...selectedIds], space)
      selectedIds = new Set()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function bulkRemove (): Promise<void> {
    const space = window.prompt('Space-ID to remove selected members from')
    if (space == null || space === '') return
    try {
      await peopleApi.bulkRemoveFromSpace(workspace, [...selectedIds], space)
      selectedIds = new Set()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function bulkRole (e: CustomEvent<{ role: WorkspaceRole }>): Promise<void> {
    if (!confirm(`Change role of ${selectedIds.size} selected member(s) to ${e.detail.role}?`)) return
    try {
      // Server contract: always 200 with {batch_id, appliedCount, results[]}.
      // The 409 "would empty owner set entirely" still throws via WacClient
      // and lands in the catch — that's the only path that yields a hard
      // error string. Partial outcomes are routed through the bulk-bar
      // banner.
      const result = await peopleApi.bulkChangeRole(workspace, [...selectedIds], e.detail.role)
      lastBulkRoleResult = result
      // Clear selection only when at least one mutation landed; otherwise
      // keep the rows selected so the operator can retry without re-picking.
      if (result.appliedCount > 0) {
        selectedIds = new Set()
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }
</script>

<div class="people-view" id="wac-panel-people" role="tabpanel">
  <div class="sub-tabs">
    <TabList
      items={subItems}
      selected={sub}
      kind={'separated'}
      size={'small'}
      on:select={(e) => { sub = e.detail.id }}
    />
  </div>

  {#if error != null}<div class="err" role="alert">{error}</div>{/if}

  {#if sub === 'all'}
    <AllMembersTab {workspace} {selectedIds} on:rowClick={onRowClick} on:selectionChange={onSelection} />
  {:else if sub === 'by-role'}
    <ByRoleTab {workspace} on:rowClick={onRowClick} on:selectionChange={onSelection} />
  {:else if sub === 'inactive'}
    <InactiveTab {workspace} on:rowClick={onRowClick} on:selectionChange={onSelection} />
  {:else if sub === 'granted'}
    <GrantedAccessTab {workspace} canRevoke={canEdit} on:revoked={loadGrantsCount} />
  {:else if sub === 'pending'}
    <PendingInvitesTab {workspace} />
  {/if}

  {#if canEdit}
    <PeopleBulkBar count={selectedIds.size}
      {lastBulkRoleResult}
      on:deselectAll={() => (selectedIds = new Set())}
      on:addToSpace={bulkAdd}
      on:removeFromSpace={bulkRemove}
      on:changeRole={bulkRole}
      on:dismissBulkResult={() => (lastBulkRoleResult = null)}
    />
  {/if}

  <PersonDrawer
    {workspace}
    person={drawerPerson}
    open={drawerOpen}
    canEdit={canEdit}
    on:close={() => { drawerOpen = false; drawerPerson = null }}
    on:changed={() => { /* parent table will refresh on next sub-tab switch */ }}
  />
</div>

<style lang="scss">
  .people-view { display: flex; flex-direction: column; min-height: 100%; }
  .sub-tabs {
    padding: var(--spacing-1) 0 var(--spacing-2);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .err {
    margin: var(--spacing-1_5) 0;
    padding: var(--spacing-1);
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border-radius: 0.25rem;
  }
</style>
