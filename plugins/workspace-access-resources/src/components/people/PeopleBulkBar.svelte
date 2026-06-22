<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Sticky bulk-action bar styled with Huly's Button + theme tokens.
//
// Wave 5 Task C1 — the bar now also renders the *outcome* of a bulk-role
// call. Before, the parent (PeopleView) silently swallowed the response
// because the client type was `{ batch_id, affected }`; partial failures
// (last-owner refused, target not in workspace, internal write_failed)
// were invisible. We render a compact summary banner + an expandable
// per-target failure list so the operator can see exactly which members
// did and didn't flip.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import {
    Button,
    IconAdd,
    IconClose,
    IconDelete,
    addNotification,
    NotificationSeverity
  } from '@hcengineering/ui'
  import wac from '../../plugin'
  import type { WorkspaceRole } from '../../types'
  import { previewEnabled } from '../../stores/capabilitiesStore'
  import {
    summarizeBulkRoleResult,
    type BulkRoleResult,
    type BulkRoleStatus,
    type BulkRoleSummary
  } from '../../api/peopleApi'

  // FIX 4.1 — gate Add-to-Space + Remove-from-Space buttons until
  // the backend (workspace TxOperations bulk-edit) is wired. Server
  // returns 501 members_bulk_space_mutations_not_wired meanwhile.
  const previewMembersBulkSpace = previewEnabled('membersBulkSpaceMutations')

  export let count: number = 0
  // Wave 5 C1 — when the parent receives a bulk-role response it sets
  // this prop. We summarize + render. Setting it back to null hides the
  // banner.
  export let lastBulkRoleResult: BulkRoleResult | null = null

  const dispatch = createEventDispatcher<{
    deselectAll: void
    addToSpace: void
    removeFromSpace: void
    changeRole: { role: WorkspaceRole }
    dismissBulkResult: void
  }>()

  let roleSelect: WorkspaceRole = 'USER'
  let failuresExpanded: boolean = false

  // Reactive summary — kept null when the parent hasn't fed us a result.
  $: summary = lastBulkRoleResult != null ? summarizeBulkRoleResult(lastBulkRoleResult) : null

  // When a brand-new result lands, fire a toast (separate from the
  // inline banner) so the operator sees the outcome even after they
  // navigate away from the bar. The .svelte runtime only triggers this
  // block when lastBulkRoleResult identity changes.
  let lastToastedBatchId: string | null = null
  $: if (lastBulkRoleResult != null && summary != null && lastBulkRoleResult.batch_id !== lastToastedBatchId) {
    lastToastedBatchId = lastBulkRoleResult.batch_id
    const severity = summary.failed === 0
      ? NotificationSeverity.Info
      : summary.applied === 0
        ? NotificationSeverity.Error
        : NotificationSeverity.Warning
    addNotification(
      formatToastTitle(summary),
      formatToastBody(summary),
      undefined as any,
      undefined,
      severity
    )
  }

  // Per-status human label. Centralised so the inline list and the
  // toast body use the same wording.
  function statusLabel (s: BulkRoleStatus): string {
    switch (s) {
      case 'ok': return 'applied'
      case 'last_owner_refused': return 'refused as last owner'
      case 'forbidden': return 'forbidden'
      case 'not_found': return 'not in workspace'
      case 'internal': return 'internal error'
      default: return s
    }
  }

  function formatToastTitle (s: BulkRoleSummary): string {
    if (s.failed === 0) return `Updated ${s.applied} of ${s.total} members.`
    if (s.applied === 0) return `Bulk role change failed for all ${s.total} members.`
    return `Updated ${s.applied} of ${s.total} members; ${s.failed} failed.`
  }

  function formatToastBody (s: BulkRoleSummary): string {
    const parts: string[] = []
    for (const k of Object.keys(s.byStatus) as BulkRoleStatus[]) {
      if (k === 'ok') continue
      const n = s.byStatus[k]
      if (n > 0) parts.push(`${n} ${statusLabel(k)}`)
    }
    return parts.join(', ')
  }

  function onDismiss (): void {
    failuresExpanded = false
    dispatch('dismissBulkResult')
  }
</script>

<!-- Always rendered so the table below does not jump when the operator
     toggles the first / last row. Disabled state when nothing is
     selected; live region announces the selection-count to AT. -->
<div
  class="bulk-bar"
  class:is-empty={count === 0}
  role="region"
  aria-label="Bulk actions"
  aria-disabled={count === 0}
