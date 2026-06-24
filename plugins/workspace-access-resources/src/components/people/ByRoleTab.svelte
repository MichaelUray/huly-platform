<script lang="ts">
  import AllMembersTab from './AllMembersTab.svelte'
  import wac from '../../plugin'
  import type { WorkspaceRole } from '../../types'

  export let workspace: string
  export let roles: WorkspaceRole[] = ['OWNER', 'MAINTAINER']

  $: preset = { roleIn: roles }
</script>

<AllMembersTab
  {workspace}
  {preset}
  emptyLabel={wac.string.EmptyByRole}
  on:rowClick
  on:selectionChange
/>
