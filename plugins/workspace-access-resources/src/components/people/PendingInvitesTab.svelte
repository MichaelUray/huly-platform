<script lang="ts">
  import { onMount } from 'svelte'
  import { EntityTable, type EntityColumn } from '@hcengineering/access-management-ui'
  import { peopleApi } from '../../api/peopleApi'
  import type { PendingInvite } from '../../types'

  export let workspace: string

  let items: PendingInvite[] = []
  let loading: boolean = true
  let error: string | null = null

  const columns: EntityColumn<PendingInvite>[] = [
    { key: 'email', label: 'Email' as any, sort: true },
    { key: 'invitedBy', label: 'Invited by' as any, sort: true, width: 180 },
    { key: 'invitedAt', label: 'Sent' as any, sort: true, width: 150 },
    { key: 'expiresAt', label: 'Expires' as any, sort: true, width: 150 }
  ]

  onMount(async () => {
    try {
      const res = await peopleApi.listPendingInvites(workspace)
      items = res.items
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  })
</script>

<div class="pending">
  {#if error != null}<div class="err" role="alert">{error}</div>{/if}
  <EntityTable items={items} {columns} {loading} idKey="id" />
</div>

<style lang="scss">
  .pending { padding: 1rem 1.25rem; }
  .err { padding: 0.75rem; background: rgba(239,68,68,0.1); color: #b91c1c; border-radius: 0.25rem; margin-bottom: 0.75rem; }
</style>
