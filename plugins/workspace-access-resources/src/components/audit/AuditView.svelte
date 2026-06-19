<script lang="ts">
  import { onMount } from 'svelte'
  import { AuditLogView, AuditLogExportButton } from '@hcengineering/access-management-ui'
  import { auditApi } from '../../api/auditApi'
  import { getImpersonationToken } from '../../stores/impersonationStore'
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
    <input
      type="text"
      placeholder="Action contains…"
      bind:value={actionFilter}
      on:change={() => refresh(true)}
      data-test="audit-filter-action"
    />
    <input
      type="text"
      placeholder="Actor contains…"
      bind:value={actorFilter}
      on:change={() => refresh(true)}
      data-test="audit-filter-actor"
    />
    <button class="ghost" on:click={() => { actionFilter = ''; actorFilter = ''; void refresh(true) }}>Clear filters</button>
    <span class="spacer"></span>
    {#if canExport}
      <button class="export-trigger" on:click={() => (showDsgvoBanner = true)} data-test="audit-export-trigger">Export CSV…</button>
    {/if}
  </div>

  {#if error != null}<div class="err" role="alert">{error}</div>{/if}

  <AuditLogView entries={entries as any[]} mapper={workspaceAuditMapper} {loading} {cursor} on:loadMore={onLoadMore} />

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
          <button class="ghost" on:click={() => (showDsgvoBanner = false)}>Cancel</button>
          <AuditLogExportButton
            endpoint={auditApi.exportUrl(workspace, { action: actionFilter, actor: actorFilter })}
            token={getImpersonationToken()}
            on:exported={onConfirmExport}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .audit-view { display: flex; flex-direction: column; min-height: 100%; padding: 1rem 1.25rem; }
  .toolbar {
    display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;
    input {
      background: var(--theme-bg-color);
      border: 1px solid var(--theme-divider-color);
      color: var(--theme-caption-color);
      padding: 0.35rem 0.6rem; border-radius: 0.25rem;
    }
  }
  .spacer { flex: 1; }
  .ghost {
    background: transparent; border: 1px solid var(--theme-divider-color);
    padding: 0.35rem 0.6rem; border-radius: 0.25rem;
    color: var(--theme-darker-color); cursor: pointer; font-size: 0.85rem;
    &:hover { color: var(--theme-caption-color); }
  }
  .export-trigger {
    background: var(--theme-caption-color); color: var(--theme-bg-color);
    border: 0; padding: 0.4rem 0.9rem; border-radius: 0.25rem; cursor: pointer; font-size: 0.85rem;
  }
  .err { background: rgba(239,68,68,0.1); color: #b91c1c; padding: 0.5rem; border-radius: 0.25rem; margin-bottom: 0.75rem; }
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
