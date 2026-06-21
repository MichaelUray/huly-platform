<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Renders the blue read-only / red active impersonation banner with
// live countdown. Closes (state=normal) emit nothing.
-->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { impersonationStore, markExpired } from '../../stores/impersonationStore'

  const dispatch = createEventDispatcher<{
    assumeRole: void
    exit: void
    backToAdmin: void
  }>()

  let remaining: number = 0
  let interval: ReturnType<typeof setInterval> | undefined

  $: state = $impersonationStore.state
  $: exp = $impersonationStore.exp

  function tick (): void {
    if (exp == null) {
      remaining = 0
      return
    }
    const now = Math.floor(Date.now() / 1000)
    remaining = Math.max(0, exp - now)
    if (remaining === 0 && state === 'active') markExpired()
  }

  onMount(() => {
    tick()
    interval = setInterval(tick, 1000)
  })
  onDestroy(() => {
    if (interval != null) clearInterval(interval)
  })

  function fmt (s: number): string {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }
</script>

{#if state === 'drill-down'}
  <div class="banner blue" role="status" data-test="banner-blue">
    <span class="icon" aria-hidden="true">🔒</span>
    <span class="text">Read-only view as Instance Admin. Click 'Assume Owner role' to enable edits.</span>
    <span class="spacer"></span>
    <button class="cta" on:click={() => dispatch('assumeRole')} data-test="assume-role">Assume Owner role</button>
    <button class="ghost" on:click={() => dispatch('backToAdmin')}>Back to /admin</button>
  </div>
{:else if state === 'active'}
  <div class="banner red" role="alert" data-test="banner-red">
    <span class="icon" aria-hidden="true">⚠️</span>
    <span class="text">You are acting as Workspace Owner. Expires in {fmt(remaining)}. All actions are audit-logged.</span>
    <span class="spacer"></span>
    <button class="cta-red" on:click={() => dispatch('exit')} data-test="exit-impersonation">Exit impersonation</button>
  </div>
{/if}

<style lang="scss">
  .banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 1.25rem;
    border-bottom: 1px solid var(--theme-divider-color);
    font-size: 0.9rem;
    position: sticky;
    top: 0;
    z-index: 40;
  }
  /* C5 — blue (drill-down) + red (active impersonation) banners use
     theme tokens. Blue maps to Huly's mention-blue family (informational,
     not alarming). Red maps to the state-negative family. */
  .blue {
    background: var(--theme-mention-bg-color);
    color: var(--theme-link-color);
  }
  .red {
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    animation: red-pulse 4s ease-in-out infinite;
  }
  @keyframes red-pulse {
    0%, 100% { background: var(--theme-state-negative-background-color); }
    50% { background: var(--theme-state-negative-border-color); }
  }
  .text { flex: 0 1 auto; }
  .spacer { flex: 1; }
  .cta {
    background: var(--theme-link-color);
    color: var(--theme-button-contrast-color, white);
    border: 0;
    padding: 0.3rem 0.7rem;
    border-radius: 0.25rem;
    cursor: pointer;
    &:hover { filter: brightness(0.9); }
  }
  .cta-red {
    background: var(--theme-state-negative-color);
    color: var(--theme-button-contrast-color, white);
    border: 0;
    padding: 0.3rem 0.7rem;
    border-radius: 0.25rem;
    cursor: pointer;
    &:hover { background: var(--theme-state-negative-hover); }
  }
  .ghost {
    background: transparent;
    border: 1px solid currentColor;
    padding: 0.25rem 0.6rem;
    border-radius: 0.25rem;
    cursor: pointer;
    color: inherit;
  }
</style>
