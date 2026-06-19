# @hcengineering/access-management-server

Shared server foundations for in-workspace and cross-workspace access management. Re-used by `@hcengineering/server-workspace-access` (WAC) and intended for the next Instance-Admin (#10883) follow-up that adopts the shared audit writer.

## Exports

### Guards

- **`Forbidden`** — domain error type
- **`assertWorkspaceContext(ctx)`** — rejects admin-audience tokens + missing workspace claim
- **`getEffectiveRole(ctx, workspace)`** — multi-role resolver. Returns one of `OWNER` / `MAINTAINER` / `MAINTAINER_PLUS_SPACE_OWNER` / `SPACE_OWNER_SCOPED` / `USER_SELF_SCOPED` / `GUEST` / `IMPERSONATING_ADMIN`.
- **`READ_ALLOWED_ROLES`** / **`WRITE_ALLOWED_ROLES`** — constant arrays; `MAINTAINER` is never in `WRITE_ALLOWED_ROLES`.

### Audit

- **`AuditLogger`** — generic writer for `admin_audit_log` and `workspace_audit_log`.
- **`withImpersonationAudit(ctx, action, payload, exec)`** — transactional wrapper. Always writes to `workspace_audit_log`; when `ctx.isImpersonating` is true, also writes to `admin_audit_log` with the same `impersonation_ref` so forensics can stitch the two perspectives.

### Space-Owner side-channel

- **`assertSpaceOwnerEdit(ctx, space, field, oldValue, newValue)`** — four-constraint check that prevents last-owner self-removal, cross-workspace owner assignment, and Space-Owner-via-members-field demotion.
- **`ALLOWED_FIELDS_BY_SPACE_OWNER`** = `['members', 'owners']`
- **`FORBIDDEN_FIELDS_IN_WAC`** = `['type', 'restricted', 'autoJoinForRoles', '_class']`

## Tests

100% statement coverage across all five modules. See `src/__tests__/`.
