<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Settings → Access Center entry point. Reads the active workspace
// from the current location and mounts the workspace-access-resources
// AccessCenter root component.
//
// Wave 7 / B4 — live cache invalidation:
//   * subscribe to `core.space.Workspace` doc updates via createQuery;
//     any update triggers a `myAccessApi.getSummary` refetch
//     (server/account-service writes a `wacInvalidationTick` marker
//     after every role mutation; the transactor broadcasts the
//     TxUpdateDoc).
//   * also refetch on client reconnect (`addRefreshListener`); this
//     recovers updates we missed during a WebSocket gap.
//   * refetches are throttled to 1 per 2s — the marker write fires
//     once per affected account during bulk role changes, so a
//     burst is realistic and the snapshot is idempotent.
//   * if the refetched role is LOWER than the previous in-memory role
//     show a non-dismissable banner with a Reload button. This is the
//     only safe recovery for a demotion because Svelte components
//     elsewhere may have already painted edit affordances against the
//     stale store.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import core from '@hcengineering/core'
  import { getCurrentLocation, Label } from '@hcengineering/ui'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { addRefreshListener, createQuery } from '@hcengineering/presentation'
  import {
    AccessCenter,
    setDefaultWacClient,
    setRegularTokenGetter,
    WacClient,
    getEffectiveBearerToken,
    roleStore,
    myAccessApi,
    wac,
    makeThrottle,
    isDemote,
    ACCESS_REFETCH_INTERVAL_MS
  } from '@hcengineering/workspace-access-resources'
  import type { WorkspaceRole } from '@hcengineering/workspace-access-resources'
  import setting from '../plugin'

  // Phase 2 T1 — the legacy `/setting/owners`, `/setting/guestPermissions`
  // and `/setting/allSpaces` deep-links mount this page indirectly via
  // thin shim components (Members.svelte, GuestPermissionsSettings.svelte,
  // Spaces.svelte). Each shim passes the appropriate `initialTab` (and
  // optionally `initialSub`) so the right Access Center surface is
  // selected on first paint.
  export let initialTab: string | undefined = undefined
  export let initialSub: string | undefined = undefined

  let workspace: string = ''
  let workspaceLabel: string = ''
  let loading: boolean = true
  let loadError: string | null = null
  let demoted: boolean = false

  const query = createQuery()
  const refetchThrottle = makeThrottle(ACCESS_REFETCH_INTERVAL_MS)

  let subscribed: boolean = false

  onMount(() => {
    const loc = getCurrentLocation()
    workspace = loc.path[1] ?? ''
    workspaceLabel = workspace
    // A3 — Register the regular workspace-token source ONCE so
    // `getEffectiveBearerToken` (called by the default WacClient's
    // `getToken` hook + by the CSV export button) can fall back to
    // `presentation.metadata.Token` when no impersonation session is
    // active. Importing presentation here (not from wacClient.ts)
    // keeps the resources-package jest tests free of Svelte module
    // deps.
    setRegularTokenGetter(() => (getMetadata(presentation.metadata.Token) as string | undefined) ?? null)
    // Wire the default WAC client. `getEffectiveBearerToken` reads
    // `sessionStorage['wac:imp:token']` first (A3 impersonation flow)
    // and falls back to the registered regular-token getter. This
    // single hook covers every WAC API client (myAccess/people/
    // resources/audit/grantedAccess) because they all route through
    // the default WacClient.
    setDefaultWacClient(
      new WacClient({
        getToken: () => getEffectiveBearerToken() ?? null
      })
    )
    if (workspace !== '') {
      void hydrateRole()
      // Subscribe to workspace Space-doc updates. The callback fires on
      // initial-snapshot AND on every subsequent TxUpdateDoc — we use
      // the latter as our cache-invalidation trigger. The throttle in
      // `refetch` swallows the initial-snapshot fire (it lands within
      // ~ms of hydrateRole's own request) so we don't double-fetch on
      // mount.
      query.query(core.class.Space, { _id: core.space.Workspace }, () => {
        void refetch('workspace-doc-update')
      })
      subscribed = true
      // Reconnect-event as secondary trigger. `addRefreshListener` is
      // called by `refreshClient` in @hcengineering/presentation on
      // ClientConnectEvent.Connected/Refresh after a reconnect — the
      // proper public hook (no need to monkey-patch the client's
      // `onConnect` field).
      const listener = (): void => {
        void refetch('reconnect')
      }
      // presentation does not currently expose a `removeRefreshListener`
      // (the underlying Set is module-private). The listener is therefore
      // attached for the lifetime of the page tab — that's acceptable
      // because (a) the listener is a cheap no-op when the page isn't
      // mounted (refetch early-exits on `workspace === ''`), (b) the
      // throttle prevents redundant /my-access calls during a reconnect
      // storm, and (c) the request is idempotent server-side. If a
      // future presentation revision exposes the remove API, wire it
      // up in onDestroy.
      addRefreshListener(listener)
    } else {
      loading = false
    }
  })

  onDestroy(() => {
    if (subscribed) {
      query.unsubscribe()
      subscribed = false
    }
  })

  async function hydrateRole (): Promise<void> {
    loading = true
    loadError = null
    // Until the snapshot lands, force the store to the safe `GUEST`
    // baseline with `hydrated: false`. Downstream consumers MUST treat
    // an un-hydrated store as "render nothing privileged".
    roleStore.set({ workspaceRole: 'GUEST', ownedSpaceIds: [], hydrated: false })
    try {
      const snapshot = await myAccessApi.getSummary(workspace)
      const ownedSpaceIds = (snapshot.spacesOwned ?? []).map((s) => s._id)
      roleStore.set({
        workspaceRole: snapshot.role,
        ownedSpaceIds,
        hydrated: true
      })
      // Seed the throttle so the immediate workspace-doc-update fire
      // that the createQuery snapshot triggers does not cause a
      // duplicate refetch.
      refetchThrottle.mark()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
      // On error we explicitly do NOT default to OWNER (or any other
      // privilege level). Leave the store at the GUEST baseline with
      // `hydrated: false` so the UI surfaces the retry banner instead
      // of silently rendering edit affordances we can't justify.
      roleStore.set({ workspaceRole: 'GUEST', ownedSpaceIds: [], hydrated: false })
    } finally {
      loading = false
    }
  }

  /**
   * Re-fetch the my-access snapshot and re-hydrate `roleStore`.
   * Throttled to 1 per ACCESS_REFETCH_INTERVAL_MS. If the new role is
   * STRICTLY LOWER than the previous snapshot, set `demoted=true` so
   * the non-dismissable banner renders.
   *
   * Errors are logged and swallowed; a refetch failure must not break
   * the page (the existing roleStore stays in place — same semantic
   * as the page being briefly offline).
   */
  async function refetch (reason: string): Promise<void> {
    if (workspace === '') return
    if (!refetchThrottle.canRun()) return
    refetchThrottle.mark()
    let prevRole: WorkspaceRole | undefined
    const unsubscribe = roleStore.subscribe((v) => {
      prevRole = v.hydrated ? v.workspaceRole : undefined
    })
    unsubscribe()
    try {
      const snapshot = await myAccessApi.getSummary(workspace)
      const ownedSpaceIds = (snapshot.spacesOwned ?? []).map((s) => s._id)
      roleStore.set({
        workspaceRole: snapshot.role,
        ownedSpaceIds,
        hydrated: true
      })
      if (isDemote(prevRole, snapshot.role)) {
        demoted = true
      }
    } catch (e) {
      // Refetch failure: keep the existing store; surface a console
      // breadcrumb so an operator can grep `wac_role_refetch_failed`
      // if a user reports stale capabilities.
      console.warn('wac_role_refetch_failed', { reason, err: e instanceof Error ? e.message : String(e) })
    }
  }

  function reloadPage (): void {
    if (typeof location !== 'undefined' && typeof location.reload === 'function') {
      location.reload()
    }
  }
