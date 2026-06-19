//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Back-compat re-export from `@hcengineering/access-management-ui`. The
// deep source path is intentional so Jest in this package can resolve
// the helper without trying to evaluate the lib's Svelte components
// (which would fail under ts-jest without svelte-jest).
//

export { mergeColumnFilters } from '@hcengineering/access-management-ui/src/utils/mergeColumnFilters'
