<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Export button with client-side rate-limit (default 5/min) tracked
// via sessionStorage. The token is sent via Authorization header (not
// URL parameter) to avoid leaking through proxy logs.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let endpoint: string
  export let label: string = 'Export CSV'
  export let token: string | null = null
  export let rateLimitPerMinute: number = 5
  export let storageKey: string = 'amui:export:ts'

  const dispatch = createEventDispatcher<{ rateLimited: void, exported: { url: string } }>()

  let busy: boolean = false
  let rateError: string | null = null

  function recentExportTimestamps (): number[] {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.sessionStorage.getItem(storageKey)
      if (raw == null) return []
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return []
      const cutoff = Date.now() - 60_000
      return arr.filter((t: unknown) => typeof t === 'number' && t > cutoff)
    } catch {
      return []
    }
  }

  function recordExportTimestamp (): void {
    if (typeof window === 'undefined') return
    const next = recentExportTimestamps()
    next.push(Date.now())
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(next))
    } catch { /* quota exhausted: ignore */ }
  }

  async function onClick (): Promise<void> {
    if (busy) return
    rateError = null
    const recent = recentExportTimestamps()
    if (recent.length >= rateLimitPerMinute) {
      rateError = `Rate limit (${rateLimitPerMinute}/min) reached. Try again shortly.`
      dispatch('rateLimited')
      return
    }
    busy = true
    try {
      const headers: Record<string, string> = { Accept: 'text/csv' }
      if (token != null) headers.Authorization = `Bearer ${token}`
      const resp = await fetch(endpoint, { headers })
      if (!resp.ok) {
        rateError = `Export failed: ${resp.status}`
        return
      }
      recordExportTimestamp()
      const blob = await resp.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = endpoint.split('/').pop() ?? 'export.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Avoid leaking the object URL.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
      dispatch('exported', { url: endpoint })
    } catch (err) {
      rateError = `Export error: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      busy = false
    }
  }
</script>

<div class="export-wrap">
  <button
    class="btn"
    on:click={onClick}
    disabled={busy}
    data-test="audit-export-csv"
  >{busy ? 'Exporting…' : label}</button>
  {#if rateError != null}
    <span class="err" role="alert">{rateError}</span>
  {/if}
</div>

<style lang="scss">
  .export-wrap { display: inline-flex; align-items: center; gap: 0.75rem; }
  .btn {
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    background: var(--theme-bg-accent-color);
    color: var(--theme-caption-color);
    cursor: pointer;
    font-size: 0.85rem;
    &:hover:not([disabled]) { background: var(--theme-divider-color); }
    &[disabled] { opacity: 0.5; cursor: progress; }
  }
  .err { font-size: 0.8rem; color: #b91c1c; }
</style>
