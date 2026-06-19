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
