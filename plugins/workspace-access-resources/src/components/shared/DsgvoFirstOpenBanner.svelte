<script lang="ts">
  import { onMount } from 'svelte'
  import { Button, IconClose } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'

  export let workspace: string
  export let retentionDays: number = 365

  let visible: boolean = false
  let ackKey = ''

  onMount(() => {
    ackKey = `wac:dsgvo:ack:${workspace}`
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(ackKey) !== '1') visible = true
  })

  function ack (): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ackKey, '1')
    }
    visible = false
  }
</script>

{#if visible}
  <div class="dsgvo-banner" role="status" data-test="dsgvo-first-open">
    <span class="dsgvo-text">
      Workspace audit retention is {retentionDays} days. Edits from the
      People / Resources panels below are logged with the actor's UUID.
    </span>
    <div class="dsgvo-close">
      <Button
        icon={IconClose}
        kind={'ghost'}
        size={'small'}
        showTooltip={{ label: getEmbeddedLabel('Dismiss') }}
        on:click={ack}
      />
    </div>
  </div>
{/if}

<style lang="scss">
  .dsgvo-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem var(--spacing-3);
    background: color-mix(in srgb, var(--theme-link-color) 8%, var(--theme-bg-color));
    color: var(--theme-content-color);
    font-size: 0.82rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .dsgvo-text {
    flex: 1;
    line-height: 1.4;
  }
  .dsgvo-close {
    flex: 0 0 auto;
  }
</style>
