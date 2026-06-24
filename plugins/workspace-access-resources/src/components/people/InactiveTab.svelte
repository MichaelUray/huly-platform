<script lang="ts">
  import AllMembersTab from './AllMembersTab.svelte'
  import wac from '../../plugin'

  export let workspace: string

  const preset = { activityBucketIn: ['90d+'] }
</script>

<AllMembersTab
  {workspace}
  {preset}
  emptyLabel={wac.string.EmptyInactive}
  on:rowClick
  on:selectionChange
/>
