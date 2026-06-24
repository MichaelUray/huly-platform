<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Settings → Access Center entry point. Reads the active workspace
// from the current location and mounts the workspace-access-resources
// AccessCenter root component.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentLocation, Label } from '@hcengineering/ui'
  import { getMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import {
    AccessCenter,
    setDefaultWacClient,
    setRegularTokenGetter,
    WacClient,
    getEffectiveBearerToken,
    roleStore,
    myAccessApi,
    wac
  } from '@hcengineering/workspace-access-resources'
  import setting from '../plugin'

  let workspace: string = ''
  let workspaceLabel: string = ''
  let loading: boolean = true
  let loadError: string | null = null

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
    } else {
      loading = false
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
</script>

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
  />
{/if}

<style lang="scss">
  .hint {
    padding: 1.5rem;
    color: var(--theme-darker-color);
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
