//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Shared library for in-workspace + cross-workspace access management UIs.
// Consumed by `@hcengineering/login-resources` (Instance-Admin Panel #10883)
// and by `@hcengineering/workspace-access-resources` (WAC, Phase 2a).
//

// Utils
export { type EntityColumn } from './utils/EntityColumn'
export { mergeColumnFilters } from './utils/mergeColumnFilters'
export { DEBOUNCE_MS } from './utils/constants'
export { tzTooltip } from './utils/tzTooltip'
export {
  csvEscape,
  csvLine,
  csvRows,
  csvBomPrefix
} from './utils/csv'
export { decodeFilterParam, encodeFilterParam } from './utils/filterParam'

// Generic components
export { default as EntityTable } from './components/EntityTable.svelte'
export { default as EntityDrawer } from './components/EntityDrawer.svelte'
export { default as AuditLogView } from './components/AuditLogView.svelte'
export { default as AuditLogExportButton } from './components/AuditLogExportButton.svelte'

// Concrete (moved from login-resources/admin-users for cross-app reuse)
export { default as BulkActionBar } from './components/BulkActionBar.svelte'
export { default as ColumnFilterPopup } from './components/ColumnFilterPopup.svelte'
export { default as MassActionConfirm } from './components/MassActionConfirm.svelte'
export { default as FilterPresetMenu } from './components/FilterPresetMenu.svelte'
export { default as AuditEmptyState } from './components/AuditEmptyState.svelte'

// Types
export type { AuditEntryView, AuditMapper } from './types/AuditEntry'
