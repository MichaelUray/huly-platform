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
  Phase 2 T1 compat-shim. The legacy `Guests` Settings entry (route
  `/setting/guestPermissions`) has been folded into Access Center →
  People with the by-role sub-tab selected, where guest accounts can be
  reviewed and managed alongside other members. The original component
  was the 722-line per-application guest-permission editor; that surface
  is superseded by the per-Space membership editor in the Resources tab
  plus the unified People view.

  See: docs/superpowers/specs/2026-06-21-huly-settings-ia-analysis.md
  See: docs/superpowers/plans/2026-06-21-huly-post-codex-block-resolution.md
        (Phase 2 → P2-T1, Q-P2-T1 = (b)+hidden)
-->
<script lang="ts">
  import AccessCenterPage from './AccessCenterPage.svelte'
</script>

<AccessCenterPage initialTab="people" initialSub="by-role" />
