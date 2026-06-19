<script lang="ts">
  import type { SpaceClass } from '../../types'
  export let cls: SpaceClass

  const map: Record<SpaceClass, { label: string; emoji: string; color: string }> = {
    'tracker.class.Project': { label: 'Project', emoji: '📌', color: '#3b82f6' },
    'document.class.Teamspace': { label: 'Teamspace', emoji: '📄', color: '#8b5cf6' },
    'drive.class.Drive': { label: 'Drive', emoji: '💾', color: '#10b981' },
    'card.class.CardSpace': { label: 'Cards', emoji: '🗂️', color: '#f59e0b' },
    'lead.class.Funnel': { label: 'Funnel', emoji: '🎯', color: '#ec4899' },
    'recruit.class.Vacancy': { label: 'Vacancy', emoji: '💼', color: '#14b8a6' },
    'recruit.class.JobFunnel': { label: 'Jobs', emoji: '🧑‍💼', color: '#0ea5e9' }
  }

  $: info = map[cls] ?? { label: cls, emoji: '•', color: 'var(--theme-darker-color)' }
</script>

<span class="type-row" style="--c: {info.color}">
  <span class="type-circle" aria-hidden="true">
    <span class="type-emoji">{info.emoji}</span>
  </span>
  <span class="type-label">{info.label}</span>
</span>

<style lang="scss">
  .type-row {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-1);
  }
  .type-circle {
    width: 1.5rem;
    height: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
    flex: 0 0 auto;
  }
  .type-emoji {
    font-size: 0.85rem;
    line-height: 1;
  }
  .type-label {
    font-size: 0.85rem;
    color: var(--theme-content-color);
  }
</style>
