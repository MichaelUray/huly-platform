<script lang="ts">
  import { impersonationStore } from '../../stores/impersonationStore'

  $: state = $impersonationStore.state

  function back (): void {
    if (typeof window !== 'undefined') {
      window.location.href = '/login/admin'
    }
  }
</script>

{#if state === 'expired'}
  <div class="backdrop" role="presentation"></div>
  <div class="modal" role="alertdialog" aria-modal="true" data-test="expired-modal">
    <h2>Impersonation session expired</h2>
    <p>Your 30-minute impersonation session has ended. To continue, request a new session from the admin panel.</p>
    <button class="primary" on:click={back}>Back to admin panel</button>
  </div>
{/if}

<style lang="scss">
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 985; }
  .modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 990;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    padding: 2rem;
    width: 92vw;
    max-width: 24rem;
    text-align: center;
  }
  h2 { margin-top: 0; color: var(--theme-caption-color); }
  p { color: var(--theme-darker-color); }
  .primary {
    margin-top: 0.5rem;
    padding: 0.5rem 1.2rem;
    background: var(--theme-caption-color);
    color: var(--theme-bg-color);
    border: 0;
    border-radius: 0.25rem;
    cursor: pointer;
    font-weight: 500;
  }
</style>
