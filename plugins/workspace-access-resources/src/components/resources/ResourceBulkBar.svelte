<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wave 5 D — Resources bulk-action bar.
//
// Mirrors the PeopleBulkBar UX convention (c98594fce8): the bar is
// ALWAYS rendered above the table and dimmed via .is-empty when nothing
// is selected, so toggling the first / last row does not push the table
// down. Every interactive control is `disabled` when count===0 so the
// visual cue and the actual interaction-block stay in sync.
//
// Three actions:
//   - Archive selected — sets archived=true on each selected space.
//     Mutation only; member/owner lists preserved (see writeRouter
//     handleBulkSpaceArchive). Server emits one `space_archived` audit
//     row per applied space.
//   - Make private    — sets private=true. Server: handleBulkSpacePrivacy
//     → one `space_privacy_changed` audit per row.
//   - Transfer ownership — opens OwnerPickerModal; the picked uuid is
//     APPENDED to each space's owners[] without removing existing
//     owners. ADD-ONLY (Tier-1 safe shape — full transfer is v2).
//     Server: handleBulkSpaceAddOwner → one `space_owners_changed`
//     audit row per applied space.
//
// Outcome banner: when the parent feeds `lastBulkResult` we summarize
// + render in the same shape PeopleBulkBar uses for bulk-role results.
// The operator can expand the failure list to see exactly which spaces
// flipped and which didn't (e.g. not_found / internal).
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import {
    Button,
    IconAdd,
    IconClose,
    IconDelete,
    IconSettings,
    addNotification,
    NotificationSeverity
  } from '@hcengineering/ui'
  import wac from '../../plugin'
  import {
    summarizeResourceBulkResult,
    type ResourceBulkResult,
    type ResourceBulkStatus,
    type ResourceBulkSummary
  } from '../../api/resourcesBulkApi'

  export let count: number = 0
  export let lastBulkResult: ResourceBulkResult | null = null
  /** Label of the action that produced `lastBulkResult`. Used in the
   * outcome banner toast so the operator can tell which bulk fired. */
  export let lastActionLabel: string = ''

  const dispatch = createEventDispatcher<{
    deselectAll: void
    archive: void
    setPrivate: void
    transferOwner: void
    dismissBulkResult: void
  }>()

  let failuresExpanded: boolean = false

  $: summary = lastBulkResult != null ? summarizeResourceBulkResult(lastBulkResult) : null

  // Toast on identity change so the operator sees the outcome even
  // after navigating away from the bar.
  let lastToastedBatchId: string | null = null
  $: if (lastBulkResult != null && summary != null && lastBulkResult.batch_id !== lastToastedBatchId) {
    lastToastedBatchId = lastBulkResult.batch_id
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

  function statusLabel (s: ResourceBulkStatus): string {
    switch (s) {
      case 'ok': return 'applied'
      case 'forbidden': return 'forbidden'
      case 'not_found': return 'not found'
      case 'internal': return 'internal error'
      default: return s
    }
  }

  function formatToastTitle (s: ResourceBulkSummary): string {
    const prefix = lastActionLabel !== '' ? `${lastActionLabel}: ` : ''
    if (s.failed === 0) return `${prefix}Updated ${s.applied} of ${s.total} space(s).`
    if (s.applied === 0) return `${prefix}Failed for all ${s.total} space(s).`
    return `${prefix}Updated ${s.applied} of ${s.total} space(s); ${s.failed} failed.`
  }

  function formatToastBody (s: ResourceBulkSummary): string {
    const parts: string[] = []
    for (const k of Object.keys(s.byStatus) as ResourceBulkStatus[]) {
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

<!-- Always rendered. Same dim-when-empty UX as PeopleBulkBar so the
     table below does not shift on first / last row toggle. -->
<div
  class="bulk-bar"
  class:is-empty={count === 0}
  role="toolbar"
  aria-label="Resource bulk actions"
  aria-disabled={count === 0}
  data-test-id="wac-resource-bulk-bar"
>
  <span class="count" aria-live="polite">{count} selected</span>
  <Button
    kind={'regular'}
    size={'small'}
    icon={IconDelete}
    label={wac.string.BulkArchiveSelected}
    disabled={count === 0}
    on:click={() => dispatch('archive')}
  />
  <Button
    kind={'regular'}
    size={'small'}
    icon={IconSettings}
    label={wac.string.BulkSetPrivate}
    disabled={count === 0}
    on:click={() => dispatch('setPrivate')}
  />
  <Button
    kind={'regular'}
    size={'small'}
    icon={IconAdd}
    label={wac.string.BulkTransferOwner}
    disabled={count === 0}
    on:click={() => dispatch('transferOwner')}
  />
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
    data-test-id="wac-resource-bulk-result-banner"
  >
    <div class="bulk-result-row">
      <span class="bulk-result-summary" data-test-id="wac-resource-bulk-result-summary">
        {formatToastTitle(summary)}
        {#if summary.failed > 0}
          <span class="bulk-result-breakdown">({formatToastBody(summary)})</span>
        {/if}
      </span>
      {#if summary.failures.length > 0}
        <button
          type="button"
          class="bulk-result-toggle"
          data-test-id="wac-resource-bulk-result-toggle"
          on:click={() => (failuresExpanded = !failuresExpanded)}
        >
          {failuresExpanded ? 'Hide details' : `Show ${summary.failures.length} failure(s)`}
        </button>
      {/if}
      <button
        type="button"
        class="bulk-result-dismiss"
        aria-label="Dismiss"
        data-test-id="wac-resource-bulk-result-dismiss"
        on:click={onDismiss}
      >×</button>
    </div>
    {#if failuresExpanded && summary.failures.length > 0}
      <ul class="bulk-result-failures" data-test-id="wac-resource-bulk-result-failures">
        {#each summary.failures as f (f.spaceId)}
          <li>
            <code class="failure-uuid">{f.spaceId}</code>
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
  .bulk-bar.is-empty { opacity: 0.55; }
  .bulk-bar.is-empty .count { color: var(--theme-darker-color); }
  .count {
    font-weight: 600;
    color: var(--theme-caption-color);
    padding-right: var(--spacing-1);
    border-right: 1px solid var(--theme-divider-color);
    margin-right: var(--spacing-1);
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

    li { margin: 0.15rem 0; }
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
