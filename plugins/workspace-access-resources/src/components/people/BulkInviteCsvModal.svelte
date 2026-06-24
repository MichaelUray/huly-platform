<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// CSV Bulk-Invite — workspace OWNER uploads a CSV, sees a per-row
// honest dry-run preview, then confirms the dispatch.
//
// DSGVO: file is sent to the server as JSON-stringified CSV. Server
// never writes it to disk; per-row emails are sha256-hashed before
// audit; only aggregate counts (total/valid/invalid) end up in the
// audit log.
//
// E7 — Send-button gated behind preview.csvDispatch (server returns
// 501 until the mail-hook + transactor.invite write are wired). The
// dry-run preview is always available (real validation, no fake
// success).
//
// All labels are sourced via wac.string.* IntlString keys (the prior
// inline German label table is gone).
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Label } from '@hcengineering/ui'
  import { translate } from '@hcengineering/platform'
  import wac from '../../plugin'
  import { previewEnabled } from '../../stores/capabilitiesStore'
  import { bulkInviteCsv, type BulkInviteResponse } from '../../api/bulkInviteApi'

  export let workspace: string
  export let open: boolean = false

  const dispatch = createEventDispatcher<{ close: void }>()

  // E7 — gate the actual Send-button behind the granular csvDispatch
  // preview flag. Dry-run is always real + visible.
  const csvDispatchEnabled = previewEnabled('csvDispatch')

  let fileName: string = ''
  let csv: string = ''
  let busy: boolean = false
  let err: string | null = null
  let preview: BulkInviteResponse | null = null
  let successMsg: string | null = null

  // Resolved strings for things we can't directly Label (toast bodies,
  // input error states). Loaded once on mount + on locale change.
  let s = {
    fileTooLarge: '',
    runDryFirst: '',
    fixInvalidRows: '',
    successDispatched: ''
  }
  $: void Promise.all([
    translate(wac.string.BulkInviteCsvFileTooLarge, {}),
    translate(wac.string.BulkInviteCsvRunDryFirst, {}),
    translate(wac.string.BulkInviteCsvFixInvalidRows, {}),
    translate(wac.string.BulkInviteCsvSuccessDispatched, {})
  ]).then(([a, b, c, d]) => { s = { fileTooLarge: a, runDryFirst: b, fixInvalidRows: c, successDispatched: d } })

  function reset (): void {
    fileName = ''
    csv = ''
    preview = null
    successMsg = null
    err = null
  }

  function onClose (): void {
    if (busy) return
    reset()
    dispatch('close')
  }

  async function onFile (evt: Event): Promise<void> {
    const input = evt.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file == null) return
    if (file.size > 1024 * 1024) {
      err = s.fileTooLarge
      return
    }
    fileName = file.name
    csv = await file.text()
    preview = null
    successMsg = null
    err = null
  }

  async function onDryRun (): Promise<void> {
    if (csv === '') return
    err = null
    busy = true
    successMsg = null
    try {
      preview = await bulkInviteCsv(workspace, csv, true)
    } catch (e: any) {
      err = e?.message ?? String(e)
    } finally {
      busy = false
    }
  }

  async function onConfirm (): Promise<void> {
    if (preview == null) { err = s.runDryFirst; return }
    if (preview.summary.invalid > 0) { err = s.fixInvalidRows; return }
    busy = true
    err = null
    try {
      const r = await bulkInviteCsv(workspace, csv, false)
      successMsg = `${s.successDispatched} ${r.dispatched ?? r.summary.valid}`
      preview = r
    } catch (e: any) {
      err = e?.message ?? String(e)
    } finally {
      busy = false
    }
  }
</script>

