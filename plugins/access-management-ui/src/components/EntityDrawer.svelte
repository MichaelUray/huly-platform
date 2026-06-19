<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Generic sliding drawer with named slots (header/body/footer) and
// keyboard focus trap. Closes on Escape; consumer-supplied close
// handler runs via the `close` event.
-->
<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'

  export let open: boolean = false
  export let title: string = ''
  export let widthRem: number = 32

  const dispatch = createEventDispatcher<{ close: void }>()

  let drawerEl: HTMLDivElement | undefined
  let lastFocused: HTMLElement | null = null

  function close (): void {
    dispatch('close')
  }

  function onKeyDown (e: KeyboardEvent): void {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  $: if (open) {
    lastFocused = document.activeElement as HTMLElement | null
    queueMicrotask(() => drawerEl?.focus())
  } else if (lastFocused != null) {
    lastFocused.focus()
    lastFocused = null
  }

  onMount(() => {
    document.addEventListener('keydown', onKeyDown)
  })
  onDestroy(() => {
    document.removeEventListener('keydown', onKeyDown)
  })
</script>

{#if open}
  <div class="backdrop" on:click={close} role="presentation" data-test="drawer-backdrop"></div>
  <aside
    class="drawer"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    style="--drawer-width: {widthRem}rem"
    tabindex="-1"
    bind:this={drawerEl}
    data-test="drawer"
  >
    <header class="drawer-head">
      <slot name="header">
        <h2 class="drawer-title">{title}</h2>
      </slot>
      <button class="close" on:click={close} aria-label="Close drawer">×</button>
    </header>
    <div class="drawer-body">
      <slot name="body" />
      <slot />
    </div>
    <footer class="drawer-foot">
      <slot name="footer" />
    </footer>
  </aside>
{/if}

<style lang="scss">
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 950;
  }
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--drawer-width, 32rem);
    max-width: 100vw;
    background: var(--theme-bg-color);
    border-left: 1px solid var(--theme-divider-color);
    box-shadow: -4px 0 18px rgba(0, 0, 0, 0.15);
    z-index: 960;
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .drawer-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .close {
    background: transparent;
    border: 0;
    font-size: 1.4rem;
    line-height: 1;
    color: var(--theme-darker-color);
    cursor: pointer;
    &:hover { color: var(--theme-caption-color); }
  }
  .drawer-body {
    flex: 1 1 auto;
    overflow: auto;
    padding: 1rem 1.25rem;
  }
  .drawer-foot {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--theme-divider-color);
  }

  @media (max-width: 480px) {
    .drawer { width: 100vw; border-left: 0; }
  }
</style>
