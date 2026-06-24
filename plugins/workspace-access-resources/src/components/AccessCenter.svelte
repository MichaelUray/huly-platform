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
  import wac from '../plugin'
  // `getEmbeddedLabel` is retained as the dynamic fallback for tab ids
  // that have no registered IntlString — see `tabItems` below.
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
  import {
    roleStore,
    effectiveRole,
    tabsForRole,
    canEdit as canEditRole,
    canReadWorkspaceWide as canReadWWRole
  } from '../stores/roleStore'
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
  /**
   * Phase 2 T1 — legacy Settings entries (`/setting/owners`,
   * `/setting/guestPermissions`, `/setting/allSpaces`) consolidated into
   * Access Center. The compat-shim components pass `initialTab` (and
   * optionally `initialSub`) so the right tab is selected on first
   * mount. If the requested tab is not in the role-filtered `tabs`
   * array the existing safety net at the `tabs.includes(active)` guard
   * falls back to `tabs[0]`.
   */
  export let initialTab: string | undefined = undefined
  export let initialSub: string | undefined = undefined

  let assumeOpen: boolean = false
  let active: string = initialTab ?? 'my-access'

  // H4 — tab labels via IntlString (registered in plugin.ts, translated
  // in lang/<locale>.json). Fallback to embedded label if a future tab id
  // is added without a corresponding string.
  const tabLabelIntl: Record<string, IntlString> = {
    people: wac.string.People,
    resources: wac.string.Resources,
    'my-access': wac.string.MyAccess,
    audit: wac.string.Audit
  }

  $: tabs = tabsForRole($effectiveRole)
  $: canEdit = canEditRole($effectiveRole)
  // Read-only banner triggers when the user can SEE workspace-wide
  // surfaces but cannot edit them. The classic MAINTAINER case; also
  // covers INSTANCE_ADMIN_READONLY drill-down.
  $: readOnlyMode = !canEdit && canReadWWRole($effectiveRole)
  // Audit CSV export is admin-only on the backend (Phase 1 Task 2);
  // hide the button for everyone but OWNER / IMPERSONATING_ADMIN so the
  // UI does not promise something the server will 403.
  $: canExportAudit = canEdit
  $: { if (tabs.length > 0 && !tabs.includes(active)) active = tabs[0] }
  $: tabItems = tabs.map((t) => ({
    id: t,
    labelIntl: tabLabelIntl[t] ?? getEmbeddedLabel(t)
  }))

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
      label={headerLabel ?? wac.string.AccessCenter}
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

  {#if !$roleStore.hydrated}
    <!-- Defensive: parent AccessCenterPage already waits for hydration,
         but if anyone mounts AccessCenter directly we still render a
         safe loading placeholder rather than edit affordances. -->
    <div class="status-block" data-test="wac-loading">
      <em>Loading…</em>
    </div>
  {:else if tabs.length === 0}
    <!-- GUEST or otherwise denied: backend already returns 403, this
         block keeps the surface from appearing empty. -->
    <div class="status-block no-access" role="status" data-test="wac-no-access">
      <p>You do not have access to this workspace's Access Center.</p>
    </div>
  {:else}
    {#if readOnlyMode}
      <div class="readonly-banner" role="status" data-test="wac-readonly-banner">
        You're viewing in read-only mode (your role: {$roleStore.workspaceRole}). Only Owners can edit.
      </div>
    {/if}

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
            <PeopleView {workspace} {canEdit} {initialSub} />
          {:else if active === 'resources'}
            <ResourcesView {workspace} canEditFlags={canEdit} canEditMembership={canEdit} />
          {:else if active === 'my-access'}
            <MyAccessView {workspace} />
          {:else if active === 'audit'}
            <AuditView {workspace} canExport={canExportAudit} />
          {/if}
        </div>
      </Scroller>
    </div>
  {/if}

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
  .readonly-banner {
    margin: var(--spacing-1) var(--spacing-3);
    padding: var(--spacing-1) var(--spacing-2);
    background: var(--theme-warning-color, rgba(234, 179, 8, 0.12));
    color: var(--theme-caption-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    font-size: 0.85rem;
  }
  .status-block {
    padding: 1.5rem;
    color: var(--theme-darker-color);
  }
  .status-block.no-access {
    margin: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-bg-accent-color);
  }
</style>
