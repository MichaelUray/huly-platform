<script lang="ts">
  import AllMembersTab from './AllMembersTab.svelte'

  export let workspace: string

  const preset = { activityBucketIn: ['90d+'] }
</script>

<AllMembersTab {workspace} {preset} on:rowClick on:selectionChange />
