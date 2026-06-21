<script lang="ts">
  import { TabList, showPopup } from '@hcengineering/ui'
  import { MessageBox } from '@hcengineering/presentation'
  import { translate } from '@hcengineering/platform'
  import wac from '../../plugin'
  import AllSpacesTab from './AllSpacesTab.svelte'
  import SpaceDrawer from './SpaceDrawer.svelte'
  import ResourceBulkBar from './ResourceBulkBar.svelte'
  import OwnerPickerModal from './OwnerPickerModal.svelte'
  import { resourcesBulkApi, type ResourceBulkResult } from '../../api/resourcesBulkApi'
  import { peopleApi } from '../../api/peopleApi'
  import type { MemberRow } from '../../types'

  export let workspace: string
  export let canEditFlags: boolean = false
  export let canEditMembership: boolean = false

  // Wave 5 D — bulk-bar is only mounted for operators who can change
  // both flags AND owners (the three bulk actions cover both surfaces).
  $: canBulk = canEditFlags && canEditMembership

  type Sub = 'all' | 'private' | 'public' | 'archived' | 'auto-join'
  let sub: Sub = 'all'
  let drawerSpaceId: string | null = null
  let drawerOpen: boolean = false
  let selectedIds: Set<string> = new Set()
  let lastBulkResult: ResourceBulkResult | null = null
  let lastActionLabel: string = ''
  let error: string | null = null

  const subItems = [
    { id: 'all', labelIntl: wac.string.ResourcesTabAll },
    { id: 'private', labelIntl: wac.string.ResourcesTabPrivate },
    { id: 'public', labelIntl: wac.string.ResourcesTabPublic },
    { id: 'archived', labelIntl: wac.string.ResourcesTabArchived },
    { id: 'auto-join', labelIntl: wac.string.ResourcesTabAutoJoin }
  ]

  $: preset = (
    sub === 'private' ? { private: true } :
    sub === 'public' ? { private: false } :
    sub === 'archived' ? { archived: true } :
    sub === 'auto-join' ? { autoJoin: true } :
    {}
  )

  // Polish-4 — per-sub-tab empty-state copy so filtered views show
  // "No private spaces." rather than the generic "No spaces yet."
  $: emptyLabel = (
    sub === 'private' ? wac.string.EmptyPrivateSpaces :
    sub === 'public' ? wac.string.EmptyPublicSpaces :
    sub === 'archived' ? wac.string.EmptyArchivedSpaces :
    sub === 'auto-join' ? wac.string.EmptyAutoJoinSpaces :
    wac.string.EmptyAllSpaces
  )

  // Clear selection when the sub-tab changes — the visible row-set
  // changes so the operator's previous selection is no longer
  // meaningful.
  $: if (sub !== undefined) {
    selectedIds = new Set()
  }

  function onRowClick (e: CustomEvent<{ spaceId: string }>): void {
    drawerSpaceId = e.detail.spaceId
    drawerOpen = true
  }

  function onSelectionChange (e: CustomEvent<Set<string>>): void {
    selectedIds = e.detail
  }

  async function runBulk (
    label: string,
    exec: (ids: string[]) => Promise<ResourceBulkResult>
  ): Promise<void> {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    try {
      const result = await exec(ids)
      lastActionLabel = label
      lastBulkResult = result
      // Clear selection only when at least one mutation landed; otherwise
      // keep rows selected so the operator can retry without re-picking.
      if (result.applied > 0) {
        selectedIds = new Set()
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function bulkArchive (): Promise<void> {
    const ids = [...selectedIds]
    showPopup(MessageBox, {
      label: wac.string.ConfirmBulkArchiveTitle,
      labelProps: { count: ids.length },
      message: wac.string.ConfirmBulkArchiveMessage,
      dangerous: true,
      action: async () => {
        await runBulk('Archive', async (sIds) => await resourcesBulkApi.bulkArchive(workspace, sIds))
      }
    })
  }

  async function bulkSetPrivate (): Promise<void> {
    const ids = [...selectedIds]
    showPopup(MessageBox, {
      label: wac.string.ConfirmBulkSetPrivateTitle,
      labelProps: { count: ids.length },
      message: wac.string.ConfirmBulkSetPrivateMessage,
      dangerous: false,
      action: async () => {
        await runBulk('Make Private', async (sIds) => await resourcesBulkApi.bulkSetPrivate(workspace, sIds, true))
      }
    })
  }

  async function bulkTransferOwner (): Promise<void> {
    const ids = [...selectedIds]
    // Step 1: pick the new owner (modal lists workspace members).
    // Step 2: confirm with a MessageBox that quotes the resolved name.
    // Step 3: run the bulk-add-owner call.
    showPopup(OwnerPickerModal, {
      workspace,
      onPick: async (ownerUuid: string) => {
        let ownerName = ownerUuid
        try {
          const r = await peopleApi.listMembers(workspace, { filter: { uuid: ownerUuid }, limit: 1 })
          const m = r.items[0] as MemberRow | undefined
          if (m != null) ownerName = m.name
        } catch { /* fall back to uuid */ }
        showPopup(MessageBox, {
          label: wac.string.ConfirmBulkAddOwnerTitle,
          labelProps: { count: ids.length },
          message: wac.string.ConfirmBulkAddOwnerMessage,
          params: { name: ownerName },
          dangerous: false,
          action: async () => {
            await runBulk(
              await translate(wac.string.BulkTransferOwner, {}),
              async (sIds) => await resourcesBulkApi.bulkAddOwner(workspace, sIds, ownerUuid)
            )
          }
        })
      }
    })
  }
</script>

<div class="resources-view" id="wac-panel-resources" role="tabpanel">
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

  <!-- Bulk-bar rendered ABOVE the list and ALWAYS visible (dimmed when
       nothing is selected) so the table does not shift on first / last
       row toggle. Only mounted for editors who can change BOTH flags
       AND membership; the three actions cover both surfaces. -->
  {#if canBulk}
    <ResourceBulkBar
      count={selectedIds.size}
      {lastBulkResult}
      {lastActionLabel}
      on:deselectAll={() => (selectedIds = new Set())}
      on:archive={bulkArchive}
      on:setPrivate={bulkSetPrivate}
      on:transferOwner={bulkTransferOwner}
      on:dismissBulkResult={() => (lastBulkResult = null)}
    />
  {/if}

  <AllSpacesTab
    {workspace}
    {preset}
    {emptyLabel}
    selectable={canBulk}
    {selectedIds}
    on:rowClick={onRowClick}
    on:selectionChange={onSelectionChange}
  />

  <SpaceDrawer
    {workspace}
    spaceId={drawerSpaceId}
    open={drawerOpen}
    {canEditFlags}
    {canEditMembership}
    on:close={() => { drawerOpen = false; drawerSpaceId = null }}
  />
</div>

<style lang="scss">
  .resources-view { display: flex; flex-direction: column; min-height: 100%; }
  .sub-tabs {
    padding: var(--spacing-1) 0 var(--spacing-2);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .err {
    margin: var(--spacing-1) var(--spacing-2);
    padding: 0.5rem;
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border-radius: 0.25rem;
  }
</style>
