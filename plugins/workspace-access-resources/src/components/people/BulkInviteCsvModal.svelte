<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// CSV Bulk-Invite — workspace OWNER uploads a CSV, sees a per-row
// dry-run preview, then confirms the dispatch.
//
// DSGVO note: the file is sent to the server as JSON-stringified
// CSV. The server never writes it to disk; the audit log only
// captures aggregate counts.
//
// IntlString-Keys (DE übersetzt inline):
//   - BulkInviteCsv:        "Bulk-Einladung (CSV)"
//   - BulkInviteCsvUpload:  "CSV-Datei wählen"
//   - BulkInviteCsvDryRun:  "Vorschau (Dry-Run)"
//   - BulkInviteCsvConfirm: "Einladungen senden"
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { bulkInviteCsv, type BulkInviteResponse } from '../../api/bulkInviteApi'

  export let workspace: string
  export let open: boolean = false

  // DE labels per Memory feedback (Sprache=Deutsch für UX).
  const L = {
    title: 'Bulk-Einladung (CSV)',
    upload: 'CSV-Datei wählen',
    dryRun: 'Vorschau (Dry-Run)',
    confirm: 'Einladungen senden',
    cancel: 'Abbrechen',
    formatHint: 'Spalten: email, role, addToSpaces (Spaces mit ; getrennt). Max. 1 MB.',
    pendingPreview: 'Vorschau läuft…',
    pendingConfirm: 'Sende Einladungen…',
    successDispatched: 'Einladungen erfolgreich versendet:',
    runDryFirst: 'Bitte zuerst Vorschau ausführen.',
    fixInvalidRows: 'Einige Zeilen sind ungültig. Bitte korrigieren oder entfernen.'
  }

  const dispatch = createEventDispatcher<{ close: void }>()

  let fileName: string = ''
  let csv: string = ''
  let busy: boolean = false
  let err: string | null = null
  let preview: BulkInviteResponse | null = null
  let successMsg: string | null = null

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
      err = 'Datei größer als 1 MB.'
      return
    }
    fileName = file.name
    csv = await file.text()
    preview = null
    successMsg = null
    err = null
  }

  async function onDryRun (): Promise<void> {
    if (csv === '') { err = L.upload; return }
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
    if (preview == null) { err = L.runDryFirst; return }
    if (preview.summary.invalid > 0) { err = L.fixInvalidRows; return }
    busy = true
    err = null
    try {
      const r = await bulkInviteCsv(workspace, csv, false)
      successMsg = `${L.successDispatched} ${r.dispatched ?? r.summary.valid}`
      preview = r
    } catch (e: any) {
      err = e?.message ?? String(e)
    } finally {
      busy = false
    }
  }
</script>

{#if open}
  <div class="overlay" role="dialog" aria-modal="true" aria-label={L.title}>
    <div class="modal" data-test="bulk-invite-modal">
      <header>
        <h2>{L.title}</h2>
        <button class="close" on:click={onClose} aria-label="close" disabled={busy}>×</button>
      </header>
      <div class="body">
        <p class="hint">{L.formatHint}</p>
        <label class="file-row">
          <span class="btn">{L.upload}</span>
          <input type="file" accept=".csv,text/csv" on:change={onFile} hidden />
          {#if fileName !== ''}<span class="filename">{fileName}</span>{/if}
        </label>
        {#if err}<p class="err">{err}</p>{/if}
        {#if successMsg}<p class="ok">{successMsg}</p>{/if}
        {#if preview != null}
          <div class="summary">
            <strong>Total:</strong> {preview.summary.total}
            &nbsp;<strong>OK:</strong> {preview.summary.valid}
            &nbsp;<strong>Ungültig:</strong> {preview.summary.invalid}
          </div>
          <table class="grid" data-test="bulk-invite-preview">
            <thead>
              <tr><th>#</th><th>E-Mail</th><th>Rolle</th><th>Spaces</th><th>Status</th></tr>
            </thead>
            <tbody>
              {#each preview.rows as r}
                <tr class:bad={r.status !== 'ok'}>
                  <td>{r.line}</td>
                  <td>{r.email}</td>
                  <td>{r.role}</td>
                  <td>{r.addToSpaces.join(', ')}</td>
                  <td>{r.status}{r.detail ? ` — ${r.detail}` : ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <footer>
        <button on:click={onClose} disabled={busy}>{L.cancel}</button>
        <button on:click={onDryRun} disabled={busy || csv === ''}>{busy ? L.pendingPreview : L.dryRun}</button>
        <button
          class="primary"
          on:click={onConfirm}
          disabled={busy || preview == null || preview.summary.invalid > 0 || preview.summary.valid === 0}
        >{busy ? L.pendingConfirm : L.confirm}</button>
      </footer>
    </div>
  </div>
{/if}

<style lang="scss">
  .overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--theme-bg-color);
    color: var(--theme-content-color);
    border-radius: 0.5rem;
    box-shadow: 0 1rem 2rem rgba(0,0,0,0.25);
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
  .file-row { display: flex; align-items: center; gap: 0.75rem; cursor: pointer; }
  .btn { padding: 0.4rem 0.8rem; border: 1px solid var(--theme-divider-color); border-radius: 0.25rem; }
  .filename { font-family: var(--font-mono, monospace); font-size: 0.85rem; }
  .err { color: var(--theme-state-negative-color); margin-top: 0.6rem; }
  .ok { color: var(--theme-state-positive-color); margin-top: 0.6rem; }
  .summary { margin-top: 1rem; font-size: 0.9rem; }
  .grid { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
  .grid th, .grid td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); text-align: left; }
  .grid tr.bad td { color: var(--theme-state-negative-color); }
  button.primary { background: var(--theme-button-primary-color); color: var(--theme-button-contrast-color); border: 0; padding: 0.45rem 1rem; border-radius: 0.25rem; }
</style>
