<script lang="ts">
  import { onMount } from 'svelte'
  import { Button, EditBox, IconClose, Label, Modal, eventToHTMLElement, IconDownload } from '@hcengineering/ui'
  import wac from '../../plugin'
  import { AuditLogView, AuditLogExportButton } from '@hcengineering/access-management-ui'
  import { auditApi } from '../../api/auditApi'
  import { getEffectiveBearerToken } from '../../api/wacClient'
  import { workspaceAuditMapper } from './workspaceAuditMapper'
  import type { AuditRow } from '../../types'

  export let workspace: string
  export let canExport: boolean = false

  let entries: AuditRow[] = []
  let cursor: string | null = null
  let loading: boolean = true
  let error: string | null = null
  let actionFilter: string = ''
  let actorFilter: string = ''
  let showDsgvoBanner: boolean = false

  async function refresh (reset: boolean = true): Promise<void> {
    loading = true
    error = null
    try {
      const filter: Record<string, unknown> = {}
      if (actionFilter !== '') filter.action = actionFilter
      if (actorFilter !== '') filter.actor = actorFilter
      const res = await auditApi.list(workspace, {
        cursor: reset ? undefined : cursor ?? undefined,
        filter
      })
      entries = reset ? res.items : [...entries, ...res.items]
      cursor = res.cursor
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void refresh(true)
  })

  function onLoadMore (): void {
    void refresh(false)
  }

  function onConfirmExport (): void {
    showDsgvoBanner = false
  }
</script>

<div class="audit-view" id="wac-panel-audit" role="tabpanel">
  <div class="toolbar">
    <div class="filter-input">
      <EditBox
        bind:value={actionFilter}
        placeholder={wac.string.AuditFilterAction}
        kind={'search-style'}
        on:input={() => refresh(true)}
      />
    </div>
    <div class="filter-input">
      <EditBox
        bind:value={actorFilter}
        placeholder={wac.string.AuditFilterActor}
        kind={'search-style'}
        on:input={() => refresh(true)}
      />
    </div>
    <Button
      kind={'ghost'}
      size={'small'}
      icon={IconClose}
      label={wac.string.AuditClear}
      on:click={() => { actionFilter = ''; actorFilter = ''; void refresh(true) }}
    />
    <span class="spacer"></span>
    {#if canExport}
      <Button
        kind={'primary'}
        size={'small'}
        icon={IconDownload}
        label={wac.string.ExportCsv}
        on:click={() => (showDsgvoBanner = true)}
        dataId={'audit-export-trigger'}
      />
    {/if}
  </div>

  {#if error != null}<div class="err" role="alert">{error}</div>{/if}

  <AuditLogView entries={entries} mapper={workspaceAuditMapper} {loading} {cursor} on:loadMore={onLoadMore} />

  {#if showDsgvoBanner}
    <div class="dsgvo-modal" role="dialog" aria-modal="true">
      <div class="modal-body">
        <h3>Export contains personal data</h3>
        <p>
          The exported file lists actions taken by named users in this workspace. This is considered
          personal data under GDPR. Limit distribution to the lawful basis under which you collected
          it (legitimate interest in operating the workspace).
        </p>
        <p>The export is itself audit-logged.</p>
        <div class="actions">
          <Button
            kind={'ghost'}
            size={'small'}
            label={wac.string.Cancel}
            on:click={() => (showDsgvoBanner = false)}
          />
          <AuditLogExportButton
            endpoint={auditApi.exportUrl(workspace, { action: actionFilter, actor: actorFilter })}
            token={getEffectiveBearerToken()}
            on:exported={onConfirmExport}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .audit-view { display: flex; flex-direction: column; min-height: 100%; padding: var(--spacing-2) 0; }
  .toolbar {
    display: flex; gap: var(--spacing-1); align-items: center;
    margin-bottom: var(--spacing-2);
    flex-wrap: wrap;
  }
  .filter-input {
    flex: 0 0 14rem;
    padding: 0.25rem 0.5rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
  .spacer { flex: 1; }
  .err { background: var(--theme-state-negative-background-color); color: var(--theme-state-negative-color); padding: 0.5rem; border-radius: 0.25rem; margin-bottom: 0.75rem; }
  .dsgvo-modal {
    position: fixed; inset: 0; z-index: 970;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .modal-body {
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    padding: 1.5rem;
    max-width: 28rem;
    width: 92vw;
  }
  .modal-body h3 { margin-top: 0; color: var(--theme-caption-color); }
  .modal-body p { color: var(--theme-darker-color); font-size: 0.9rem; }
  .actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
</style>
