//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { type Class, type Hierarchy, type Ref } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

/**
 * Returns a `$in`-style filter that covers all classes derived from
 * `tracker.class.Issue` (Issue + any registered subclasses). Use this
 * for any cascade query that should match subclass issues too.
 *
 * Per Wave-2 A1 (Codex blocker): exact-class queries miss subclass docs
 * and are a data-correctness bug for the Gantt scheduling layer and the
 * `migrateAddStartDate` migration. The migration MUST use this widening
 * because `MigrationClient.update` bypasses the server-storage
 * `fillClass` cascade that runtime `findAll` benefits from.
 *
 * For runtime sites: `client.findAll(tracker.class.Issue, query)` already
 * cascades on the server side (`foundations/server/packages/postgres/src/
 * storage.ts::fillClass` expands a parent class to `{$in: descendants}`
 * automatically when `query._class` is not provided). Use this helper
 * when you need to be explicit, when you query against a domain directly,
 * or when D2 extracts the cascade logic from `GanttView.svelte`.
 *
 * Note: `tracker.class.IssueTemplate` is intentionally NOT a descendant
 * of `tracker.class.Issue` — it extends `core.class.Doc` and lives in
 * `DOMAIN_TRACKER` (not `DOMAIN_TASK`). `hierarchy.getDescendants`
 * reflects that, so the returned set excludes IssueTemplate by design.
 */
export function issueClassFilter (hierarchy: Hierarchy): { $in: Array<Ref<Class<Issue>>> } {
  return { $in: hierarchy.getDescendants(tracker.class.Issue) as Array<Ref<Class<Issue>>> }
}
