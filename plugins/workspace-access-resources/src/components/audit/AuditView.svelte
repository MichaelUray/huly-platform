<script lang="ts">
  import { onMount } from 'svelte'
  import ui, { Button, DatePresenter, DropdownLabelsIntl, EditBox, IconClose, Label, Modal, eventToHTMLElement, IconDownload, type DropdownIntlItem } from '@hcengineering/ui'
  import { DateRangeMode } from '@hcengineering/core'
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
  // Polish-5 — `actionFilter` is a fixed enum picked from the closed
  // list below (empty string = "any action"). The actor filter is
  // unchanged. The action list mirrors the literals emitted in
  // server-plugins/workspace-access (writeRouter.ts +
  // audit/insert.ts + impersonation/index.ts) — keep in sync when a
  // new action is added.
  //
  // A1+A2 — server now honors from/to/action via decodeFilterParam
  // (server-plugins/workspace-access/src/http/readRouter.ts) — these
  // values flow through the existing base64-JSON filter encoding.
  let actionFilter: string = ''
  let actorFilter: string = ''
  // A2 — date-range as wall-clock millis. We convert to ISO at the
  // send-edge so the server's ISO_RE regex (date-only or full
  // timestamp) accepts the value. Null = no bound.
  let fromMs: number | null = null
  let toMs: number | null = null
  let showDsgvoBanner: boolean = false

  function msToIso (ms: number | null, kind: 'from' | 'to'): string | undefined {
    if (ms == null) return undefined
    // Render as date-only (YYYY-MM-DD) so the operator's "June 21st"
    // mental model maps cleanly. For `to` we shift to end-of-day so the
    // upper bound is inclusive of events on that calendar day.
    const d = new Date(ms)
    if (kind === 'to') {
      d.setHours(23, 59, 59, 999)
      return d.toISOString()
    }
    // 'from' clamps to start-of-day in local TZ.
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }

  // The dropdown's "all actions" sentinel needs a non-empty id (the
  // DropdownIntlItem.id is `string | number`). Use a Symbol-like marker
  // and translate back to '' on the wire.
  const ANY_ACTION = '__any__'

  const actionItems: DropdownIntlItem[] = [
    { id: ANY_ACTION, label: wac.string.AuditFilterActionAny },
    { id: 'role_changed', label: wac.string.AuditActionRoleChanged },
    { id: 'member_added', label: wac.string.AuditActionMemberAdded },
    { id: 'space_archived', label: wac.string.AuditActionSpaceArchived },
    { id: 'space_unarchived', label: wac.string.AuditActionSpaceUnarchived },
    { id: 'space_autojoin_changed', label: wac.string.AuditActionSpaceAutojoinChanged },
    { id: 'space_privacy_changed', label: wac.string.AuditActionSpacePrivacyChanged },
    { id: 'space_members_changed', label: wac.string.AuditActionSpaceMembersChanged },
    { id: 'space_owners_changed', label: wac.string.AuditActionSpaceOwnersChanged },
    { id: 'impersonation_started', label: wac.string.AuditActionImpersonationStarted },
    { id: 'impersonation_ended', label: wac.string.AuditActionImpersonationEnded },
    { id: 'impersonation_idor_attempt', label: wac.string.AuditActionImpersonationIdorAttempt },
    { id: 'impersonation_replay_attempt', label: wac.string.AuditActionImpersonationReplayAttempt },
    { id: 'grant_revoked', label: wac.string.AuditActionGrantRevoked },
    { id: 'token_revoked', label: wac.string.AuditActionTokenRevoked }
  ]

  let selectedAction: string | number = ANY_ACTION

  function onActionChange (e: CustomEvent<string | number>): void {
    selectedAction = e.detail
    actionFilter = selectedAction === ANY_ACTION ? '' : String(selectedAction)
    void refresh(true)
  }

  function buildFilter (): Record<string, unknown> {
    const filter: Record<string, unknown> = {}
    if (actionFilter !== '') filter.action = actionFilter
    if (actorFilter !== '') filter.actor = actorFilter
    const fromIso = msToIso(fromMs, 'from')
    if (fromIso != null) filter.from = fromIso
    const toIso = msToIso(toMs, 'to')
    if (toIso != null) filter.to = toIso
    return filter
  }

  async function refresh (reset: boolean = true): Promise<void> {
    loading = true
    error = null
    try {
      const res = await auditApi.list(workspace, {
        cursor: reset ? undefined : cursor ?? undefined,
        filter: buildFilter()
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
    <div class="filter-dropdown">
      <DropdownLabelsIntl
        items={actionItems}
        selected={selectedAction}
        label={wac.string.AuditFilterActionAny}
        kind={'regular'}
        size={'small'}
        on:selected={onActionChange}
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
    <!-- M14 — the upstream DatePicker hard-codes the popup label to
         "Due date — Needs to be completed by this date" via DatePresenter
         defaults. That copy is wrong for an audit-log time-range filter
         (no due-date semantics, no completion). We render DatePresenter
         directly instead of going through DatePicker so we can override
         `label` (popup heading) and `detail` (popup sub-line) to the
         audit-appropriate "From / To date — Select date" pair, using
         existing IntlStrings only (no new locale keys). -->
    <div class="filter-date">
      <span class="filter-date-label"><Label label={wac.string.AuditFilterFrom} /></span>
      <DatePresenter
        bind:value={fromMs}
        mode={DateRangeMode.DATE}
        editable
        label={wac.string.AuditFilterFrom}
        detail={ui.string.SelectDate}
        on:change={() => refresh(true)}
      />
    </div>
    <div class="filter-date">
      <span class="filter-date-label"><Label label={wac.string.AuditFilterTo} /></span>
      <DatePresenter
        bind:value={toMs}
        mode={DateRangeMode.DATE}
        editable
        label={wac.string.AuditFilterTo}
        detail={ui.string.SelectDate}
        on:change={() => refresh(true)}
      />
    </div>
    <Button
      kind={'ghost'}
      size={'small'}
      icon={IconClose}
      label={wac.string.AuditClear}
      on:click={() => {
        actionFilter = ''
        actorFilter = ''
        selectedAction = ANY_ACTION
        fromMs = null
        toMs = null
        void refresh(true)
      }}
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
            endpoint={auditApi.exportUrl(workspace, buildFilter())}
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
  .filter-dropdown { flex: 0 0 14rem; }
  .filter-date {
    flex: 0 0 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .filter-date-label {
    font-size: 0.72rem;
    color: var(--theme-darker-color);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .spacer { flex: 1; }
  .err { background: var(--theme-state-negative-background-color); color: var(--theme-state-negative-color); padding: 0.5rem; border-radius: 0.25rem; margin-bottom: 0.75rem; }
  .dsgvo-modal {
    position: fixed; inset: 0; z-index: 970;
    background: var(--theme-popup-color);
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
