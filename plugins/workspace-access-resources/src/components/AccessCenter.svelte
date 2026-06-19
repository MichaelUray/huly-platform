<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Workspace Access Center root. Uses Huly's design-system primitives
// (Header / Breadcrumb / TabList / Scroller / hulyComponent-content
// layout) so the panel sits visually inside the Settings → Workspace
// Settings shell without bespoke styling.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { Breadcrumb, Header, Scroller, TabList } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
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
  import type { Asset, IntlString } from '@hcengineering/platform'

  export let workspace: string
  export let workspaceLabel: string = workspace
  export let retentionDays: number = 365
  /**
   * Setting plugin's AccessCenter icon + label refs, passed in by the
   * mounting Settings tab so workspace-access-resources stays free of a
   * @hcengineering/setting dependency. Defaults to plain strings if the
   * caller omits them.
   */
  export let headerIcon: Asset | undefined = undefined
  export let headerLabel: IntlString | undefined = undefined

  let assumeOpen: boolean = false
  let active: string = 'my-access'

  const tabLabels: Record<string, string> = {
    people: 'People',
    resources: 'Resources',
    'my-access': 'My Access',
    audit: 'Audit'
  }

  $: tabs = tabsForRole($effectiveRole)
  $: canEdit = canEditRole($effectiveRole)
  $: { if (!tabs.includes(active)) active = tabs[0] ?? 'my-access' }
  $: tabItems = tabs.map((t) => ({ id: t, labelIntl: getEmbeddedLabel(tabLabels[t] ?? t) }))

  onMount(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const from = url.searchParams.get('from')
    if (from === 'admin' && get(impersonationStore).state === 'normal') {
      enterDrillDown(workspace)
    }
  })

  function onTabSelect (e: CustomEvent<{ id: string }>): void {
    active = e.detail.id
  }

  async function exitImpersonation (): Promise<void> {
    await endImpersonation()
    if (typeof window !== 'undefined') {
      window.location.href = '/login/admin/workspaces'
    }
  }
</script>

<div class="hulyComponent" data-test="wac-root">
  <Header adaptive={'disabled'}>
    <Breadcrumb
      icon={headerIcon}
      label={headerLabel ?? getEmbeddedLabel('Workspace Access Center')}
      size={'large'}
      isCurrent
    />
    <svelte:fragment slot="extra">
      <span class="workspace-pill">{workspaceLabel}</span>
    </svelte:fragment>
  </Header>

  <ImpersonationBanner
    on:assumeRole={() => (assumeOpen = true)}
    on:exit={exitImpersonation}
    on:backToAdmin={() => { if (typeof window !== 'undefined') window.location.href = '/login/admin' }}
  />

  <DsgvoFirstOpenBanner {workspace} {retentionDays} />

  <div class="wac-tabs">
    <TabList
      items={tabItems}
      selected={active}
      kind={'plain'}
      on:select={onTabSelect}
    />
  </div>

  <div class="hulyComponent-content__column content">
    <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="hulyComponent-content">
        {#if active === 'people'}
          <PeopleView {workspace} {canEdit} />
        {:else if active === 'resources'}
          <ResourcesView {workspace} canEditFlags={canEdit} canEditMembership={canEdit} />
        {:else if active === 'my-access'}
          <MyAccessView {workspace} />
        {:else if active === 'audit'}
          <AuditView {workspace} canExport={canEdit || $effectiveRole === 'MAINTAINER' || $effectiveRole === 'MAINTAINER_PLUS_SPACE_OWNER'} />
        {/if}
      </div>
    </Scroller>
  </div>

  <AssumeRoleModal
    open={assumeOpen}
    {workspace}
    {workspaceLabel}
    on:close={() => (assumeOpen = false)}
  />

  <ExpiredModal />
</div>

<style lang="scss">
  .wac-tabs {
    padding: 0 var(--spacing-3);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .workspace-pill {
    font-size: 0.85rem;
    color: var(--theme-darker-color);
    padding: 0.2rem 0.6rem;
    background: var(--theme-bg-accent-color);
    border-radius: 0.25rem;
    margin-left: 0.5rem;
  }
</style>
