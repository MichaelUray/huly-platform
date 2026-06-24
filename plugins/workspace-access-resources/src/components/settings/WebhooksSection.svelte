<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// WAC Settings — Outbound Webhooks panel.
//
// Tier-1 implementation: read+create+toggle+delete+test for the
// configured webhooks. Designed to be embedded under a Settings tab
// or surfaced from the Resources toolbar as a modal in a follow-up.
//
// PII / DSGVO warning is shown when the user flips data_filter to
// 'full', so they're forced to confirm pushing email+name to the
// configured destination.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import {
    listWebhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    testWebhook,
    type Webhook,
    type WebhookEventType
  } from '../../api/webhookApi'

  export let workspace: string

  const ALL_EVENTS: WebhookEventType[] = [
    'role_changed',
    'grant_created',
    'grant_revoked',
    'grant_expired',
    'member_removed',
    'space_members_changed',
    'space_owners_changed'
  ]

  let rows: Webhook[] = []
  let loading = true
  let loadError: string | null = null

  // New-form state
  let nUrl = ''
  let nSecret = ''
  let nEvents: Record<WebhookEventType, boolean> = {
    role_changed: true,
    grant_created: false,
    grant_revoked: false,
    grant_expired: false,
    member_removed: false,
    space_members_changed: false,
    space_owners_changed: false
  }
  let nDataFilter: 'minimal' | 'full' = 'minimal'
  let createErr: string | null = null
  let creating = false

  async function refresh (): Promise<void> {
    loading = true
    loadError = null
    try {
      rows = await listWebhooks(workspace)
    } catch (err: any) {
      loadError = err?.message ?? String(err)
    } finally {
      loading = false
    }
  }

  onMount(refresh)

  async function onCreate (): Promise<void> {
    createErr = null
    creating = true
    try {
      const events = ALL_EVENTS.filter((e) => nEvents[e])
      if (events.length === 0) {
        createErr = 'Select at least one event type.'
        creating = false
        return
      }
      if (nDataFilter === 'full') {
        const ok = typeof window !== 'undefined'
          ? window.confirm(
              'Pushing email + display name to an external system has DSGVO implications.\n\n' +
              'Make sure the receiver has a documented purpose and a contract with the workspace owner.\n\n' +
              'Continue?'
            )
          : true
        if (!ok) {
          creating = false
          return
        }
      }
      await createWebhook(workspace, {
        url: nUrl.trim(),
        secret: nSecret.trim() === '' ? null : nSecret.trim(),
        event_types: events,
        data_filter: nDataFilter,
        active: true
      })
      nUrl = ''
      nSecret = ''
      nDataFilter = 'minimal'
      for (const e of ALL_EVENTS) nEvents[e] = e === 'role_changed'
      await refresh()
    } catch (err: any) {
      createErr = err?.message ?? String(err)
    } finally {
      creating = false
    }
  }

  async function onToggle (row: Webhook): Promise<void> {
    try {
      await updateWebhook(workspace, row.id, { active: !row.active })
      await refresh()
    } catch (err: any) {
      loadError = err?.message ?? String(err)
    }
  }

  async function onDelete (row: Webhook): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(`Delete webhook ${row.url}?`)) return
    try {
      await deleteWebhook(workspace, row.id)
      await refresh()
    } catch (err: any) {
      loadError = err?.message ?? String(err)
    }
  }

  let testingId: string | null = null
  let lastTestResult: string | null = null

  async function onTest (row: Webhook): Promise<void> {
    testingId = row.id
    lastTestResult = null
    try {
      const r = await testWebhook(workspace, row.id)
      lastTestResult = r.ok
        ? `OK (HTTP ${r.status ?? '?'})`
        : `FAILED (${r.error ?? `HTTP ${r.status ?? '?'}`})`
    } catch (err: any) {
      lastTestResult = `FAILED (${err?.message ?? String(err)})`
    } finally {
      testingId = null
    }
  }
