<script lang="ts">
  import { onMount } from 'svelte'

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
    <span>
      This workspace's audit retention is {retentionDays} days. Configure under
      Workspace Access Center → Audit Settings.
    </span>
    <button class="ack" on:click={ack}>Got it</button>
  </div>
{/if}

<style lang="scss">
  .dsgvo-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1.25rem;
    background: rgba(168,85,247,0.12);
    color: #6b21a8;
    font-size: 0.88rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .ack {
    margin-left: auto;
    background: transparent;
    border: 1px solid #6b21a8;
    color: #6b21a8;
    padding: 0.2rem 0.7rem;
    border-radius: 0.25rem;
    cursor: pointer;
    &:hover { background: rgba(168,85,247,0.18); }
  }
</style>
