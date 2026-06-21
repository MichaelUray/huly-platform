<!--
// Copyright © 2026 Hardcore Engineering Inc.
// People > Granted Access — Mention-Grants V1 integration (Phase 3).
// Auto-hidden by the parent when grantedAccessApi.countGrants === 0.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { EntityTable, type EntityColumn } from '@hcengineering/access-management-ui'
  import { grantedAccessApi } from '../../api/grantedAccessApi'
  import type { GrantRow } from '../../types'

  export let workspace: string
  export let canRevoke: boolean = false

  // P2B-T6 — backend revoke is now real: txClient.removeDoc on the
  // collaborator row, audit row 'grant_revoked', live transactor
  // broadcast. The UI Revoke button is re-enabled.
  const REVOKE_GRANT_ENABLED = true

  const dispatch = createEventDispatcher<{ revoked: { recipient: string, resource: string } }>()

  let items: GrantRow[] = []
  let loading: boolean = true
  let error: string | null = null

  const columns: EntityColumn<GrantRow>[] = [
    { key: 'recipientName', label: 'Recipient' as any, sort: true },
    { key: 'granterName', label: 'Granted by' as any, sort: true, width: 180 },
    { key: 'resourceTitle', label: 'Resource' as any, sort: true },
    { key: 'grantedAt', label: 'Granted at' as any, sort: true, width: 160 }
  ]

  async function refresh (): Promise<void> {
    loading = true
    try {
      const res = await grantedAccessApi.listGrants(workspace)
      items = res.items
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  onMount(refresh)

  async function revoke (row: GrantRow): Promise<void> {
    if (!confirm(`Revoke ${row.recipientName}'s access to ${row.resourceTitle}?`)) return
    try {
      await grantedAccessApi.revoke(workspace, row.recipientUuid, row.resourceId)
      dispatch('revoked', { recipient: row.recipientUuid, resource: row.resourceId })
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
</script>

<div class="granted">
  {#if error != null}<div class="err" role="alert">{error}</div>{/if}
  <EntityTable items={items} {columns} {loading} idKey="resourceId">
    <svelte:fragment slot="cell" let:item let:col>
      {#if String(col.key) === 'resourceTitle' && canRevoke && REVOKE_GRANT_ENABLED}
        <span class="row-with-action">
          <span class="title">{item.resourceTitle}</span>
          <button class="revoke" on:click|stopPropagation={() => revoke(item)}>Revoke</button>
        </span>
      {:else}
        {item[String(col.key)] ?? ''}
      {/if}
    </svelte:fragment>
  </EntityTable>
</div>

<style lang="scss">
  .granted { padding: 1rem 1.25rem; }
  .err {
    padding: 0.75rem;
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border-radius: 0.25rem;
    margin-bottom: 0.75rem;
  }
  .row-with-action { display: flex; align-items: center; gap: 0.75rem; width: 100%; }
  .title { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .revoke {
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border: 0;
    padding: 0.2rem 0.6rem;
    border-radius: 0.25rem;
    cursor: pointer;
    font-size: 0.78rem;
    &:hover { background: var(--theme-state-negative-border-color); }
  }
</style>
