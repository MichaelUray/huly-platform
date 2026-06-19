<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Settings → Access Center entry point. Reads the active workspace
// from the current location and mounts the workspace-access-resources
// AccessCenter root component.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentLocation } from '@hcengineering/ui'
  import { getMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import { AccessCenter, setDefaultWacClient, WacClient, roleStore } from '@hcengineering/workspace-access-resources'
  import setting from '../plugin'

  let workspace: string = ''
  let workspaceLabel: string = ''

  onMount(() => {
    const loc = getCurrentLocation()
    workspace = loc.path[1] ?? ''
    workspaceLabel = workspace
    // Wire the WAC client to use the user's existing Huly token.
    setDefaultWacClient(
      new WacClient({
        getToken: () => (getMetadata(presentation.metadata.Token) as string | undefined) ?? null
      })
    )
    // Default role until the server returns the real value; this
    // mirrors the workbench's own assumption for the workspace owner
    // entering through Settings.
    roleStore.set({ workspaceRole: 'OWNER', ownedSpaceIds: [] })
  })
</script>

{#if workspace !== ''}
  <AccessCenter
    {workspace}
    {workspaceLabel}
    retentionDays={365}
    headerIcon={setting.icon.AccessCenter}
    headerLabel={setting.string.AccessCenter}
  />
{:else}
  <p class="hint">No workspace context.</p>
{/if}

<style lang="scss">
  .hint {
    padding: 1.5rem;
    color: var(--theme-darker-color);
  }
</style>
