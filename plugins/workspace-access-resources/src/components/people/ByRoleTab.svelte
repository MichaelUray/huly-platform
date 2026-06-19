<script lang="ts">
  import AllMembersTab from './AllMembersTab.svelte'
  import type { WorkspaceRole } from '../../types'

  export let workspace: string
  export let roles: WorkspaceRole[] = ['OWNER', 'MAINTAINER']

  $: preset = { roleIn: roles }
</script>

<AllMembersTab {workspace} {preset} on:rowClick on:selectionChange />
