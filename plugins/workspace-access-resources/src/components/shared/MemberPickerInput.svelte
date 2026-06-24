<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Chip-style member picker. Caller-supplied member list (display name +
// uuid) for autocomplete; output is the selected uuid[]. Designed to
// replace the UUID-comma textareas in PersonDrawer / SpaceDrawer with
// a UX closer to Huly's Members.svelte while staying free of contact-
// resources's Employee picker dependency.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Button, EditBox, IconClose, IconAdd } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'

  export interface MemberOption {
    uuid: string
    name: string
    email?: string
  }

  export let selected: string[] = []
  export let options: MemberOption[] = []
  export let disabled: boolean = false
  export let placeholder: string = 'Add member…'

  const dispatch = createEventDispatcher<{ change: string[] }>()

  let search: string = ''
  let showSuggestions: boolean = false

  $: byUuid = new Map(options.map((o) => [o.uuid, o]))
  $: selectedSet = new Set(selected)
  $: filtered = options
    .filter((o) => !selectedSet.has(o.uuid))
    .filter((o) => {
      if (search === '') return true
      const q = search.toLowerCase()
      return o.name.toLowerCase().includes(q) || (o.email?.toLowerCase().includes(q) ?? false)
    })
    .slice(0, 8)

  function add (uuid: string): void {
    if (selectedSet.has(uuid)) return
    selected = [...selected, uuid]
    search = ''
    showSuggestions = false
    dispatch('change', selected)
  }

  function remove (uuid: string): void {
    selected = selected.filter((u) => u !== uuid)
    dispatch('change', selected)
  }
</script>

<div class="picker">
  <div class="chips">
    {#each selected as uuid}
      {@const opt = byUuid.get(uuid)}
      <span class="chip" data-test="member-chip">
        <span class="chip-name">{opt?.name ?? uuid.slice(0, 8) + '…'}</span>
        {#if !disabled}
          <button class="chip-x" on:click={() => remove(uuid)} aria-label="Remove member">
            ×
          </button>
        {/if}
      </span>
    {/each}
    {#if selected.length === 0}
      <span class="empty">No members selected.</span>
    {/if}
  </div>

  {#if !disabled}
    <div class="search-row">
      <div class="search-box">
        <EditBox
          bind:value={search}
          placeholder={getEmbeddedLabel(placeholder)}
          kind={'search-style'}
          on:focus={() => (showSuggestions = true)}
        />
      </div>
      <Button
        kind={'ghost'}
        size={'small'}
        icon={IconAdd}
        label={getEmbeddedLabel(showSuggestions ? 'Hide list' : 'Browse all')}
        on:click={() => (showSuggestions = !showSuggestions)}
      />
    </div>

    {#if showSuggestions || search !== ''}
      <div class="suggestions" data-test="member-suggestions">
        {#each filtered as o (o.uuid)}
          <button class="suggestion" on:click={() => add(o.uuid)}>
            <span class="sug-name">{o.name}</span>
            {#if o.email}<span class="sug-email">{o.email}</span>{/if}
          </button>
        {:else}
          <span class="empty">No matches.</span>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style lang="scss">
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    min-height: 2rem;
    padding: 0.4rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--theme-bg-accent-color);
    color: var(--theme-caption-color);
    padding: 0.2rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.85rem;
    border: 1px solid var(--theme-divider-color);
  }
  .chip-name {
    line-height: 1;
  }
  .chip-x {
    background: transparent;
    border: 0;
    color: var(--theme-darker-color);
    cursor: pointer;
    line-height: 1;
    font-size: 1rem;
    padding: 0 0.2rem;
    &:hover { color: #b91c1c; }
  }
  .search-row {
    display: flex;
    gap: var(--spacing-1);
    align-items: center;
  }
  .search-box {
    flex: 1;
    padding: 0.25rem 0.5rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 16rem;
    overflow: auto;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    background: var(--theme-bg-color);
    padding: 0.3rem;
  }
  .suggestion {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    align-items: flex-start;
    background: transparent;
    border: 0;
    padding: 0.4rem 0.5rem;
    border-radius: 0.25rem;
    cursor: pointer;
    text-align: left;
    color: var(--theme-content-color);
    &:hover { background: var(--theme-bg-accent-color); }
  }
  .sug-name { font-weight: 500; }
  .sug-email { font-size: 0.78rem; color: var(--theme-darker-color); }
  .empty {
    color: var(--theme-darker-color);
    font-size: 0.85rem;
    padding: 0.3rem 0.5rem;
  }
</style>