</script>

<section class="webhooks">
  <header>
    <h2>Outbound Webhooks</h2>
    <p class="hint">
      Push role-changes, grants, and member-removals to an external system.
      Only HTTPS destinations are accepted; private and internal IP ranges
      are blocked at the server.
    </p>
  </header>

  {#if loading}
    <p>Loading…</p>
  {:else}
    {#if loadError}<p class="err">{loadError}</p>{/if}

    <table class="grid" data-test="webhooks-grid">
      <thead>
        <tr>
          <th>URL</th>
          <th>Events</th>
          <th>Payload</th>
          <th>Secret</th>
          <th>Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr data-test="webhook-row" data-id={r.id}>
            <td class="url">{r.url}</td>
            <td>{r.event_types.join(', ')}</td>
            <td>{r.data_filter}</td>
            <td>{r.hasSecret ? 'yes' : '—'}</td>
            <td>
              <button on:click={() => onToggle(r)}>
                {r.active ? 'on' : 'off'}
              </button>
            </td>
            <td class="actions">
              <button on:click={() => onTest(r)} disabled={testingId === r.id}>Test</button>
              <button class="danger" on:click={() => onDelete(r)}>Delete</button>
            </td>
          </tr>
        {/each}
        {#if rows.length === 0}
          <tr><td colspan="6" class="empty">No outbound webhooks configured.</td></tr>
        {/if}
      </tbody>
    </table>

    {#if lastTestResult != null}
      <p class="test-result" data-test="webhook-test-result">Test result: {lastTestResult}</p>
    {/if}

    <form on:submit|preventDefault={onCreate} class="create" data-test="webhook-create">
      <h3>Add webhook</h3>
      <label>
        URL (https only)
        <input type="url" bind:value={nUrl} required placeholder="https://example.com/hook" />
      </label>
      <label>
        Secret (optional, ≥ 8 chars)
        <input type="text" bind:value={nSecret} minlength={8} placeholder="leave blank for unsigned payloads" />
      </label>
      <fieldset class="events">
        <legend>Events</legend>
        {#each ALL_EVENTS as e}
          <label class="checkbox">
            <input type="checkbox" bind:checked={nEvents[e]} />
            {e}
          </label>
        {/each}
      </fieldset>
      <label>
        Payload
        <select bind:value={nDataFilter}>
          <option value="minimal">minimal (UUIDs only — recommended)</option>
          <option value="full">full (+ email + name — DSGVO-relevant)</option>
        </select>
      </label>
      {#if createErr}<p class="err">{createErr}</p>{/if}
      <button type="submit" disabled={creating}>{creating ? 'Saving…' : 'Add webhook'}</button>
    </form>
  {/if}
</section>

<style lang="scss">
  .webhooks {
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  h2 { margin: 0; font-size: 1.1rem; }
  .hint { color: var(--theme-darker-color); margin: 0.25rem 0 0; font-size: 0.85rem; }
  .grid { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .grid th, .grid td { padding: 0.45rem 0.6rem; text-align: left; border-bottom: 1px solid var(--theme-divider-color); }
  .url { font-family: var(--font-mono, monospace); word-break: break-all; }
  .empty { color: var(--theme-darker-color); text-align: center; padding: 1rem; }
  .actions { display: flex; gap: 0.4rem; }
  .err { color: var(--theme-error-color, #c33); }
  .test-result { font-family: var(--font-mono, monospace); font-size: 0.85rem; }

  .create {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-top: 1rem;
    border-top: 1px solid var(--theme-divider-color);
    max-width: 38rem;
  }
  .create label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
  .create input, .create select { padding: 0.4rem; }
  .events { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; border: 1px solid var(--theme-divider-color); padding: 0.5rem; }
  .checkbox { flex-direction: row !important; align-items: center; gap: 0.35rem; }
  button.danger { color: #c33; }
</style>