{#if open}
  <div class="overlay" role="dialog" aria-modal="true">
    <div class="modal" data-test="bulk-invite-modal">
      <header>
        <h2><Label label={wac.string.BulkInviteCsvTitle} /></h2>
        <button class="close" on:click={onClose} aria-label="close" disabled={busy}>×</button>
      </header>
      <div class="body">
        <p class="hint"><Label label={wac.string.BulkInviteCsvFormatHint} /></p>
        <label class="file-row">
          <span class="btn"><Label label={wac.string.BulkInviteCsvUpload} /></span>
          <input type="file" accept=".csv,text/csv" on:change={onFile} hidden />
          {#if fileName !== ''}<span class="filename">{fileName}</span>{/if}
        </label>
        {#if err}<p class="err">{err}</p>{/if}
        {#if successMsg}<p class="ok">{successMsg}</p>{/if}
        {#if preview != null}
          <div class="summary">
            <strong><Label label={wac.string.BulkInviteCsvColTotal} />:</strong> {preview.summary.total}
            &nbsp;<strong><Label label={wac.string.BulkInviteCsvColOk} />:</strong> {preview.summary.valid}
            &nbsp;<strong><Label label={wac.string.BulkInviteCsvColInvalid} />:</strong> {preview.summary.invalid}
          </div>
          <table class="grid" data-test="bulk-invite-preview">
            <thead>
              <tr>
                <th>#</th>
                <th><Label label={wac.string.BulkInviteCsvColHashedEmail} /></th>
                <th><Label label={wac.string.BulkInviteCsvColRole} /></th>
                <th><Label label={wac.string.BulkInviteCsvColSpaces} /></th>
                <th><Label label={wac.string.BulkInviteCsvColStatus} /></th>
              </tr>
            </thead>
            <tbody>
              {#each preview.rows as r}
                <tr class:bad={r.status !== 'ok'}>
                  <td>{r.line}</td>
                  <td><code class="hash">{r.email_hash ?? r.email ?? ''}</code></td>
                  <td>{r.role}</td>
                  <td>
                    {r.addToSpaces.join(', ')}
                    {#if r.addToSpaces_unvalidated && r.addToSpaces.length > 0}
                      <span class="muted">(<Label label={wac.string.BulkInviteCsvAddToSpacesUnvalidated} />)</span>
                    {/if}
                  </td>
                  <td>{r.status}{r.detail ? ` — ${r.detail}` : ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <footer>
        <button on:click={onClose} disabled={busy}><Label label={wac.string.Cancel} /></button>
        <button on:click={onDryRun} disabled={busy || csv === ''}>
          {#if busy}<Label label={wac.string.BulkInviteCsvPendingPreview} />{:else}<Label label={wac.string.BulkInviteCsvDryRun} />{/if}
        </button>
        {#if $csvDispatchEnabled}
          <button
            class="primary"
            on:click={onConfirm}
            disabled={busy || preview == null || preview.summary.invalid > 0 || preview.summary.valid === 0}
          >
            {#if busy}<Label label={wac.string.BulkInviteCsvPendingConfirm} />{:else}<Label label={wac.string.BulkInviteCsvConfirm} />{/if}
          </button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style lang="scss">
  .overlay {
    position: fixed; inset: 0;
    background: var(--theme-popup-color);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--theme-bg-color);
    color: var(--theme-content-color);
    border-radius: 0.5rem;
    box-shadow: var(--popup-shadow);
    width: min(48rem, 95vw); max-height: 90vh;
    display: flex; flex-direction: column;
  }
  header, footer { padding: 0.75rem 1rem; display: flex; align-items: center; }
  header { border-bottom: 1px solid var(--theme-divider-color); }
  footer { border-top: 1px solid var(--theme-divider-color); justify-content: flex-end; gap: 0.5rem; }
  h2 { margin: 0; flex: 1; font-size: 1.1rem; }
  .close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--theme-content-color); }
  .body { padding: 1rem; overflow: auto; flex: 1; }
  .hint { color: var(--theme-darker-color); font-size: 0.85rem; margin: 0 0 0.75rem; }
  .muted { color: var(--theme-darker-color); font-size: 0.78rem; margin-left: 0.35rem; }
  .file-row { display: flex; align-items: center; gap: 0.75rem; cursor: pointer; }
  .btn { padding: 0.4rem 0.8rem; border: 1px solid var(--theme-divider-color); border-radius: 0.25rem; }
  .filename { font-family: var(--font-mono, monospace); font-size: 0.85rem; }
  .err { color: var(--theme-state-negative-color); margin-top: 0.6rem; }
  .ok { color: var(--theme-state-positive-color); margin-top: 0.6rem; }
  .summary { margin-top: 1rem; font-size: 0.9rem; }
  .grid { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
  .grid th, .grid td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); text-align: left; }
  .grid tr.bad td { color: var(--theme-state-negative-color); }
  .hash { font-family: var(--font-mono, monospace); font-size: 0.78rem; opacity: 0.8; }
  button.primary { background: var(--theme-button-primary-color); color: var(--theme-button-contrast-color); border: 0; padding: 0.45rem 1rem; border-radius: 0.25rem; }
</style>
