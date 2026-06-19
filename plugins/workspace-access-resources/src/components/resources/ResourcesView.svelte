<script lang="ts">
  import AllSpacesTab from './AllSpacesTab.svelte'
  import SpaceDrawer from './SpaceDrawer.svelte'

  export let workspace: string
  export let canEditFlags: boolean = false
  export let canEditMembership: boolean = false

  type Sub = 'all' | 'private' | 'public' | 'archived' | 'auto-join'
  let sub: Sub = 'all'
  let drawerSpaceId: string | null = null
  let drawerOpen: boolean = false

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
  <div class="sub-tabs" role="tablist">
    <button class:active={sub === 'all'} role="tab" aria-selected={sub === 'all'} data-test="res-sub-all" on:click={() => (sub = 'all')}>All</button>
    <button class:active={sub === 'private'} role="tab" aria-selected={sub === 'private'} data-test="res-sub-private" on:click={() => (sub = 'private')}>Private only</button>
    <button class:active={sub === 'public'} role="tab" aria-selected={sub === 'public'} data-test="res-sub-public" on:click={() => (sub = 'public')}>Public only</button>
    <button class:active={sub === 'archived'} role="tab" aria-selected={sub === 'archived'} data-test="res-sub-archived" on:click={() => (sub = 'archived')}>Archived</button>
    <button class:active={sub === 'auto-join'} role="tab" aria-selected={sub === 'auto-join'} data-test="res-sub-autojoin" on:click={() => (sub = 'auto-join')}>Auto-join</button>
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
  .sub-tabs { display: flex; gap: 0.25rem; padding: 0.5rem 1.25rem; border-bottom: 1px solid var(--theme-divider-color); }
  .sub-tabs button {
    background: transparent; border: 0;
    padding: 0.4rem 0.8rem; cursor: pointer;
    color: var(--theme-darker-color);
    border-radius: 0.25rem;
    font-size: 0.9rem;
    &:hover { background: var(--theme-bg-accent-color); }
    &.active { background: var(--theme-bg-accent-color); color: var(--theme-caption-color); font-weight: 500; }
  }
</style>
