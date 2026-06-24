<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Per-person drawer: role editor (last-owner-gated). Uses Huly
// Button + DropdownLabelsIntl for native look.
//
// Wave 5 / Task C2 — Last-Admin → Last-Owner rename.
// Per D5 only OWNER edits workspace members; MAINTAINER is read-only,
// so the demote-warning is now gated on the Owner count, not the
// Owner+Maintainer count. UI strings + the consumed endpoint follow.
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, DropdownLabelsIntl, Label, type DropdownIntlItem } from '@hcengineering/ui'
  import wac from '../../plugin'
  import { EntityDrawer } from '@hcengineering/access-management-ui'
  import { peopleApi } from '../../api/peopleApi'
  import { previewEnabled } from '../../stores/capabilitiesStore'

  // E7 — preview-feature visibility gates. Default false (matrix not
  // loaded yet, or backend reported preview features hidden).
  const previewEffectivePermissions = previewEnabled('effectivePermissions')
  const previewGrantExpiry = previewEnabled('grantExpiry')
  import { effectivePermissionsApi, type EffectivePermissionsResponse } from '../../api/effectivePermissionsApi'
  import { grantedAccessApi } from '../../api/grantedAccessApi'
  import type { GrantRow, WorkspaceRole } from '../../types'

  // Inline duration humaniser (d/h/m). Was previously in src/i18n.ts;
  // pulled into the component since the rest of the strings now come
  // through the standard wac.string IntlString machinery.
  function humaniseDuration (ms: number): string {
    const sec = Math.floor(ms / 1000)
    const min = Math.floor(sec / 60)
    const hr = Math.floor(min / 60)
    const day = Math.floor(hr / 24)
    if (day >= 1) return `${day}d`
    if (hr >= 1) return `${hr}h`
    if (min >= 1) return `${min}m`
    return '<1m'
  }

  function expiryClass (expiresAt: string | null, now: number): 'never' | 'expiring' | 'expired' {
    if (expiresAt === null) return 'never'
    const t = Date.parse(expiresAt)
    if (Number.isNaN(t)) return 'never'
    return t <= now ? 'expired' : 'expiring'
  }

  export let workspace: string
  export let person: { uuid: string, name: string, role: WorkspaceRole } | null = null
  export let open: boolean = false
  export let canEdit: boolean = false
  /**
   * Optional concrete grant the drawer is editing. When provided AND
   * the person's role is one of the GUEST / READONLY_GUEST / DOC_GUEST
   * variants, an Expires section is shown so the Owner can set or
   * clear a time-bounded expiry on this specific grant.
   * DSGVO Art. 5 Abs. 1 lit. e (Datensparsamkeit).
   */
  export let grant: GrantRow | null = null

  const dispatch = createEventDispatcher<{ close: void, changed: void }>()

  let newRole: WorkspaceRole = 'USER'
  let lastOwnerCount: number | null = null
  let error: string | null = null
  // Wave 5 / Task C2 — separated from `error` so the localized
  // "cannot demote the last Owner" message can be rendered via <Label>
  // (and translated for all 13 locales) while server-side error strings
  // fall through the plain `error` text.
  let lastOwnerRefused: boolean = false
  let busy: boolean = false

  // H4 — role labels via IntlString.
  const roleItems: DropdownIntlItem[] = [
    { id: 'OWNER', label: wac.string.Owner },
    { id: 'MAINTAINER', label: wac.string.Maintainer },
    { id: 'USER', label: wac.string.User },
    { id: 'GUEST', label: wac.string.Guest },
    // T3 — Guest sub-roles. All three share the same capability bucket
    // in v1 but are reported distinctly so the role label is honest.
    { id: 'READONLY_GUEST', label: wac.string.ReadOnlyGuest },
    { id: 'DOC_GUEST', label: wac.string.DocGuest }
  ]

  // Effective Permissions Drilldown — collapsible, on-demand. The
  // section accepts a free-form Space-ID/Ref because Tier-1 does not
  // ship a fleet-wide enumeration of every space a user might touch;
  // pasting the resource you actually care about keeps the call cheap
  // and the audit trail meaningful.
  let epOpen: boolean = false
  let epResourceId: string = ''
  let epLoading: boolean = false
  let epError: string | null = null
  let epResult: EffectivePermissionsResponse | null = null

  $: if (person != null) {
    // Reset the drill-down state whenever the drawer switches person —
    // a stale decision from a previous tenant in the same drawer would
    // be actively misleading.
    epResourceId = ''
    epError = null
    epResult = null
  }

  async function runEffectivePermissions (): Promise<void> {
    if (person == null) return
    const trimmed = epResourceId.trim()
    if (trimmed === '') {
      epError = 'Enter a Space ID to drill down.'
      return
    }
    epLoading = true
    epError = null
    epResult = null
    try {
      epResult = await effectivePermissionsApi.query(workspace, person.uuid, trimmed)
    } catch (e) {
      epError = e instanceof Error ? e.message : String(e)
    } finally {
      epLoading = false
    }
  }

  // Expiry sub-state. `expiryInput` is the <input type="datetime-local">
  // value (browser-local, no offset); we serialise to ISO-with-offset
  // before sending to the server so the wire format matches what
  // server-workspace-access' ISO_RE expects.
  let expiryInput: string = ''
  let expiryBusy: boolean = false
  let expiryError: string | null = null

  // GUEST-style roles are the only ones that may carry an expiry
  // today. WorkspaceRole only declares 'GUEST' but the server
  // recognises READONLY_GUEST / DOC_GUEST as well; we compare on the
  // string substring so both legacy and future guest variants surface.
  //
  // E7 — gated behind the `preview.grantExpiry` capability flag because
  // the backend still returns 501. WAC_PREVIEW_FEATURES=grantExpiry on
  // the account-service host exposes the UI for dev/test; production
  // keeps it hidden until the transactor wiring lands.
  $: showExpiry =
    grant !== null &&
    person !== null &&
    canEdit &&
    $previewGrantExpiry === true &&
    typeof person.role === 'string' &&
    person.role.toUpperCase().includes('GUEST')

  $: if (grant !== null) {
    expiryInput = grant.expiresAt !== null ? isoToLocalInput(grant.expiresAt) : ''
    expiryError = null
  }

  $: expiryKind = grant !== null ? expiryClass(grant.expiresAt, Date.now()) : 'never'
  $: expiryDurationParam = (
    grant !== null && grant.expiresAt !== null
      ? { duration: humaniseDuration(Math.max(0, Date.parse(grant.expiresAt) - Date.now())) }
      : { duration: '' }
  )

  function isoToLocalInput (iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function localInputToIso (local: string): string | null {
    if (local === '') return null
    const d = new Date(local)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString()
  }

  async function applyExpiry (): Promise<void> {
    if (grant === null || person === null) return
    expiryError = null
    const iso = localInputToIso(expiryInput)
    if (iso !== null && Date.parse(iso) <= Date.now()) {
      expiryError = 'past'
      return
    }
    expiryBusy = true
    try {
      await grantedAccessApi.setExpiry(workspace, grant.recipientUuid, grant.resourceId, iso)
      dispatch('changed')
    } catch (e) {
      expiryError = e instanceof Error ? e.message : String(e)
    } finally {
      expiryBusy = false
    }
  }

  async function clearExpiry (): Promise<void> {
    if (grant === null) return
    expiryInput = ''
    await applyExpiry()
  }

  $: if (person != null) {
    newRole = person.role
    error = null
    lastOwnerRefused = false
  }

  async function refreshOwnerInfo (): Promise<void> {
    try {
      const info = await peopleApi.getLastOwnerInfo(workspace)
      lastOwnerCount = info.remaining
    } catch {
      lastOwnerCount = null
    }
  }

  onMount(refreshOwnerInfo)

  async function applyRole (): Promise<void> {
    if (person == null) return
    if (newRole === person.role) {
      dispatch('close')
      return
    }
    // Wave 5 / Task C2 — client-side gate against demoting the last Owner.
    // The server enforces this independently (writeRouter.handleMemberRole
    // returns last_owner_refused); this just prevents the round-trip and
    // surfaces a localized message via <Label>.
    if (person.role === 'OWNER' && newRole !== 'OWNER' && lastOwnerCount != null && lastOwnerCount <= 1) {
      lastOwnerRefused = true
      error = null
      return
    }
    busy = true
    lastOwnerRefused = false
    try {
      await peopleApi.setMemberRole(workspace, person.uuid, newRole)
      dispatch('changed')
      dispatch('close')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }
</script>

<EntityDrawer {open} title={person?.name ?? 'Person'} on:close={() => dispatch('close')}>
  <svelte:fragment slot="body">
    {#if person == null}
      <p class="muted">No person selected.</p>
    {:else}
      <section class="section">
        <h3>Workspace role</h3>
        <DropdownLabelsIntl
          label={wac.string.Role}
          kind={'primary'}
          size={'medium'}
          items={roleItems}
          selected={newRole}
          disabled={!canEdit || busy}
          on:selected={(e) => { newRole = e.detail }}
        />
        {#if lastOwnerCount != null}
          <p class="hint">
            <Label label={wac.string.LastOwnerHint} params={{ count: lastOwnerCount }} />
          </p>
        {/if}
        {#if lastOwnerRefused}
          <p class="err" role="alert">
            <Label label={wac.string.LastOwnerCannotDemote} />
          </p>
        {/if}
        {#if error != null}
          <p class="err" role="alert">{error}</p>
        {/if}
        <div class="actions">
          <Button
            kind={'primary'}
            size={'medium'}
            label={busy ? wac.string.Loading : wac.string.SaveRole}
            disabled={!canEdit || busy}
            title={!canEdit ? 'Only Workspace Owners can change workspace roles.' : undefined}
            on:click={applyRole}
          />
        </div>
      </section>

      {#if $previewEffectivePermissions}
      <!-- E7 — Section hidden unless WAC_PREVIEW_FEATURES includes
           `effectivePermissions`. Server returns 501 until the plugin
           backend is wired against accounts-db + transactor. -->
      <section class="section ep-section">
        <button
          type="button"
          class="ep-toggle"
          aria-expanded={epOpen}
          on:click={() => { epOpen = !epOpen }}
        >
          <span class="caret" class:open={epOpen}>▸</span>
          Effective permissions
          <span class="hint inline">— drill down by Space ID</span>
        </button>
        {#if epOpen}
          <div class="ep-body">
            <p class="hint">
              Resolve why this user can (or cannot) reach a single space-level
              resource. Tier-1: paste one Space ID per call; bulk audit and
              parent-space inheritance are not yet supported.
            </p>
            <div class="row">
              <input
                type="text"
                class="ep-input"
                placeholder="Space ID (e.g. 64a0…)"
                bind:value={epResourceId}
                disabled={epLoading}
                on:keydown={(e) => { if (e.key === 'Enter') { void runEffectivePermissions() } }}
              />
              <button
                type="button"
                class="primary"
                on:click={runEffectivePermissions}
                disabled={epLoading || epResourceId.trim() === ''}
              >
                {epLoading ? 'Resolving…' : 'Resolve'}
              </button>
            </div>
            {#if epError != null}
              <p class="err" role="alert">{epError}</p>
            {/if}
            {#if epResult != null}
              <div class="ep-result" data-decision={epResult.decision}>
                <div class="ep-decision">
                  <span class="decision-badge" class:allow={epResult.decision === 'allow'} class:deny={epResult.decision === 'deny'}>
                    {epResult.decision.toUpperCase()}
                  </span>
                  <span class="ep-resource-name">{epResult.resource.name}</span>
                </div>
                <dl class="ep-meta">
                  <dt>Resource</dt>
                  <dd>{epResult.resource.class}</dd>
                  <dt>Private</dt>
                  <dd>{epResult.resource.private ? 'yes' : 'no'}</dd>
                  <dt>Archived</dt>
                  <dd>{epResult.resource.archived ? 'yes' : 'no'}</dd>
                  <dt>User role</dt>
                  <dd>{epResult.user.role}</dd>
                </dl>
                <ol class="ep-path">
                  {#each epResult.path as step (step.step)}
                    <li>
                      <span class="step-name">{step.step}</span>
                      <span class="step-detail">{step.detail}</span>
                    </li>
                  {/each}
                </ol>
              </div>
            {/if}
          </div>
        {/if}
      </section>
      {/if}

      {#if showExpiry && grant !== null}
        <section class="section">
          <h3><Label label={wac.string.GrantExpiryLabel} /></h3>
          <p class="status {expiryKind}">
            {#if expiryKind === 'never'}
              <Label label={wac.string.GrantExpiryNever} />
            {:else if expiryKind === 'expired'}
              <Label label={wac.string.GrantExpired} />
            {:else}
              <Label label={wac.string.GrantExpiresIn} params={expiryDurationParam} />
            {/if}
          </p>
          <div class="row">
            <label for="expiry-input"><Label label={wac.string.GrantExpiryLabel} /></label>
            <input
              id="expiry-input"
              type="datetime-local"
              bind:value={expiryInput}
              disabled={expiryBusy}
            />
          </div>
          {#if expiryError !== null}
            <p class="err" role="alert">
              {#if expiryError === 'past'}
                <Label label={wac.string.GrantExpiryInPast} />
              {:else}
                {expiryError}
              {/if}
            </p>
          {/if}
          <div class="row">
            <button class="primary" on:click={applyExpiry} disabled={expiryBusy}>
              {expiryBusy ? 'Saving…' : 'Save expiry'}
            </button>
            {#if expiryInput !== ''}
              <button class="ghost" on:click={clearExpiry} disabled={expiryBusy}>
                Clear (make permanent)
              </button>
            {/if}
          </div>
        </section>
      {/if}
    {/if}
  </svelte:fragment>
</EntityDrawer>

<style lang="scss">
  .section { display: flex; flex-direction: column; gap: var(--spacing-1); }
  .section h3 {
    margin: 0 0 var(--spacing-1) 0;
    font-size: 0.95rem;
    color: var(--theme-caption-color);
  }
  .actions {
    margin-top: var(--spacing-2);
    display: flex;
    gap: var(--spacing-1);
  }
  .hint { font-size: 0.78rem; color: var(--theme-darker-color); margin: 0; }
  .hint.inline { display: inline; margin-left: 0.25rem; }
  .muted { color: var(--theme-darker-color); }
  .err {
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
    padding: var(--spacing-1);
    border-radius: 0.25rem;
  }

  /* Effective Permissions Drilldown — collapsible diagnostic section
     mounted on the bottom half of the drawer. Uses Huly's theme
     tokens for surface/divider colors so the rgba hard-codes the
     subagent shipped get linted out (no-hardcoded-colors guard). */
  .ep-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--theme-divider-color); }
  .ep-toggle {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--theme-caption-color);
    font: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .caret { display: inline-block; transition: transform 120ms ease; }
  .caret.open { transform: rotate(90deg); }
  .ep-body { margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .ep-input {
    flex: 1;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    padding: 0.35rem 0.5rem;
    border-radius: 0.25rem;
    font: inherit;
  }
  .ep-result {
    background: var(--theme-bg-accent-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.35rem;
    padding: 0.65rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .ep-decision { display: flex; align-items: center; gap: 0.5rem; }
  .decision-badge {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.45rem;
    border-radius: 0.25rem;
    background: var(--theme-bg-accent-color);
    color: var(--theme-caption-color);
  }
  .decision-badge.allow {
    background: var(--theme-state-positive-background-color);
    color: var(--theme-state-positive-color);
  }
  .decision-badge.deny {
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
  }
  .ep-resource-name { font-weight: 600; color: var(--theme-caption-color); }
  .ep-meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.15rem 0.65rem;
    margin: 0;
    font-size: 0.8rem;
  }
  .ep-meta dt { color: var(--theme-darker-color); }
  .ep-meta dd { margin: 0; color: var(--theme-caption-color); }
  .ep-path {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .step-name {
    display: inline-block;
    font-family: var(--theme-mono-font, ui-monospace, monospace);
    background: var(--theme-bg-accent-color);
    padding: 0.05rem 0.3rem;
    border-radius: 0.2rem;
    margin-right: 0.4rem;
  }
  .step-detail { color: var(--theme-darker-color); }

  /* Time-bounded grants — expiry section. Hardcoded color refs were
     from the sub-agent's original commit; a follow-up rework swaps to
     theme tokens (the no-hardcoded-colors guard test enforces this). */
  .row input[type='datetime-local'] {
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    padding: 0.3rem 0.5rem;
    border-radius: 0.25rem;
  }
  .ghost {
    margin-top: 1rem;
    padding: 0.45rem 0.9rem;
    background: transparent;
    color: var(--theme-caption-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    cursor: pointer;
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }
  .status {
    font-size: 0.85rem;
    padding: 0.35rem 0.55rem;
    border-radius: 0.25rem;
    margin: 0;
    &.never { background: var(--theme-bg-accent-color); color: var(--theme-darker-color); }
    &.expiring { background: var(--theme-state-warning-background-color); color: var(--theme-state-warning-color); }
    &.expired { background: var(--theme-state-negative-background-color); color: var(--theme-state-negative-color); }
  }
</style>