</script>

{#if demoted}
  <div class="banner-demoted" role="alert" data-test="wac-demoted-banner">
    <p class="message"><Label label={wac.string.AccessChangedBanner} /></p>
    <button class="reload" on:click={reloadPage} data-test="wac-demoted-reload">
      <Label label={wac.string.Reload} />
    </button>
  </div>
{/if}

{#if workspace === ''}
  <p class="hint">No workspace context.</p>
{:else if loading}
  <div class="status-block" data-test="wac-page-loading">
    <p><Label label={wac.string.LoadingAccessCenter} /></p>
  </div>
{:else if loadError !== null}
  <div class="status-block error" data-test="wac-page-error">
    <p class="title"><Label label={wac.string.LoadWorkspaceRoleError} /></p>
    <p class="detail">{loadError}</p>
    <button class="retry" on:click={hydrateRole}><Label label={wac.string.Retry} /></button>
  </div>
{:else}
  <AccessCenter
    {workspace}
    {workspaceLabel}
    retentionDays={365}
    headerIcon={setting.icon.AccessCenter}
    headerLabel={setting.string.AccessCenter}
    {initialTab}
    {initialSub}
  />
{/if}

<style lang="scss">
  .hint {
    padding: 1.5rem;
    color: var(--theme-darker-color);
  }
  .banner-demoted {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    margin: 0;
    background: var(--theme-warning-color, #d97706);
    color: var(--theme-on-warning-color, #fff);
    border-bottom: 1px solid var(--theme-divider-color);
    font-weight: 600;
    .message {
      margin: 0;
      flex: 1;
    }
    .reload {
      padding: 0.4rem 0.9rem;
      border-radius: 0.25rem;
      border: 1px solid currentColor;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      &:hover {
        background: rgba(255, 255, 255, 0.15);
      }
    }
  }
  .status-block {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    color: var(--theme-content-color);
    &.error {
      border: 1px solid var(--theme-error-color, #d33);
      border-radius: 0.375rem;
      background: var(--theme-error-soft-bg, rgba(211, 51, 51, 0.08));
      margin: 1rem;
    }
    .title {
      font-weight: 600;
      color: var(--theme-error-color, #d33);
    }
    .detail {
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--theme-darker-color);
      word-break: break-word;
    }
    .retry {
      margin-top: 0.5rem;
      padding: 0.4rem 0.9rem;
      border-radius: 0.25rem;
      border: 1px solid var(--theme-button-border, var(--theme-divider-color));
      background: var(--theme-button-default, var(--theme-bg-color));
      color: var(--theme-content-color);
      cursor: pointer;
      &:hover {
        background: var(--theme-button-hovered, var(--theme-bg-accent-color));
      }
    }
  }
</style>
