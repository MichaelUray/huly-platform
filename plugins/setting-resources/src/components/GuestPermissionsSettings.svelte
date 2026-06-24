<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  Phase 2 T1 + Phase 2.5 compat-shim. The legacy `Guests` Settings entry
  (route `/setting/guestPermissions`) is the entry to the
  per-application guest-permission editor. The original 722-line editor
  body has been extracted into `GuestPermissionsEditor.svelte` and is
  now mounted as the 5th tab of the Access Center (Owner-only, see
  `tabsForRole()` in `workspace-access-resources/src/stores/roleStore.ts`).

  This shim deep-links the legacy URL straight to that tab so existing
  bookmarks land on the same editor — behaviour-identical to the
  pre-Phase-2 surface, just relocated into the Access Center shell.

  See: docs/superpowers/specs/2026-06-21-huly-settings-ia-analysis.md
  See: docs/superpowers/plans/2026-06-21-huly-post-codex-block-resolution.md
        (Phase 2 → P2-T1, Q-P2-T1 = (b)+hidden; Phase 2.5 → flag (iii)
        — port editor as WAC 5th Owner-only tab.)
-->
<script lang="ts">
  import AccessCenterPage from './AccessCenterPage.svelte'
</script>

<AccessCenterPage initialTab="guest-settings" />
