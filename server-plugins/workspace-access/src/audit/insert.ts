//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//
// M2 — single source of truth for the `workspace_audit_log` INSERT.
//
// Before this commit the audit-row INSERT lived in TWO places:
//   1. account-service `writeWacAudit()` (impersonation audit path)
//   2. server-plugins/workspace-access `writeAuditPostMutation()` (mutation audit path)
//
// Both used the same column list and same `::uuid`/`::jsonb` casts, but
// the duplicates drifted in error-handling shape (one logged via
// `measureCtx.warn`, the other via `measureCtx.error` + the
// `wac_audit_orphan` breadcrumb). Anyone adding a new audit dimension
// (e.g. a column) had to remember to touch both — exactly the kind of
// drift that turns a code review into a hunt.
//
// This module exports the single canonical statement + a small wrapper
// that issues it. The two call sites delegate here.

/**
 * Minimal pg-client surface used by the audit insert. Mirrors the
 * structural type declared in `http/writeRouter.ts` so both call sites
 * can share the helper without picking up the postgres-base dep.
 */
export interface AuditInsertPgClient {
  execute: (query: string, parameters?: any[]) => Promise<any[]>
}

/** All columns we write to `workspace_audit_log` on a single INSERT. */
export interface WorkspaceAuditPayload {
  /** Workspace UUID — anchors the row to its tenant. */
  workspace: string
  /** Free-form action verb (e.g. `space_members_changed`, `impersonation_started`). */
  action: string
  /** Actor account UUID. NULL when the actor is a service principal. */
  actor: string | null
  /** Role label (`workspace_owner`, `instance_admin`, etc.) */
  actorRole: string
  /** Target account UUID (optional). */
  target_account?: string | null
  /** Target space `_id` (optional). */
  target_space?: string | null
  /** Target space `_class` (optional). */
  target_space_class?: string | null
  /** Old value snapshot (will be JSON-stringified). */
  old_value?: unknown
  /** New value snapshot (will be JSON-stringified). */
  new_value?: unknown
  /** Free-form metadata blob — caller-supplied jsonb. */
  metadata?: Record<string, unknown>
}

/**
 * The single, canonical SQL statement used by every WAC audit insert.
 * Exported so guard tests in either host can assert that no other
 * INSERT against `workspace_audit_log` slips in unnoticed.
 */
export const WORKSPACE_AUDIT_INSERT_SQL = `INSERT INTO workspace_audit_log
       (workspace, action, actor, actor_role, target_account, target_space, target_space_class, old_value, new_value, metadata)
       VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`

/**
 * Issue the canonical audit-row INSERT. Throws on pg failure — callers
 * choose whether to surface (B4 atomicity caveat). Both call sites
 * currently swallow the throw and log an `wac_audit_orphan` breadcrumb;
 * see the host-side / plugin-side wrappers for the surrounding policy.
 *
 * @public
 */
export async function executeWorkspaceAuditInsert (
  pg: AuditInsertPgClient,
  payload: WorkspaceAuditPayload
): Promise<void> {
  await pg.execute(WORKSPACE_AUDIT_INSERT_SQL, [
    payload.workspace,
    payload.action,
    payload.actor,
    payload.actorRole,
    payload.target_account ?? null,
    payload.target_space ?? null,
    payload.target_space_class ?? null,
    payload.old_value != null ? JSON.stringify(payload.old_value) : null,
    payload.new_value != null ? JSON.stringify(payload.new_value) : null,
    JSON.stringify(payload.metadata ?? {})
  ])
}
