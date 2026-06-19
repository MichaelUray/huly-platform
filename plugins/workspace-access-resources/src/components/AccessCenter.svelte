<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Workspace Access Center root. Mounts the tab bar + active tab body
// + impersonation banner + DSGVO first-open banner. Listens for the
// `?from=admin` query param on mount to flip the store into
// drill-down state for Instance-Admins.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import TabBar from './TabBar.svelte'
  import PeopleView from './people/PeopleView.svelte'
  import ResourcesView from './resources/ResourcesView.svelte'
  import MyAccessView from './my-access/MyAccessView.svelte'
  import AuditView from './audit/AuditView.svelte'
  import ImpersonationBanner from './impersonation/ImpersonationBanner.svelte'
  import AssumeRoleModal from './impersonation/AssumeRoleModal.svelte'
  import ExpiredModal from './impersonation/ExpiredModal.svelte'
  import DsgvoFirstOpenBanner from './shared/DsgvoFirstOpenBanner.svelte'
  import {
    impersonationStore,
    enterDrillDown,
    endImpersonation
  } from '../stores/impersonationStore'
  import { effectiveRole, tabsForRole, canEdit as canEditRole } from '../stores/roleStore'

  export let workspace: string
  export let workspaceLabel: string = workspace
  export let retentionDays: number = 365

  let assumeOpen: boolean = false
  let active: string = 'my-access'

  $: tabs = tabsForRole($effectiveRole)
  $: canEdit = canEditRole($effectiveRole)
  $: { if (!tabs.includes(active)) active = tabs[0] ?? 'my-access' }

  onMount(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const from = url.searchParams.get('from')
    if (from === 'admin' && get(impersonationStore).state === 'normal') {
      enterDrillDown(workspace)
    }
  })

  function onTabChange (e: CustomEvent<string>): void {
    active = e.detail
  }

  async function exitImpersonation (): Promise<void> {
    await endImpersonation()
    if (typeof window !== 'undefined') {
      window.location.href = '/login/admin/workspaces'
    }
  }
</script>

<div class="wac-root" data-test="wac-root">
  <DsgvoFirstOpenBanner {workspace} {retentionDays} />

  <ImpersonationBanner
    on:assumeRole={() => (assumeOpen = true)}
    on:exit={exitImpersonation}
    on:backToAdmin={() => { if (typeof window !== 'undefined') window.location.href = '/login/admin' }}
  />

  <header class="head">
    <h1>Workspace Access Center</h1>
    <span class="ws">{workspaceLabel}</span>
  </header>

  <TabBar {active} {tabs} on:change={onTabChange} />

  <main class="body">
    {#if active === 'people'}
      <PeopleView {workspace} {canEdit} />
    {:else if active === 'resources'}
      <ResourcesView
        {workspace}
        canEditFlags={canEdit}
        canEditMembership={canEdit}
      />
    {:else if active === 'my-access'}
      <MyAccessView {workspace} />
    {:else if active === 'audit'}
      <AuditView {workspace} canExport={canEdit || $effectiveRole === 'MAINTAINER' || $effectiveRole === 'MAINTAINER_PLUS_SPACE_OWNER'} />
    {/if}
  </main>

  <AssumeRoleModal
    open={assumeOpen}
    {workspace}
    {workspaceLabel}
    on:close={() => (assumeOpen = false)}
  />

  <ExpiredModal />
</div>

<style lang="scss">
  .wac-root {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--theme-bg-color);
    color: var(--theme-content-color);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    padding: 1.25rem 1.25rem 0.75rem;
  }
  .head h1 { margin: 0; font-size: 1.4rem; font-weight: 600; color: var(--theme-caption-color); }
  .ws { color: var(--theme-darker-color); font-size: 0.95rem; }
  .body { flex: 1; }
</style>
