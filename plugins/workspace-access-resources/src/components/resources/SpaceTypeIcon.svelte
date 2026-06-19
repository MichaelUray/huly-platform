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

<span class="type-pill" style="--c: {info.color}">
  <span class="emoji" aria-hidden="true">{info.emoji}</span>
  <span class="label">{info.label}</span>
</span>

<style lang="scss">
  .type-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    padding: 0.1rem 0.45rem;
    border-radius: 0.25rem;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
  }
</style>