>
  <span class="count" aria-live="polite">{count} selected</span>
  {#if $previewMembersBulkSpace}
    <!-- FIX 4.1 — Bulk-space mutations preview-gated. Backend returns
         501 members_bulk_space_mutations_not_wired until the workspace
         TxOperations bulk-edit is wired. -->
    <Button
      kind={'regular'}
      size={'small'}
      icon={IconAdd}
      label={wac.string.BulkAddToSpace}
      disabled={count === 0}
      on:click={() => dispatch('addToSpace')}
    />
    <Button
      kind={'regular'}
      size={'small'}
      icon={IconDelete}
      label={wac.string.BulkRemoveFromSpace}
      disabled={count === 0}
      on:click={() => dispatch('removeFromSpace')}
    />
  {/if}
  <span class="role-changer">
    Change role
    <select bind:value={roleSelect} aria-label="New role" disabled={count === 0}>
      <option value="OWNER">Owner</option>
      <option value="MAINTAINER">Maintainer</option>
      <option value="USER">User</option>
      <option value="GUEST">Guest</option>
      <option value="READONLY_GUEST">Read-only Guest</option>
      <option value="DOC_GUEST">Document Guest</option>
    </select>
    <Button
      kind={'primary'}
      size={'small'}
      label={wac.string.BulkApply}
      disabled={count === 0}
      on:click={() => dispatch('changeRole', { role: roleSelect })}
    />
  </span>
  <span class="spacer"></span>
  <Button
    kind={'ghost'}
    size={'small'}
    icon={IconClose}
    label={wac.string.Cancel}
    disabled={count === 0}
    on:click={() => dispatch('deselectAll')}
  />
</div>

{#if summary != null}
  <div
    class="bulk-result"
    class:has-failures={summary.failed > 0}
    class:all-failed={summary.failed > 0 && summary.applied === 0}
    role="status"
    aria-live="polite"
    data-test-id="bulk-role-result-banner"
  >
    <div class="bulk-result-row">
      <span class="bulk-result-summary" data-test-id="bulk-role-result-summary">
        {formatToastTitle(summary)}
        {#if summary.failed > 0}
          <span class="bulk-result-breakdown">({formatToastBody(summary)})</span>
        {/if}
      </span>
      {#if summary.failures.length > 0}
        <button
          type="button"
          class="bulk-result-toggle"
          data-test-id="bulk-role-result-toggle"
          on:click={() => (failuresExpanded = !failuresExpanded)}
        >
          {failuresExpanded ? 'Hide details' : `Show ${summary.failures.length} failure(s)`}
        </button>
      {/if}
      <button
        type="button"
        class="bulk-result-dismiss"
        aria-label="Dismiss"
        data-test-id="bulk-role-result-dismiss"
        on:click={onDismiss}
      >×</button>
    </div>
    {#if failuresExpanded && summary.failures.length > 0}
      <ul class="bulk-result-failures" data-test-id="bulk-role-result-failures">
        {#each summary.failures as f (f.memberUuid)}
          <li>
            <code class="failure-uuid">{f.memberUuid}</code>
            <span class="failure-status">{statusLabel(f.status)}</span>
            {#if f.detail != null && f.detail !== ''}
              <span class="failure-detail">— {f.detail}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style lang="scss">
  /*
   * Sits ABOVE the data list (PeopleView renders it before the active
   * sub-tab) and is ALWAYS rendered so toggling the first/last row does
   * not shift the table. When nothing is selected the whole bar is
   * dimmed via `.is-empty` (in addition to per-control `disabled` attrs)
   * so the visual cue and the actual interaction-block stay in sync.
   */
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
    padding: var(--spacing-1_5) var(--spacing-2);
    margin-bottom: var(--spacing-1_5);
    background: var(--theme-bg-accent-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    transition: opacity 120ms ease;
  }
  .bulk-bar.is-empty {
    opacity: 0.55;
  }
  .bulk-bar.is-empty .count {
    color: var(--theme-darker-color);
  }
  .count {
    font-weight: 600;
    color: var(--theme-caption-color);
    padding-right: var(--spacing-1);
    border-right: 1px solid var(--theme-divider-color);
    margin-right: var(--spacing-1);
  }
  .role-changer {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--theme-darker-color);
    font-size: 0.85rem;

    select {
      background: var(--theme-bg-color);
      border: 1px solid var(--theme-divider-color);
      color: var(--theme-caption-color);
      padding: 0.25rem 0.4rem;
      border-radius: 0.25rem;
    }
  }
  .spacer { flex: 1; }

  .bulk-result {
    margin: var(--spacing-1) 0 0;
    padding: var(--spacing-1) var(--spacing-1_5);
    border-radius: 0.25rem;
    background: var(--theme-state-positive-background-color);
    color: var(--theme-state-positive-color);
    font-size: 0.85rem;

    &.has-failures {
      background: var(--theme-state-warning-background-color);
      color: var(--theme-state-warning-color);
    }
    &.all-failed {
      background: var(--theme-state-negative-background-color);
      color: var(--theme-state-negative-color);
    }
  }
  .bulk-result-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
  }
  .bulk-result-summary { flex: 1; }
  .bulk-result-breakdown {
    margin-left: 0.3rem;
    opacity: 0.85;
    font-weight: normal;
  }
  .bulk-result-toggle,
  .bulk-result-dismiss {
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    padding: 0.1rem 0.45rem;
    border-radius: 0.2rem;
    cursor: pointer;
    font: inherit;
  }
  .bulk-result-dismiss {
    border: none;
    font-size: 1.05rem;
    line-height: 1;
    padding: 0 0.3rem;
  }
  .bulk-result-failures {
    margin: var(--spacing-1) 0 0;
    padding-left: var(--spacing-2);
    list-style: disc;

    li {
      margin: 0.15rem 0;
    }
  }
  .failure-uuid {
    font-family: var(--mono-font, monospace);
    background: var(--theme-bg-accent-color);
    padding: 0 0.25rem;
    border-radius: 0.15rem;
  }
  .failure-status {
    margin-left: 0.4rem;
    font-weight: 600;
  }
  .failure-detail {
    margin-left: 0.25rem;
    opacity: 0.8;
  }
</style>
