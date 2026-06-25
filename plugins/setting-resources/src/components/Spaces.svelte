<!--
// Copyright © 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<!--
  Phase 2 T1 + E4 amendment (B2). The legacy `Global Space Admins`
  Settings entry (route `/setting/allSpaces`) is hidden from the sidebar
  (see WorkspaceSettingCategory `hidden: true` in models/setting), but
  the deep-link continues to resolve to this editor. The Access Center →
  Resources tab does NOT expose role assignments on the meta
  `core.space.Space` (SpaceType registry); Resources lists only the v1
  managed classes. Codex E4 (B2) blocked the Phase 2 shim because it
  removed the only UI for editing those Space-registry role assignments.
  We keep the original editor below; the category stays hidden so it
  doesn't appear in the sidebar, but bookmarked deep-links AND admin
  workflows that depend on the editor keep working.
-->
<script lang="ts">
  import { Header, Breadcrumb, Label } from '@hcengineering/ui'
  import core, { AccountUuid, Ref, Role, RolesAssignment, SpaceType, TypedSpace, WithLookup } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'

  import setting from '../plugin'

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let space: TypedSpace
  let spaceType: WithLookup<SpaceType>

  const spaceQuery = createQuery()
  spaceQuery.query(
    core.class.TypedSpace,
    {
      _id: core.space.Space
    },
    (res) => {
      space = res[0]
    }
  )

  const typeQuery = createQuery()
  $: if (space?.type !== undefined) {
    typeQuery.query(
      core.class.SpaceType,
      {
        _id: core.spaceType.SpacesType
      },
      (res) => {
        spaceType = res[0]
      },
      {
        lookup: {
          _id: { roles: core.class.Role }
        }
      }
    )
  }
  $: roles = (spaceType?.$lookup?.roles ?? []) as Role[]
  // 2026-06-25 M18 fix — pre-fix this component rendered a header +
  // an empty grey body whenever \`roles\` was [] (which is the case
  // on a workspace where the SpacesType SpaceType has not had any
  // Role docs created yet, OR while the typeQuery is still in-flight
  // before the first reactive tick lands). The operator landing on
  // /setting/allSpaces saw a near-empty page with no explanation and
  // no path forward, which on Codex E4 the reviewer flagged because
  // it surfaces as "broken page" rather than "no data yet".
  //
  // We split the render into three explicit states:
  //   - loading  — query is still in flight (space or spaceType nil)
  //   - empty    — both loaded, but no Role rows defined for this
  //                workspace (genuine no-data state, not a bug)
  //   - editor   — the original AccountArrayEditor stack
  $: editorLoading = space === undefined || spaceType === undefined
  $: editorEmpty = !editorLoading && roles.length === 0

  let rolesAssignment: RolesAssignment = {}
  $: {
    if (space !== undefined && spaceType?.targetClass !== undefined) {
      const asMixin = hierarchy.as(space, spaceType?.targetClass)

      rolesAssignment = roles.reduce<RolesAssignment>((prev, { _id }) => {
        prev[_id] = (asMixin as any)[_id] ?? []

        return prev
      }, {})
    }
  }

  async function handleRoleAssignmentChanged (roleId: Ref<Role>, newMembers: AccountUuid[]): Promise<void> {
    await client.updateMixin(space._id, space._class, core.space.Space, spaceType.targetClass, {
      [roleId]: newMembers
    })
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Views} label={setting.string.Spaces} size="large" isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    {#if editorLoading}
      <div class="state state--loading" data-test="wac-allspaces-loading">
        <p><Label label={setting.string.Spaces} /> — loading…</p>
      </div>
    {:else if editorEmpty}
      <!-- M18 — distinguish "still loading" from "no roles defined
           yet" so the operator isn't staring at a near-empty page
           with no breadcrumb of what's happening. -->
      <div class="state state--empty" data-test="wac-allspaces-empty">
        <h3><Label label={setting.string.Spaces} /></h3>
        <p>
          No workspace-wide role assignments have been created for
          the meta SpacesType yet. This page lists the members of
          each globally-defined Role and lets a Workspace Owner add
          or remove accounts. The list will populate as soon as a
          Role document exists in the SpacesType registry.
        </p>
      </div>
    {:else}
      {#each roles as role}
        <div class="antiGrid-row">
          <div class="antiGrid-row__header">
            {role.name}
          </div>
          <AccountArrayEditor
            value={rolesAssignment?.[role._id] ?? []}
            label={core.string.Members}
            onChange={(refs) => {
              void handleRoleAssignmentChanged(role._id, refs)
            }}
            kind="regular"
            size="large"
          />
        </div>
      {/each}
    {/if}
  </div>
</div>

<style lang="scss">
  .content {
    margin: 2rem 3.25rem;
  }
  /* M18 — explicit loading / empty states so the page never reads as
     "broken" while the underlying query is still in-flight or while
     the SpacesType registry has no Role rows. */
  .state {
    padding: 1.5rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.5rem;
    background: var(--theme-bg-accent-color);
    color: var(--theme-darker-color);
    max-width: 36rem;
  }
  .state h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1rem;
    color: var(--theme-caption-color);
  }
  .state p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.4;
  }
</style>
