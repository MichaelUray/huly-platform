<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// WAC Permission Templates (Presets) — 6th tab in AccessCenter.
//
// Workspace-local list of reusable Role+Spaces templates an Owner can
// apply to selected members in one click. Snapshot-at-apply: editing a
// preset later does NOT change members that were already configured via
// the previous shape. See server-plugins/workspace-access/src/http/presetsRouter.ts
// for the contract.
//
// v1 UX scope:
//   - List existing presets with name + role + space-count + actions
//   - Inline create form (name / description / role / comma-separated space IDs)
//   - Inline edit form per preset (reuses the same fields)
//   - Apply form: textarea of member UUIDs (one per line) + summary
//   - MessageBox confirmation for destructive delete
//
// A live SpacePicker + MemberPickerInput will replace the textareas in
// v1.5 once the wac.api.searchSpaces / searchMembers endpoints land;
// the same FIXME-pattern as SpacePickerModal.svelte applies here.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { Button, EditBox, Label, showPopup } from '@hcengineering/ui'
  import { MessageBox } from '@hcengineering/presentation'
  import wac from '../../plugin'
  import {
    presetsApi,
    type PresetRow,
    type PresetShape,
    type ApplyResponse
  } from '../../api/presetsApi'
  import type { WorkspaceRole } from '../../types'

  export let workspace: string
  export let canEdit: boolean = true

  let items: PresetRow[] = []
  let loading: boolean = true
  let error: string | null = null

  // Inline create/edit form state. When `editId` is non-null we're
  // editing an existing row; otherwise the form is a create form (and
  // hidden until the user clicks "Create preset").
  let formOpen: boolean = false
  let editId: string | null = null
  let formName: string = ''
  let formDescription: string = ''
  let formRole: WorkspaceRole = 'USER'
  let formSpacesText: string = ''
  let formBusy: boolean = false

  // Apply form state — one preset at a time.
  let applyId: string | null = null
  let applyMembersText: string = ''
  let applyBusy: boolean = false
  let applyResult: ApplyResponse | null = null

  const ROLES: WorkspaceRole[] = [
    'OWNER',
    'MAINTAINER',
    'USER',
    'GUEST',
    'READONLY_GUEST',
    'DOC_GUEST'
  ]

  async function load (): Promise<void> {
    loading = true
    error = null
    try {
      const page = await presetsApi.list(workspace)
      items = page.items
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  onMount(load)

  function parseSpaces (text: string): string[] {
    return text
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  function parseMembers (text: string): string[] {
    return text
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  function resetForm (): void {
    editId = null
    formName = ''
    formDescription = ''
    formRole = 'USER'
    formSpacesText = ''
    formOpen = false
  }

  function openCreateForm (): void {
    resetForm()
    formOpen = true
  }

  function openEditForm (p: PresetRow): void {
    editId = p.id
    formName = p.name
    formDescription = p.description ?? ''
    formRole = p.shape.role
    formSpacesText = p.shape.addToSpaces.join(', ')
    formOpen = true
    // Close any apply session targeting a different preset.
    if (applyId !== editId) {
      applyId = null
      applyResult = null
      applyMembersText = ''
    }
  }

  async function submitForm (): Promise<void> {
    if (!canEdit) return
    const name = formName.trim()
    if (name === '') return
    const shape: PresetShape = {
      role: formRole,
      addToSpaces: parseSpaces(formSpacesText)
    }
    const description = formDescription.trim() === '' ? null : formDescription.trim()
    formBusy = true
    error = null
    try {
      if (editId != null) {
        await presetsApi.update(workspace, editId, { name, description, shape })
      } else {
        await presetsApi.create(workspace, { name, description, shape })
      }
      resetForm()
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      formBusy = false
    }
  }

  function confirmDelete (p: PresetRow): void {
    showPopup(MessageBox, {
      label: wac.string.PresetConfirmDeleteTitle,
      labelProps: { name: p.name },
      message: wac.string.PresetConfirmDeleteMessage,
      dangerous: true,
      action: async () => {
        try {
          await presetsApi.remove(workspace, p.id)
          if (editId === p.id) resetForm()
          if (applyId === p.id) {
            applyId = null
            applyResult = null
          }
          await load()
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
        }
      }
    })
  }

  function openApply (p: PresetRow): void {
    applyId = p.id
    applyMembersText = ''
    applyResult = null
    // Close edit form if it's targeting a different row.
    if (editId !== p.id) resetForm()
  }

  async function submitApply (p: PresetRow): Promise<void> {
    const memberUuids = parseMembers(applyMembersText)
    if (memberUuids.length === 0) return
    applyBusy = true
    error = null
    try {
      applyResult = await presetsApi.apply(workspace, p.id, memberUuids)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      applyBusy = false
    }
  }
</script>

<div class="presets-view" id="wac-panel-presets" role="tabpanel">
  <div class="toolbar">
    {#if canEdit}
      <Button
        kind={'primary'}
        size={'medium'}
        label={wac.string.PresetCreate}
        on:click={openCreateForm}
        disabled={formOpen && editId == null}
      />
    {/if}
    <Button
      kind={'ghost'}
      size={'medium'}
      label={wac.string.Refresh}
      on:click={load}
    />
  </div>

  {#if error != null}
    <div class="err" role="alert">{error}</div>
  {/if}

  {#if formOpen}
    <section class="form" aria-labelledby="preset-form-title">
      <h3 id="preset-form-title">
        {#if editId != null}
          <Label label={wac.string.PresetEdit} />
        {:else}
          <Label label={wac.string.PresetCreate} />
        {/if}
      </h3>
      <div class="field">
        <span class="field-label"><Label label={wac.string.PresetName} /></span>
        <EditBox bind:value={formName} placeholder={'Sales onboarding'} autoFocus />
      </div>
      <div class="field">
        <span class="field-label"><Label label={wac.string.PresetDescription} /></span>
        <EditBox bind:value={formDescription} placeholder={'Optional'} />
      </div>
      <div class="field">
        <span class="field-label"><Label label={wac.string.PresetRole} /></span>
        <!-- Native <select> matches the existing AuditView dropdown
             approach (no extra @hcengineering/ui dependency required). -->
        <!-- svelte-ignore a11y-no-onchange -->
        <select bind:value={formRole}>
          {#each ROLES as r}
            <option value={r}>{r}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <span class="field-label"><Label label={wac.string.PresetSpaces} /></span>
        <textarea
          bind:value={formSpacesText}
          rows="3"
          placeholder={'space-uuid-1, space-uuid-2'}
        />
        <div class="hint"><Label label={wac.string.PresetSpacesHint} /></div>
      </div>
      <div class="footer">
        <Button
          kind={'primary'}
          size={'medium'}
          label={wac.string.Save}
          loading={formBusy}
          disabled={!canEdit || formName.trim() === '' || formBusy}
          on:click={submitForm}
        />
        <Button
          kind={'ghost'}
          size={'medium'}
          label={wac.string.Cancel}
          on:click={resetForm}
        />
      </div>
    </section>
  {/if}

  <section class="list" aria-label="Presets">
    {#if loading}
      <div class="hint"><Label label={wac.string.Loading} /></div>
    {:else if items.length === 0}
      <div class="empty"><Label label={wac.string.PresetEmptyState} /></div>
    {:else}
      <ul>
        {#each items as p (p.id)}
          <li class="row" data-test="preset-row" data-preset-id={p.id}>
            <div class="row-header">
              <div class="name">{p.name}</div>
              <div class="meta">
                <span class="badge">{p.shape.role}</span>
                <span class="meta-text">
                  {p.shape.addToSpaces.length}
                  {p.shape.addToSpaces.length === 1 ? 'space' : 'spaces'}
                </span>
              </div>
            </div>
            {#if p.description != null && p.description !== ''}
              <div class="description">{p.description}</div>
            {/if}
            <div class="actions">
              {#if canEdit}
                <Button
                  kind={'primary'}
                  size={'small'}
                  label={wac.string.PresetApply}
                  on:click={() => openApply(p)}
                />
                <Button
                  kind={'ghost'}
                  size={'small'}
                  label={wac.string.PresetEdit}
                  on:click={() => openEditForm(p)}
                />
                <Button
                  kind={'dangerous'}
                  size={'small'}
                  label={wac.string.PresetDelete}
                  on:click={() => confirmDelete(p)}
                />
              {/if}
            </div>

            {#if applyId === p.id}
              <div class="apply-form" aria-labelledby="apply-{p.id}-title">
                <h4 id="apply-{p.id}-title"><Label label={wac.string.PresetApply} /></h4>
                <div class="field">
                  <span class="field-label">
                    <Label label={wac.string.PresetApplyMembersLabel} />
                  </span>
                  <textarea
                    bind:value={applyMembersText}
                    rows="4"
                    placeholder={'member-uuid-1\nmember-uuid-2'}
                  />
                </div>
                <div class="footer">
                  <Button
                    kind={'primary'}
                    size={'small'}
                    label={wac.string.PresetApply}
                    loading={applyBusy}
                    disabled={!canEdit || parseMembers(applyMembersText).length === 0 || applyBusy}
                    on:click={() => submitApply(p)}
                  />
                  <Button
                    kind={'ghost'}
                    size={'small'}
                    label={wac.string.Close}
                    on:click={() => { applyId = null; applyResult = null }}
                  />
                </div>
                {#if applyResult != null}
                  <div class="apply-summary" data-test="preset-apply-summary">
                    <Label
                      label={wac.string.PresetApplySummary}
                      params={{ applied: applyResult.applied, total: applyResult.results.length }}
                    />
                    <ul class="results">
                      {#each applyResult.results as r}
                        <li class="result-{r.status}">
                          <code>{r.memberUuid}</code> — {r.status}
                          {#if r.status === 'ok'} ({r.addedToSpaces} spaces){/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style lang="scss">
  .presets-view {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2, 0.75rem);
  }
  .toolbar {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }
  .err {
    color: var(--theme-state-negative-color);
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--theme-state-negative-color);
    border-radius: 0.35rem;
    font-size: 0.85rem;
  }
  .hint {
    color: var(--theme-darker-color);
    font-size: 0.85rem;
    padding: 0.25rem 0;
  }
  .empty {
    padding: 2rem 1rem;
    color: var(--theme-darker-color);
    background: var(--theme-bg-accent-color);
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.5rem;
    text-align: center;
  }
  .form, .apply-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--theme-bg-accent-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .field-label {
    font-size: 0.72rem;
    color: var(--theme-darker-color);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  textarea, select {
    font: inherit;
    color: var(--theme-content-color);
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.35rem;
    padding: 0.4rem 0.5rem;
    resize: vertical;
  }
  .footer {
    display: flex;
    gap: 0.5rem;
    flex-direction: row-reverse;
    justify-content: flex-end;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .row {
    padding: 0.85rem 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background: var(--theme-bg-color);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .row-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
  }
  .name {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.78rem;
    color: var(--theme-darker-color);
  }
  .badge {
    padding: 0.1rem 0.5rem;
    background: var(--theme-bg-accent-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 999px;
    font-family: var(--theme-font-mono, ui-monospace);
    font-size: 0.72rem;
  }
  .description {
    font-size: 0.85rem;
    color: var(--theme-darker-color);
  }
  .actions {
    display: flex;
    gap: 0.4rem;
  }
  .apply-summary {
    font-size: 0.85rem;
    color: var(--theme-content-color);
  }
  .results {
    margin-top: 0.5rem;
    gap: 0.25rem;
    font-size: 0.78rem;
  }
  .results li code {
    background: var(--theme-bg-accent-color);
    padding: 0 0.25rem;
    border-radius: 0.2rem;
  }
  .result-ok { color: var(--theme-state-positive-color, inherit); }
  .result-last_owner_refused,
  .result-internal,
  .result-not_found { color: var(--theme-state-negative-color, inherit); }
</style>
