# @hcengineering/workspace-access-resources

Workspace Access Center (WAC) — per-workspace surface for People, Resources, My Access and Audit, plus the Instance-Admin impersonation flow.

## Mount

Register a workbench route for `/workbench/<workspace>/access-center` and render `<AccessCenter>`:

```svelte
<script lang="ts">
  import { AccessCenter } from '@hcengineering/workspace-access-resources'
  export let params: { workspace: string }
</script>

<AccessCenter
  workspace={params.workspace}
  workspaceLabel="My workspace"
  retentionDays={365}
/>
```

## App-rail entry

The app-rail icon (key symbol) is added by the workbench wiring layer, gated by the workspace's effective role:

```ts
// pseudocode — in workbench/AppRail.svelte:
if (effectiveRole === 'OWNER' || effectiveRole === 'MAINTAINER' || effectiveRole === 'MAINTAINER_PLUS_SPACE_OWNER') {
  appRail.add({
    id: 'access-center',
    icon: 'key',
    label: 'Access Center',
    route: `/workbench/${workspace}/access-center`
  })
}
```

## Cross-reference from the Instance-Admin Panel (#10883)

Each workspace row in `AdminWorkspaces.svelte` gets an `Open Access Center →` action that opens `/workbench/<ws>/access-center?from=admin`. The query flag flips the impersonation store to `drill-down`, which renders the blue read-only banner.

## Settings deep-link

A small banner at the top of the existing "Workspace Members" tab in Settings links to WAC for the same workspace.

## DSGVO posture

- First-open banner shows the workspace's audit retention (default 365 days).
- CSV exports show a confirmation modal noting the file contains personal data.
- The impersonation start dialog explicitly states the dual-audit and "no stealth" guarantee, with an optional `reason` field saved to `admin_audit_log.metadata.impersonation_reason`.
- Impersonation tokens live in `sessionStorage` (not `localStorage`) so they do not survive tab closure or leak across tabs.

## Companion packages

| Package | Role |
|---|---|
| `@hcengineering/access-management-ui` | shared UI shell + utilities |
| `@hcengineering/access-management-server` | server-side guards + audit writers (foundations/) |
| `@hcengineering/server-workspace-access` | endpoints + migrations + impersonation logic |
| `@hcengineering/workspace-access-resources` | the WAC frontend (this package) |

Spec: `docs/superpowers/specs/2026-06-18-huly-workspace-access-center-design.md` in the infra repo.

## Component map

The frontend is structured as one shell (`AccessCenter`) hosting four
tabs, each backed by a top-level view component and a stack of
sub-tabs/drawers. All API access goes through `src/api/` which calls
into the host's `/api/wac/<workspace>/...` endpoints (see
`@hcengineering/server-workspace-access` for the contract).

| Component | Path | Purpose |
|-----------|------|---------|
| `AccessCenter` | `components/AccessCenter.svelte` | Mount shell. Reads `workspace`/`workspaceLabel`/`retentionDays` props, dispatches to one of the four tab views via `TabBar`. |
| `TabBar` | `components/TabBar.svelte` | Tab navigation (People / Resources / My Access / Audit). |
| `PeopleView` | `components/people/PeopleView.svelte` | Tabbed People surface: All members / By role / Pending invites / Granted access / Inactive. |
| `PersonDrawer` | `components/people/PersonDrawer.svelte` | Right-side drawer for a single member (role edit + activity + grant list). |
| `PeopleBulkBar` | `components/people/PeopleBulkBar.svelte` | Multi-select toolbar for bulk role changes. |
| `ResourcesView` | `components/resources/ResourcesView.svelte` | Hosts `AllSpacesTab` + the v2-placeholder cards. Renders the Capability-Matrix per row. |
| `AllSpacesTab` | `components/resources/AllSpacesTab.svelte` | Table of spaces from `/api/wac/<ws>/spaces`. |
| `SpaceDrawer` | `components/resources/SpaceDrawer.svelte` | Members/Owners/flags editor for a single space. |
| `MyAccessView` | `components/my-access/MyAccessView.svelte` | Self-view: spaces I own, spaces I'm member of, grants received/given. |
| `AuditView` | `components/audit/AuditView.svelte` | Audit timeline + CSV export trigger. |
| `MemberPickerInput` | `components/shared/MemberPickerInput.svelte` | Type-ahead member picker used by all drawers. Resolves person UUID → display name via the same person/social_id lookup the server uses. |
| `DsgvoFirstOpenBanner` | `components/shared/DsgvoFirstOpenBanner.svelte` | First-open retention banner. |
| `ImpersonationBanner` | `components/impersonation/ImpersonationBanner.svelte` | Blue read-only banner shown when the impersonation store is in `drill-down` mode. |
| `AssumeRoleModal` | `components/impersonation/AssumeRoleModal.svelte` | Dialog to start impersonation (admin only). |
| `ExpiredModal` | `components/impersonation/ExpiredModal.svelte` | Shown when the 30-min token expires — refuses silent prolongation. |

### Role / Capability matrix

What each effective workspace role can do in the four WAC tabs. The
matrix mirrors the server-side `READ_ALLOWED_ROLES` /
`WRITE_ALLOWED_ROLES` gates in `@hcengineering/server-workspace-access`
and the per-row `capabilities` block returned by `/api/wac/<ws>/spaces`.

| Capability | OWNER | MAINTAINER | USER | GUEST | READONLY_GUEST | DOC_GUEST |
|------------|:-----:|:----------:|:----:|:-----:|:--------------:|:---------:|
| Open WAC at all | yes | yes | yes (self only) | self only | self only | self only |
| People tab — list all members | yes | yes | no | no | no | no |
| People tab — change role | yes | yes | no | no | no | no |
| Resources tab — list all spaces | yes | yes | no | no | no | no |
| Resources tab — edit members/owners | yes | yes | per-space owner | no | no | no |
| My Access tab | yes | yes | yes | yes | yes | yes |
| Audit tab — read | yes | yes | no | no | no | no |
| Audit tab — CSV export | yes | yes (capability:'admin' on the route) | no | no | no | no |
| Start impersonation | instance admin only | — | — | — | — | — |

`USER` who is `data.owners` of a specific space gets edit rights on
**that space's** members/owners — the Resources tab reflects this per
row, not per role. `MAINTAINER` is shorthand for "can do everything an
OWNER can except destroy the workspace"; the only OWNER-only path in v1
is the workspace-delete confirmation flow (lives outside WAC).

### UI conventions

- Right-side drawers (PersonDrawer / SpaceDrawer) own their own dirty
  state and call `/api/wac/<ws>/...` on save. They never short-circuit
  the API on a 4xx — the API contract is the source of truth and the
  drawer just surfaces the error message.
- Impersonation tokens live in `sessionStorage` (not `localStorage`)
  per the DSGVO posture section above.
- Every API call funnels through `src/api/` so a future SSR/offline
  layer can intercept at one boundary.
