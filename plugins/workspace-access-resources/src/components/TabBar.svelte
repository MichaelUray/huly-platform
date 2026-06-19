<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// WAC top-level tab bar: People / Resources / My-Access / Audit.
// Tab list is a prop (gated by effective role at the call site).
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let active: string
  export let tabs: string[] = []

  const labels: Record<string, string> = {
    people: 'People',
    resources: 'Resources',
    'my-access': 'My Access',
    audit: 'Audit'
  }

  const dispatch = createEventDispatcher<{ change: string }>()

  function go (t: string): void {
    if (t !== active) dispatch('change', t)
  }
</script>

<nav class="tab-bar" role="tablist" aria-label="Workspace Access Center sections">
  {#each tabs as t}
    <button
      class="tab"
      class:active={t === active}
      role="tab"
      aria-selected={t === active}
      aria-controls="wac-panel-{t}"
      data-test="tab-{t}"
      on:click={() => go(t)}
    >{labels[t] ?? t}</button>
  {/each}
</nav>

<style lang="scss">
  .tab-bar {
    display: flex;
    gap: 0.25rem;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-color);
  }
  .tab {
    background: transparent;
    border: 0;
    padding: 0.75rem 1rem;
    font-size: 0.92rem;
    color: var(--theme-darker-color);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    &:hover { color: var(--theme-caption-color); }
    &.active {
      color: var(--theme-caption-color);
      border-bottom-color: var(--theme-caption-color);
      font-weight: 600;
    }
  }
</style>
