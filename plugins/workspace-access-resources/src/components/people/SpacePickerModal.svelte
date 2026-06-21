<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Polish-2 — replaces `window.prompt('Space-ID …')` in the People bulk
// bar. v1 ships a typed-UUID input (validated client-side) because the
// wac API does not yet expose a paginated Space search endpoint that
// would survive without leaking the full workspace topology to viewers.
// A live SpacePicker (typeahead + recent / pinned spaces) will replace
// the inner EditBox once that endpoint lands — see the FIXME below.
//
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Button, EditBox, Label } from '@hcengineering/ui'
  import wac from '../../plugin'

  export let mode: 'add' | 'remove' = 'add'
  export let onPick: (spaceId: string) => Promise<void> | void = () => {}

  const dispatch = createEventDispatcher()

  let value: string = ''
  let busy: boolean = false
  let touched: boolean = false

  // Loose UUID-shape check — server still enforces canonical form. Kept
  // permissive on purpose so an operator can paste a Huly internal id
  // (which is a UUID derivative) without us erroring out.
  // FIXME(wac-v1.5): swap UUID input for live SpaceSearch when
  // wac.api.searchSpaces lands.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  $: trimmed = value.trim()
  $: invalid = touched && (trimmed === '' || !UUID_RE.test(trimmed))
  $: canSubmit = !invalid && trimmed !== '' && !busy

  function close (): void {
    dispatch('close', false)
  }

  async function submit (): Promise<void> {
    touched = true
    if (trimmed === '' || !UUID_RE.test(trimmed)) return
    busy = true
    try {
      await onPick(trimmed)
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
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="space-picker" on:keydown={onKeydown}>
  <div class="title">
    {#if mode === 'add'}
      <Label label={wac.string.SpacePickerAddTitle} />
    {:else}
      <Label label={wac.string.SpacePickerRemoveTitle} />
    {/if}
  </div>
  <div class="hint">
    <Label label={wac.string.SpacePickerHint} />
  </div>
  <div class="field" class:invalid>
    <span class="field-label">
      <Label label={wac.string.SpaceIdLabel} />
    </span>
    <EditBox
      bind:value
      placeholder={wac.string.SpaceIdLabel}
      autoFocus
      on:blur={() => (touched = true)}
    />
    {#if invalid}
      <div class="err"><Label label={wac.string.SpacePickerInvalidUuid} /></div>
    {/if}
  </div>
  <div class="footer">
    <Button
      kind={'primary'}
      size={'medium'}
      label={mode === 'add' ? wac.string.BulkAddToSpace : wac.string.BulkRemoveFromSpace}
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
  .space-picker {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 2rem 1.75rem 1.75rem;
    width: 28rem;
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
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.35rem;
    &.invalid { border-color: var(--theme-state-negative-color); }
  }
  .field-label {
    font-size: 0.72rem;
    color: var(--theme-darker-color);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .err {
    color: var(--theme-state-negative-color);
    font-size: 0.78rem;
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
