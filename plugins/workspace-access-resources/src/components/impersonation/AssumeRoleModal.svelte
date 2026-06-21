<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// DSGVO confirmation modal that gates the impersonation token request.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { startImpersonation } from '../../stores/impersonationStore'

  export let open: boolean = false
  export let workspace: string
  export let workspaceLabel: string = workspace

  const dispatch = createEventDispatcher<{ close: void }>()

  let reason: string = ''
  let busy: boolean = false
  let error: string | null = null

  async function confirm (): Promise<void> {
    busy = true
    error = null
    try {
      await startImpersonation(workspace, reason.trim() !== '' ? reason : undefined)
      dispatch('close')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }
</script>

{#if open}
  <div class="backdrop" on:click={() => dispatch('close')} role="presentation"></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Acting as Workspace Owner">
    <h2>Acting as Workspace Owner</h2>
    <p>You are about to act as Workspace Owner of <strong>{workspaceLabel}</strong>.</p>
    <p>All actions you take will be logged in:</p>
    <ul>
      <li>The global admin audit log</li>
      <li>This workspace's audit log (visible to its Owner and Maintainer in real time)</li>
    </ul>
    <p>Workspace members will see your actions attributed to "Instance Admin (impersonating)" with your account UUID. There is no stealth mode.</p>
    <p>Session length: 30 minutes (no renewal).</p>

    <label class="reason-row">
      Reason (optional, audit-logged):
      <input type="text" bind:value={reason} placeholder="e.g. customer support ticket #1234" data-test="impersonation-reason" />
    </label>

    {#if error != null}<div class="err" role="alert">{error}</div>{/if}

    <div class="actions">
      <button class="ghost" on:click={() => dispatch('close')} disabled={busy}>Cancel</button>
      <button class="primary-red" on:click={confirm} disabled={busy} data-test="impersonation-proceed">
        {busy ? 'Starting…' : 'I understand, proceed'}
      </button>
    </div>
  </div>
{/if}

<style lang="scss">
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 970; }
  .modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 980;
    background: var(--theme-bg-color);
    color: var(--theme-caption-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    padding: 1.75rem;
    width: 92vw;
    max-width: 32rem;
  }
  h2 { margin-top: 0; }
  p, ul { color: var(--theme-darker-color); font-size: 0.92rem; line-height: 1.5; }
  ul { padding-left: 1.4rem; }
  .reason-row { display: block; margin: 1rem 0; font-size: 0.85rem; color: var(--theme-darker-color); }
  .reason-row input {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    background: var(--theme-bg-accent-color);
    border: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    padding: 0.4rem 0.6rem;
    border-radius: 0.25rem;
  }
  .actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
  .ghost {
    background: transparent;
    border: 1px solid var(--theme-divider-color);
    padding: 0.4rem 0.9rem;
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--theme-darker-color);
  }
  .primary-red {
    background: var(--theme-state-negative-color);
    color: var(--theme-button-contrast-color, white);
    border: 0;
    padding: 0.45rem 1.1rem;
    border-radius: 0.25rem;
    cursor: pointer;
    font-weight: 500;
    &:hover { background: var(--theme-state-negative-hover); }
    &:disabled { opacity: 0.5; cursor: progress; }
  }
  .err {
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    padding: 0.5rem;
    border-radius: 0.25rem;
    margin-top: 0.5rem;
  }
</style>
