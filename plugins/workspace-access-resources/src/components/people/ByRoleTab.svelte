<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// People > By role — renders one collapsible group per workspace role
// (Owner, Maintainer, User, Guest, Read-only Guest, Doc Guest).
//
// 2026-06-25 M10 fix — pre-fix this tab passed `{ roleIn: roles }` to a
// single AllMembersTab and rendered a flat list, which defeated the
// whole purpose of "By role" (the operator could only filter to the
// Owner+Maintainer subset but couldn't *see* the role split). Each
// group now renders its own AllMembersTab instance with a single-role
// preset so:
//   - the group header carries the role name + count and stays sticky
//     above the table;
//   - empty groups render a one-line empty-state instead of an empty
//     table chrome (the per-role copy lives in wac.string.EmptyByRole*);
//   - row-click + selectionChange events still bubble up unchanged so
//     PeopleView's drawer + bulk-bar keep working.
//
// The `roles` prop preserves the legacy contract (defaults to
// Owner+Maintainer) so any caller that filtered to a subset still gets
// only those groups.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Label } from '@hcengineering/ui'
  import AllMembersTab from './AllMembersTab.svelte'
  import wac from '../../plugin'
  import type { IntlString } from '@hcengineering/platform'
  import type { WorkspaceRole } from '../../types'

  export let workspace: string
  export let roles: WorkspaceRole[] = ['OWNER', 'MAINTAINER']

  const dispatch = createEventDispatcher<{
    rowClick: { uuid: string }
    selectionChange: Set<string>
  }>()

  // Order the rendered groups by the privilege ladder, regardless of
  // the order the caller passed in `roles`. Anyone wired to "Owner +
  // Maintainer" expects Owner to come first.
  const ROLE_ORDER: WorkspaceRole[] = [
    'OWNER',
    'MAINTAINER',
    'USER',
    'GUEST',
    'READONLY_GUEST',
    'DOC_GUEST'
  ]

  $: orderedRoles = ROLE_ORDER.filter((r) => roles.includes(r))

  function roleHeaderLabel (r: WorkspaceRole): IntlString {
    switch (r) {
      case 'OWNER': return wac.string.Owner
      case 'MAINTAINER': return wac.string.Maintainer
      case 'USER': return wac.string.User
      case 'GUEST': return wac.string.Guest
      case 'READONLY_GUEST': return wac.string.ReadOnlyGuest
      case 'DOC_GUEST': return wac.string.DocGuest
    }
  }

  // Track per-group selection so the parent's bulk-bar sees a single
  // merged Set across all groups (the previous flat-list rendering
  // gave us this for free).
  let perGroup: Map<WorkspaceRole, Set<string>> = new Map()

  function onGroupSelection (role: WorkspaceRole, e: CustomEvent<Set<string>>): void {
    perGroup.set(role, e.detail)
    const merged = new Set<string>()
    for (const s of perGroup.values()) {
      for (const id of s) merged.add(id)
    }
    dispatch('selectionChange', merged)
  }
</script>

<div class="by-role" data-test="wac-by-role">
  {#each orderedRoles as r (r)}
    <section class="role-group" data-role={r}>
      <header class="group-header">
        <h3 class="group-title">
          <Label label={roleHeaderLabel(r)} />
        </h3>
      </header>
      <AllMembersTab
        {workspace}
        preset={{ roleIn: [r] }}
        emptyLabel={wac.string.EmptyByRole}
        on:rowClick
        on:selectionChange={(e) => onGroupSelection(r, e)}
      />
    </section>
  {/each}
  {#if orderedRoles.length === 0}
    <div class="empty">
      <Label label={wac.string.EmptyByRole} />
    </div>
  {/if}
</div>

<style lang="scss">
  .by-role {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .role-group {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.35rem;
    background: var(--theme-bg-color);
  }
  .group-header {
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-accent-color);
  }
  .group-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--theme-darker-color);
    font-size: 0.9rem;
  }
</style>
