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
  import { Header, Breadcrumb } from '@hcengineering/ui'
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
  </div>
</div>

<style lang="scss">
  .content {
    margin: 2rem 3.25rem;
  }
</style>
