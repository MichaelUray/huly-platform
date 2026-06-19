<script lang="ts">
  import { TabList } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import AllSpacesTab from './AllSpacesTab.svelte'
  import SpaceDrawer from './SpaceDrawer.svelte'

  export let workspace: string
  export let canEditFlags: boolean = false
  export let canEditMembership: boolean = false

  type Sub = 'all' | 'private' | 'public' | 'archived' | 'auto-join'
  let sub: Sub = 'all'
  let drawerSpaceId: string | null = null
  let drawerOpen: boolean = false

  const subItems = [
    { id: 'all', labelIntl: getEmbeddedLabel('All') },
    { id: 'private', labelIntl: getEmbeddedLabel('Private only') },
    { id: 'public', labelIntl: getEmbeddedLabel('Public only') },
    { id: 'archived', labelIntl: getEmbeddedLabel('Archived') },
    { id: 'auto-join', labelIntl: getEmbeddedLabel('Auto-join') }
  ]

  $: preset = (
    sub === 'private' ? { private: true } :
    sub === 'public' ? { private: false } :
    sub === 'archived' ? { archived: true } :
    sub === 'auto-join' ? { autoJoin: true } :
    {}
  )

  function onRowClick (e: CustomEvent<{ spaceId: string }>): void {
    drawerSpaceId = e.detail.spaceId
    drawerOpen = true
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

  <AllSpacesTab {workspace} {preset} on:rowClick={onRowClick} />

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
</style>
