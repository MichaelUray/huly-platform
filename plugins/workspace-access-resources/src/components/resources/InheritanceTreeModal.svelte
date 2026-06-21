<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// A4 (Tier-1) — minimal read-only inheritance visualizer.
//
// Renders the access-inheritance tree as Workspace → SpaceType → Space.
// Pure client-side: groups the already-loaded `spaces` list by `_class`
// (= SpaceType-Identifier in Huly's model) so there is no extra API
// round-trip when the operator pops the modal open.
//
// Scope is intentionally narrow for Tier-1:
//   - no click-through into individual spaces (the AllSpacesTab row click
//     already opens the SpaceDrawer for edit; this view is for the
//     "where does Bob get his access from?" overview question only),
//   - no live edit, no drilldown into child docs / channels,
//   - no async traversal of grant chains (Tier-2).
//
// Pattern mirrors AuditView.svelte's dsgvo-modal: a fixed-position
// overlay div with role="dialog" + aria-modal="true" + Esc-to-close.
// Using a hand-rolled overlay (vs. @hcengineering/ui's Modal component)
// keeps the dependency surface identical to AuditView and avoids the
// type-aside | type-popup | type-component contract that Modal carries.
-->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { Button, Label } from '@hcengineering/ui'
  import wac from '../../plugin'
  import SpaceTypeIcon from './SpaceTypeIcon.svelte'
  import type { SpaceClass, SpaceRow } from '../../types'

  export let workspace: string
  // Caller passes the same `spaces` list the AllSpacesTab already
  // loaded — no second fetch. Placeholder v2 rows are filtered out
  // because they are not "real" spaces with members.
  export let spaces: SpaceRow[] = []

  const dispatch = createEventDispatcher<{ close: void }>()

  // Group spaces by `_class` (SpaceType identifier). Within each
  // group, sort alphabetically by name (case-insensitive) so the
  // ordering is stable and operator-friendly.
  interface Group {
    cls: SpaceClass
    spaces: SpaceRow[]
  }

  $: realSpaces = spaces.filter((s) => s.capabilities?.v2NotYet !== true)

  $: groups = (() => {
    const map = new Map<SpaceClass, SpaceRow[]>()
    for (const s of realSpaces) {
      const bucket = map.get(s._class)
      if (bucket === undefined) {
        map.set(s._class, [s])
      } else {
        bucket.push(s)
      }
    }
    const out: Group[] = []
    // Sort groups by class identifier so the modal layout is stable
    // across renders (Map iteration order is insertion order in V8,
    // but explicit sort is cheap and removes any ambiguity).
    const classes = Array.from(map.keys()).sort((a, b) => a.localeCompare(b))
    for (const cls of classes) {
      const list = (map.get(cls) ?? []).slice().sort(
        (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      )
      out.push({ cls, spaces: list })
    }
    return out
  })()

  function close (): void {
    dispatch('close')
  }

  function onKeyDown (e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  function onBackdropClick (e: MouseEvent): void {
    // Only close when the click landed on the backdrop itself, not
    // on the modal body (otherwise selecting text inside the dialog
    // would dismiss it).
    if (e.target === e.currentTarget) close()
  }

  onMount(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKeyDown)
    }
  })

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeyDown)
    }
  })
</script>

<div
  class="inheritance-modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="wac-inheritance-title"
  on:click={onBackdropClick}
>
  <div class="modal-body">
    <header>
      <h3 id="wac-inheritance-title">
        <Label label={wac.string.InheritanceTreeTitle} />
      </h3>
      <Button
        kind={'ghost'}
        size={'small'}
        label={wac.string.Close}
        on:click={close}
      />
    </header>

    <div class="tree" data-test="wac-inheritance-tree">
      <div class="row workspace-row">
        <span class="connector">▼</span>
        <span class="ws-label">{workspace}</span>
      </div>

      {#if groups.length === 0}
        <div class="empty">
          <Label label={wac.string.InheritanceTreeEmpty} />
        </div>
      {:else}
        {#each groups as g (g.cls)}
          <div class="row group-row">
            <span class="connector">├─</span>
            <SpaceTypeIcon cls={g.cls} />
            <span class="count">({g.spaces.length})</span>
          </div>
          <ul class="space-list">
            {#each g.spaces as s (s._id)}
              <li class="space-row">
                <span class="connector">│&nbsp;&nbsp;└─</span>
                <span class="space-name">{s.name}</span>
                <span class="member-badge" title="Members in this space">
                  {s.membersCount}
                </span>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .inheritance-modal {
    position: fixed;
    inset: 0;
    z-index: 970;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal-body {
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    padding: 1.5rem;
    max-width: 36rem;
    width: 92vw;
    max-height: 80vh;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h3 {
    margin: 0;
    color: var(--theme-caption-color);
    font-size: 1rem;
  }
  .tree {
    font-family: var(--mono-font, monospace);
    font-size: 0.9rem;
    color: var(--theme-content-color);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
  }
  .workspace-row {
    font-weight: 600;
    color: var(--theme-caption-color);
    border-bottom: 1px solid var(--theme-divider-color);
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .group-row {
    margin-top: 0.5rem;
  }
  .ws-label {
    font-family: inherit;
  }
  .connector {
    color: var(--theme-darker-color);
    white-space: pre;
  }
  .count {
    color: var(--theme-darker-color);
    font-size: 0.8rem;
  }
  .space-list {
    list-style: none;
    margin: 0;
    padding: 0 0 0 0.5rem;
  }
  .space-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0;
  }
  .space-name {
    flex: 1;
    color: var(--theme-content-color);
  }
  .member-badge {
    display: inline-block;
    min-width: 1.5rem;
    text-align: center;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.7rem;
    background: var(--theme-mention-bg-color);
    color: var(--theme-link-color);
    border: 1px solid var(--theme-divider-color);
  }
  .empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--theme-darker-color);
    font-style: italic;
  }
</style>
