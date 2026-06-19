//
// Copyright © 2026 Hardcore Engineering Inc.
//

import type { Doc } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import type { ComponentType } from 'svelte'

/**
 * Generic column descriptor used by `<EntityTable>` and by callers that
 * want type-safe column definitions. Svelte 4 components can't accept
 * `<T>` generics on props reliably, so the table itself takes
 * `EntityColumn<any>[]` and each caller enforces type-safety at the
 * call site by typing its own column array as `EntityColumn<MyRow>[]`.
 */
export interface EntityColumn<T extends Doc | Record<string, unknown>> {
  /**
   * Either a typed property name of T or a string key for a virtual
   * column (e.g. a computed "activity bucket" that isn't a real field).
   */
  key: keyof T | string
  label: IntlString
  sort?: boolean
  /** Optional cell renderer; defaults to text rendering of the value. */
  renderer?: ComponentType
  /** Initial pixel width hint; final width is the user-resizable value. */
  width?: number
  /** Per-row visibility predicate; if returns false the cell is empty. */
  visible?: (entity: T) => boolean
}
