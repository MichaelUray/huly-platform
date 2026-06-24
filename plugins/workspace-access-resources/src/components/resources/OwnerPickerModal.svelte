<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Wave 5 D — Owner picker modal for the Resources bulk "Transfer
// ownership" action.
//
// Loads the workspace member list (via peopleApi.listMembers) and lets
// the operator pick a single member to add as an owner to every
// selected space. The handler is ADD-ONLY (server-side
// handleBulkSpaceAddOwner appends to owners[] without removing
// existing owners) so this is a safe "promote-to-owner" UX, not a
// destructive transfer.
//
// Reuses MemberPickerInput from ../shared so the visual + interaction
// matches the SpaceDrawer member/owner pickers.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, Label } from '@hcengineering/ui'
  import wac from '../../plugin'
  import MemberPickerInput from '../shared/MemberPickerInput.svelte'
  import { peopleApi } from '../../api/peopleApi'
  import type { MemberRow } from '../../types'

  export let workspace: string
  /** Caller-supplied handler receives the chosen ownerUuid. Resolves to
   * the bulk call's per-row result so the parent can render the banner. */
  export let onPick: (ownerUuid: string) => Promise<void> | void = () => {}

  const dispatch = createEventDispatcher()

  let allMembers: Array<{ uuid: string; name: string; email?: string }> = []
  let selected: string[] = []
  let busy: boolean = false
  let loadError: string | null = null

  onMount(async () => {
    try {
      const res = await peopleApi.listMembers(workspace, { limit: 200 })
      allMembers = res.items.map((m: MemberRow) => ({ uuid: m.uuid, name: m.name, email: m.email }))
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    }
  })

  // The MemberPickerInput supports multi-select; for the v1 add-owner
  // flow we only consume the first picked uuid. (v2 may extend to
  // batch-add-multiple-owners in a single call.)
  $: ownerUuid = selected.length > 0 ? selected[0] : ''
  $: canSubmit = ownerUuid !== '' && !busy && loadError == null

  function close (): void {
    dispatch('close', false)
  }

  async function submit (): Promise<void> {
    if (!canSubmit) return
    busy = true
    try {
      await onPick(ownerUuid)
      dispatch('close', true)
    } finally {
      busy = false
    }
  }

  function onKeydown (e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="owner-picker" on:keydown={onKeydown}>
  <div class="title">
    <Label label={wac.string.OwnerPickerTitle} />
  </div>
  <div class="hint">
    <Label label={wac.string.OwnerPickerHint} />
  </div>
  {#if loadError != null}
    <div class="err" role="alert">{loadError}</div>
  {:else if allMembers.length === 0}
    <div class="empty"><Label label={wac.string.OwnerPickerNoMembers} /></div>
  {:else}
    <MemberPickerInput
      bind:selected
      options={allMembers}
      placeholder={'Add owner…'}
    />
  {/if}
  <div class="footer">
    <Button
      kind={'primary'}
      size={'medium'}
      label={wac.string.BulkTransferOwner}
      loading={busy}
      disabled={!canSubmit}
      on:click={submit}
    />
    <Button
      kind={'ghost'}
      size={'medium'}
      label={wac.string.Cancel}
      on:click={close}
    />
  </div>
</div>

<style lang="scss">
  .owner-picker {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 2rem 1.75rem 1.75rem;
    width: 32rem;
    max-width: 92vw;
    background: var(--theme-popup-color);
    border-radius: 0.5rem;
    box-shadow: var(--theme-popup-shadow);
  }
  .title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .hint {
    font-size: 0.85rem;
    color: var(--theme-darker-color);
  }
  .err {
    padding: 0.5rem 0.75rem;
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    border-radius: 0.25rem;
    font-size: 0.85rem;
  }
  .empty {
    padding: 0.75rem;
    color: var(--theme-darker-color);
    font-size: 0.85rem;
    text-align: center;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.25rem;
  }
  .footer {
    display: grid;
    grid-auto-flow: column;
    direction: rtl;
    justify-content: flex-start;
    align-items: center;
    column-gap: 0.5rem;
  }
</style>
