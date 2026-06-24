<script lang="ts">
  import { onMount } from 'svelte'
  import { TabList, showPopup } from '@hcengineering/ui'
  import { MessageBox } from '@hcengineering/presentation'
  import wac from '../../plugin'
  import SpaceDrawer from '../resources/SpaceDrawer.svelte'
  import { myAccessApi, type MyAccessSummary } from '../../api/myAccessApi'
  import type { SpaceRow, GrantRow } from '../../types'

  export let workspace: string

  type Sub = 'role' | 'member-of' | 'owned' | 'received' | 'given'
  let sub: Sub = 'role'
  const subItems = [
    { id: 'role', labelIntl: wac.string.MyAccessTabRole },
    { id: 'member-of', labelIntl: wac.string.MyAccessTabMemberOf },
    { id: 'owned', labelIntl: wac.string.MyAccessTabOwned },
    { id: 'received', labelIntl: wac.string.MyAccessTabReceived },
    { id: 'given', labelIntl: wac.string.MyAccessTabGiven }
  ]
  let summary: MyAccessSummary | null = null
  let loading: boolean = true
  let error: string | null = null
  let drawerSpaceId: string | null = null
  let drawerOpen: boolean = false

  async function load (): Promise<void> {
    loading = true
    try {
      summary = await myAccessApi.getSummary(workspace)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  onMount(load)

  async function leave (space: SpaceRow): Promise<void> {
    // Polish-1: native confirm() prompts are unstyled, blocking, and
    // inaccessible to translators. Route through Huly's MessageBox so
    // the dialog is themed + i18n-able + Esc-cancelable.
    showPopup(MessageBox, {
      label: wac.string.ConfirmLeaveSpaceTitle,
      labelProps: { name: space.name },
      message: wac.string.ConfirmLeaveSpaceMessage,
      dangerous: true,
      action: async () => {
        try {
          await myAccessApi.leaveSpace(workspace, space._id)
          await load()
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
        }
      }
    })
  }

  async function decline (g: GrantRow): Promise<void> {
    showPopup(MessageBox, {
      label: wac.string.ConfirmDeclineGrantTitle,
      labelProps: { title: g.resourceTitle },
      message: wac.string.ConfirmDeclineGrantMessage,
      dangerous: true,
      action: async () => {
        try {
          await myAccessApi.declineGrant(workspace, g.resourceId)
          await load()
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
        }
      }
    })
  }
</script>

<div class="my-access-view" id="wac-panel-my-access" role="tabpanel">
  <div class="sub-tabs">
    <TabList
      items={subItems}
      selected={sub}
      kind={'separated'}
      size={'small'}
      on:select={(e) => { sub = e.detail.id }}
    />
  </div>

  <div class="content">
    {#if error != null}<div class="err" role="alert">{error}</div>{/if}
    {#if loading}
      <div class="hint">Loading…</div>
    {:else if summary == null}
      <div class="hint">No data available.</div>
    {:else}
      {#if sub === 'role'}
        <section>
          <h3>My workspace role</h3>
          <p class="big">{summary.role}</p>
          <p class="hint">Role changes are managed by a workspace Owner from the People view.</p>
        </section>
      {:else if sub === 'member-of'}
        <ul class="space-list">
          {#each summary.spacesMemberOf as s (s._id)}
            <li>
              <span class="space-name">{s.name}</span>
              <span class="muted">({s._class.split('.')[0]})</span>
              {#if !s.archived}<button class="ghost" on:click={() => leave(s)}>Leave</button>{/if}
            </li>
          {:else}
            <li class="hint">You are not a member of any space.</li>
          {/each}
        </ul>
      {:else if sub === 'owned'}
        <ul class="space-list">
          {#each summary.spacesOwned as s (s._id)}
            <li>
              <span class="space-name">{s.name}</span>
              <span class="muted">({s._class.split('.')[0]})</span>
              <button class="ghost" on:click={() => { drawerSpaceId = s._id; drawerOpen = true }}>Manage access</button>
            </li>
          {:else}
            <li class="hint">You don't own any space.</li>
          {/each}
        </ul>
      {:else if sub === 'received'}
        <ul class="grant-list">
          {#each summary.grantsReceived as g (g.resourceId)}
            <li>
              <span class="grant-title">{g.resourceTitle}</span>
              <span class="muted">by {g.granterName}</span>
              <button class="ghost" on:click={() => decline(g)}>Decline</button>
            </li>
          {:else}
            <li class="hint">No grants received.</li>
          {/each}
        </ul>
      {:else if sub === 'given'}
        <ul class="grant-list">
          {#each summary.grantsGiven as g (g.resourceId + g.recipientUuid)}
            <li>
              <span class="grant-title">{g.resourceTitle}</span>
              <span class="muted">to {g.recipientName}</span>
            </li>
          {:else}
            <li class="hint">You haven't granted access to anyone.</li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  <SpaceDrawer
    {workspace}
    spaceId={drawerSpaceId}
    open={drawerOpen}
    canEditFlags={false}
    canEditMembership={true}
    on:close={() => { drawerOpen = false; drawerSpaceId = null }}
    on:changed={load}
  />
</div>

<style lang="scss">
  .my-access-view { display: flex; flex-direction: column; min-height: 100%; }
  .sub-tabs {
    padding: var(--spacing-1) 0 var(--spacing-2);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .content { padding: var(--spacing-2) 0; }
  .big { font-size: 1.4rem; font-weight: 600; color: var(--theme-caption-color); }
  .hint { color: var(--theme-darker-color); font-size: 0.9rem; padding: 0.5rem 0; }
  .err { background: var(--theme-state-negative-background-color); color: var(--theme-state-negative-color); padding: 0.5rem; border-radius: 0.25rem; margin-bottom: 0.75rem; }
  .space-list, .grant-list {
    list-style: none; padding: 0; margin: 0;
    li {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--theme-divider-color);
      &:last-child { border-bottom: 0; }
    }
  }
  .space-name, .grant-title { flex: 1; color: var(--theme-caption-color); }
  .muted { color: var(--theme-darker-color); font-size: 0.85rem; }
  .ghost {
    background: transparent; border: 1px solid var(--theme-divider-color);
    padding: 0.25rem 0.6rem; border-radius: 0.25rem;
    color: var(--theme-darker-color); cursor: pointer; font-size: 0.8rem;
    &:hover { color: var(--theme-caption-color); background: var(--theme-bg-accent-color); }
  }
</style>
