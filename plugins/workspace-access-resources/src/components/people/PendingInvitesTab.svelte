<script lang="ts">
  import { onMount } from 'svelte'
  import { Label } from '@hcengineering/ui'
  import { EntityTable, type EntityColumn } from '@hcengineering/access-management-ui'
  import wac from '../../plugin'
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

  // 2026-06-25 H9+M13 fix — display-layer fallbacks for the raw wire
  // shape returned by handleInvites:
  //   - email: literal 'unknown' is the SQL fallback the server emits
  //     when global_account.invite.email is NULL. Rendering it raw
  //     reads like an account-name and confuses operators. Map to em-dash.
  //   - invitedAt: the schema (global_account.invite) doesn't track
  //     creation time — the column was dropped in the V1 migration.
  //     handleInvites always returns null here. Show em-dash so it's
  //     clearly "not applicable" rather than "loading".
  //   - expiresAt: the wire form is an epoch-ms string (postgres
  //     ::text cast on a bigint). Format to locale date so operators
  //     can scan at a glance.
  function fmtEmail (v: unknown): string {
    if (v == null) return '—'
    const s = String(v)
    if (s === '' || s === 'unknown') return '—'
    return s
  }

  function fmtDateMs (v: unknown): string {
    if (v == null) return '—'
    const ms = typeof v === 'number' ? v : parseInt(String(v), 10)
    if (!Number.isFinite(ms) || ms <= 0) return '—'
    const d = new Date(ms)
    if (isNaN(d.getTime())) return '—'
    // ISO date-only is unambiguous + sortable; the table column width
    // is too tight for a full timestamp anyway. Operators on Audit get
    // the precise wall-clock.
    return d.toISOString().slice(0, 10)
  }

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
  <EntityTable items={items} {columns} {loading} idKey="id">
    <svelte:fragment slot="empty">
      <Label label={wac.string.EmptyPending} />
    </svelte:fragment>
    <svelte:fragment slot="cell" let:item let:col>
      {#if String(col.key) === 'email'}
        {fmtEmail(item.email)}
      {:else if String(col.key) === 'invitedAt'}
        {fmtDateMs(item.invitedAt)}
      {:else if String(col.key) === 'expiresAt'}
        {fmtDateMs(item.expiresAt)}
      {:else}
        {item[String(col.key)] ?? ''}
      {/if}
    </svelte:fragment>
  </EntityTable>
</div>

<style lang="scss">
  .pending { padding: 1rem 1.25rem; }
  .err {
    padding: 0.75rem;
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border-radius: 0.25rem;
    margin-bottom: 0.75rem;
  }
</style>
