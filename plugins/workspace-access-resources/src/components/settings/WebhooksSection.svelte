<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// WAC Settings — Outbound Webhooks panel.
//
// E7 — preview-gated UI. Backend returns 501 webhooks_not_wired until
// the PG-backed CRUD + audit dispatcher are wired. The section is
// hidden by default; WAC_PREVIEW_FEATURES=webhooks on the
// account-service host exposes it for dev/test.
//
// E7 — `window.confirm` calls were replaced by Huly's MessageBox so
// destructive + DSGVO-relevant confirms use the consistent platform
// dialog (was: native browser confirm, which broke the polish goal).
// Inline labels are sourced via wac.string.* IntlString keys.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { Label, showPopup } from '@hcengineering/ui'
  import { MessageBox } from '@hcengineering/presentation'
  import wac from '../../plugin'
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

  function confirmDsgvoFull (): Promise<boolean> {
    return new Promise((resolve) => {
      showPopup(MessageBox, {
        label: wac.string.WebhooksDataFilter,
        message: wac.string.WebhooksDataFilterFull,
        dangerous: true,
        action: async () => { resolve(true) }
      }, undefined, (result?: any) => {
        if (result == null || result === false) resolve(false)
      })
    })
  }

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
        const ok = await confirmDsgvoFull()
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

  function onDelete (row: Webhook): void {
    showPopup(MessageBox, {
      label: wac.string.WebhooksConfirmDeleteTitle,
      message: wac.string.WebhooksConfirmDeleteMessage,
      dangerous: true,
      action: async () => {
        try {
          await deleteWebhook(workspace, row.id)
          await refresh()
        } catch (err: any) {
          loadError = err?.message ?? String(err)
        }
      }
    })
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
    <h2><Label label={wac.string.WebhooksSectionTitle} /></h2>
    <p class="hint"><Label label={wac.string.WebhooksSectionDescription} /></p>
  </header>

  {#if loading}
    <p><Label label={wac.string.Loading} /></p>
  {:else}
    {#if loadError}<p class="err">{loadError}</p>{/if}

    <table class="grid" data-test="webhooks-grid">
      <thead>
        <tr>
          <th><Label label={wac.string.WebhooksUrl} /></th>
          <th><Label label={wac.string.WebhooksEventsLabel} /></th>
          <th><Label label={wac.string.WebhooksDataFilter} /></th>
          <th><Label label={wac.string.WebhooksSecret} /></th>
          <th><Label label={wac.string.WebhooksActive} /></th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr data-test="webhook-row" data-id={r.id}>
            <td class="url">{r.url}</td>
            <td>{r.event_types.join(', ')}</td>
            <td>{r.data_filter}</td>
            <td>{r.hasSecret ? '✓' : '—'}</td>
            <td>
              <button on:click={() => onToggle(r)}>
                {r.active ? 'on' : 'off'}
              </button>
            </td>
            <td class="actions">
              <button on:click={() => onTest(r)} disabled={testingId === r.id}>
                <Label label={wac.string.WebhooksTest} />
              </button>
              <button class="danger" on:click={() => onDelete(r)}>
                <Label label={wac.string.WebhooksDelete} />
              </button>
            </td>
          </tr>
        {/each}
        {#if rows.length === 0}
          <tr><td colspan="6" class="empty"><Label label={wac.string.WebhooksEmpty} /></td></tr>
        {/if}
      </tbody>
    </table>

    {#if lastTestResult != null}
      <p class="test-result" data-test="webhook-test-result">{lastTestResult}</p>
    {/if}

    <form on:submit|preventDefault={onCreate} class="create" data-test="webhook-create">
      <h3><Label label={wac.string.WebhooksAdd} /></h3>
      <label>
        <Label label={wac.string.WebhooksUrl} />
        <input type="url" bind:value={nUrl} required placeholder="https://example.com/hook" />
      </label>
      <label>
        <Label label={wac.string.WebhooksSecret} />
        <input type="text" bind:value={nSecret} minlength={8} />
      </label>
      <fieldset class="events">
        <legend><Label label={wac.string.WebhooksEventsLabel} /></legend>
        {#each ALL_EVENTS as e}
          <label class="checkbox">
            <input type="checkbox" bind:checked={nEvents[e]} />
            {e}
          </label>
        {/each}
      </fieldset>
      <label>
        <Label label={wac.string.WebhooksDataFilter} />
        <select bind:value={nDataFilter}>
          <option value="minimal"><Label label={wac.string.WebhooksDataFilterMinimal} /></option>
          <option value="full"><Label label={wac.string.WebhooksDataFilterFull} /></option>
        </select>
      </label>
      {#if createErr}<p class="err">{createErr}</p>{/if}
      <button type="submit" disabled={creating}>
        {#if creating}<Label label={wac.string.Loading} />{:else}<Label label={wac.string.WebhooksAdd} />{/if}
      </button>
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
  .err { color: var(--theme-state-negative-color); }
  .test-result { font-family: var(--font-mono, monospace); font-size: 0.85rem; }

  .create {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-top: 1rem;
    border-top: 1px solid var(--theme-divider-color);
  }
  .create label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
  .events { border: 1px solid var(--theme-divider-color); border-radius: 0.25rem; padding: 0.5rem; }
  .events legend { font-size: 0.8rem; color: var(--theme-darker-color); padding: 0 0.3rem; }
  .checkbox { flex-direction: row; align-items: center; gap: 0.4rem; }
  button.danger { color: var(--theme-state-negative-color); }
</style>
